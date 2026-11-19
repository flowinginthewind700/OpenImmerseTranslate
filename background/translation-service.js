/**
 * Open Immerse Translate - background translation service.
 *
 * The service coordinates cache deduplication, provider dispatch, batching,
 * validation, retry, and cancellation. Runtime messaging and tab state remain
 * outside this module so the translation kernel can be tested in isolation.
 */
(function initTranslationService(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTranslationServiceApi() {
  'use strict';

  function requireDependency(value, name) {
    if (!value) throw new Error(`Translation service requires ${name}`);
    return value;
  }

  function createTranslationService(options = {}) {
    const translationCore = requireDependency(options.translationCore, 'translationCore');
    const modelPolicy = requireDependency(options.modelPolicy, 'modelPolicy');
    const requestCacheModule = requireDependency(options.requestCacheModule, 'requestCacheModule');
    const providerTransport = requireDependency(options.providerTransport, 'providerTransport');
    const rateLimiter = requireDependency(options.rateLimiter, 'rateLimiter');
    const scheduler = requireDependency(options.scheduler, 'scheduler');
    const logger = options.logger || console;
    const promptPolicyVersion = options.promptPolicyVersion
      || globalThis.OITPromptPolicy?.PROMPT_POLICY_VERSION;
    const translationCache = requestCacheModule.createRequestCache(
      options.cacheOptions || {
        maxEntries: 500,
        ttlMs: 10 * 60 * 1000
      }
    );

    function buildFallbackContext(context, indexes) {
      if (!context || typeof context !== 'object') return context;
      const itemContexts = Array.isArray(context.itemContexts)
        ? context.itemContexts
        : [];
      return {
        ...context,
        itemContexts: indexes.map(index => itemContexts[index] || '')
      };
    }

    async function translateOneText(text, config, context, signal) {
      const request = translationCore.buildTranslationRequest([text], config, context);
      const content = await providerTransport.requestLlmContent(
        request.system,
        request.user,
        config,
        signal
      );
      const translation = translationCore.parseSingleTranslation(content);
      if (!translation.trim()
          || !translationCore.validateProtectedTranslation(text, translation)) {
        throw new Error('Single translation failed validation');
      }
      return translation;
    }

    async function translateLlmTexts(texts, config, context, signal) {
      const results = texts.slice();
      const indexes = [];
      const pendingTexts = [];

      texts.forEach((text, index) => {
        if (translationCore.shouldSkipText(text, config)) {
          results[index] = text;
        } else {
          indexes.push(index);
          pendingTexts.push(text);
        }
      });

      if (pendingTexts.length === 0) return results;

      const scopedContext = buildFallbackContext(context, indexes);
      const request = translationCore.buildTranslationRequest(
        pendingTexts,
        config,
        scopedContext
      );

      try {
        const content = await providerTransport.requestLlmContent(
          request.system,
          request.user,
          config,
          signal
        );
        const translations = pendingTexts.length === 1
          ? [translationCore.parseSingleTranslation(content)]
          : translationCore.parseBatchTranslations(content, pendingTexts.length);

        if (!translationCore.validateBatchTranslations(pendingTexts, translations)) {
          throw new Error('Batch translation failed count or protected-token validation');
        }

        translations.forEach((translation, index) => {
          results[indexes[index]] = translation;
        });
        return results;
      } catch (batchError) {
        if (scheduler.isAbortError(batchError)) throw batchError;
        if (pendingTexts.length === 1) throw batchError;

        logger.warn?.(
          '[OpenImmerseTranslate] Batch validation failed; falling back to single requests:',
          batchError.message
        );
        const contextItems = Array.isArray(context?.itemContexts)
          ? context.itemContexts
          : [];

        for (let index = 0; index < pendingTexts.length; index++) {
          if (signal?.aborted) {
            throw scheduler.createAbortError(signal.reason);
          }
          const originalIndex = indexes[index];
          const singleContext = {
            ...(context || {}),
            itemContexts: contextItems[originalIndex]
              ? [contextItems[originalIndex]]
              : []
          };
          results[originalIndex] = await translateOneText(
            pendingTexts[index],
            config,
            singleContext,
            signal
          );
        }
        return results;
      }
    }

    async function loadTranslations(texts, config, context, signal) {
      const provider = modelPolicy.inferProvider(config);
      if (provider === 'google') {
        return providerTransport.translateGoogleTexts(texts, config, signal);
      }

      await rateLimiter.acquire(signal);
      try {
        return await scheduler.withRetry(async () => {
          if (signal?.aborted) {
            throw scheduler.createAbortError(signal.reason);
          }
          return translateLlmTexts(texts, config, context, signal);
        }, { signal });
      } finally {
        rateLimiter.release();
      }
    }

    async function translate(texts, config = {}, context = {}, translateOptions = {}) {
      const sourceTexts = Array.isArray(texts) ? texts : [];
      if (sourceTexts.length === 0) return [];

      rateLimiter.applyConfig(config);
      const cacheKey = requestCacheModule.buildTranslationCacheKey({
        texts: sourceTexts,
        config,
        context,
        promptPolicyVersion
      });

      try {
        return await translationCache.getOrLoad(
          cacheKey,
          ({ signal }) => loadTranslations(sourceTexts, config, context, signal),
          { signal: translateOptions.signal }
        );
      } catch (error) {
        if (scheduler.isAbortError(error)) return null;
        throw error;
      }
    }

    return Object.freeze({
      translate,
      translateLlmTexts,
      stats: translationCache.stats,
      clearCache: translationCache.clear,
      pruneCache: translationCache.prune
    });
  }

  return Object.freeze({ createTranslationService });
});
