/**
 * Open Immerse Translate - provider transport boundary.
 *
 * Network envelopes and provider-specific error handling live here. The
 * translation service owns validation, retries, caching, and batching.
 */
(function initProviderTransport(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITProviderTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProviderTransportApi() {
  'use strict';

  function requireDependency(value, name) {
    if (!value) throw new Error(`Provider transport requires ${name}`);
    return value;
  }

  function createProviderTransport(options = {}) {
    const modelPolicy = requireDependency(options.modelPolicy, 'modelPolicy');
    const translationCore = requireDependency(options.translationCore, 'translationCore');
    const rateLimiter = requireDependency(options.rateLimiter, 'rateLimiter');
    const rateLimiterApi = requireDependency(options.rateLimiterApi, 'rateLimiterApi');
    const requestTimeout = requireDependency(
      options.requestTimeoutApi || globalThis.OITRequestTimeout,
      'requestTimeoutApi'
    );
    const fetchImpl = options.fetchImpl || ((...args) => {
      if (typeof globalThis.fetch !== 'function') {
        throw new Error('Fetch is unavailable');
      }
      return globalThis.fetch(...args);
    });
    const logger = options.logger || console;
    const requestTimeoutMs = Number(options.requestTimeoutMs) > 0
      ? Number(options.requestTimeoutMs)
      : requestTimeout.DEFAULT_TIMEOUT_MS;

    requireDependency(fetchImpl, 'fetch');

    function convertToGoogleLangCode(langCode) {
      const mapping = {
        auto: 'auto',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        en: 'en',
        ja: 'ja',
        ko: 'ko',
        fr: 'fr',
        de: 'de',
        es: 'es',
        ru: 'ru',
        ar: 'ar',
        pt: 'pt',
        it: 'it',
        vi: 'vi',
        th: 'th'
      };
      return mapping[langCode] || langCode;
    }

    function withRequestDeadline(task, signal, label) {
      return requestTimeout.withTimeout(task, {
        timeoutMs: requestTimeoutMs,
        signal,
        message: label
      });
    }

    async function executeProviderRequest(request, signal) {
      return withRequestDeadline(async ownedSignal => {
        const response = await fetchImpl(request.endpoint, {
          method: 'POST',
          signal: ownedSignal,
          headers: request.headers,
          body: JSON.stringify(request.body)
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let errorData = {};
          try {
            errorData = errorText ? JSON.parse(errorText) : {};
          } catch (error) {
            errorData = {};
          }
          const errorMessage = errorData.error?.message
            || errorData.message
            || errorText
            || `API error: ${response.status}`;
          const requestError = new Error(`${request.provider}: ${errorMessage}`);
          requestError.status = response.status;
          throw requestError;
        }

        const data = await response.json();
        return modelPolicy.parseProviderResponse(request.provider, data);
      }, signal, `${request.provider} request timed out`);
    }

    async function callOpenAICompatibleApi(systemPrompt, userPrompt, config, signal) {
      return executeProviderRequest(
        modelPolicy.buildOpenAICompatibleRequest(config, systemPrompt, userPrompt),
        signal
      );
    }

    async function callOllamaApi(systemPrompt, userPrompt, config, signal) {
      const request = modelPolicy.buildOllamaRequest(config, systemPrompt, userPrompt);
      logger.log?.('[OpenImmerseTranslate] Ollama endpoint:', request.endpoint);

      try {
        return await executeProviderRequest(request, signal);
      } catch (error) {
        if (error.status === 403) {
          throw new Error('Ollama connection refused. Start it with OLLAMA_ORIGINS=* ollama serve');
        }
        if (error.status === 404) {
          throw new Error(`Model "${config.modelName}" was not found. Run: ollama pull ${config.modelName}`);
        }
        throw error;
      }
    }

    async function callAnthropicApi(systemPrompt, userPrompt, config, signal) {
      return executeProviderRequest(
        modelPolicy.buildAnthropicRequest(config, systemPrompt, userPrompt),
        signal
      );
    }

    async function requestLlmContent(systemPrompt, userPrompt, config, signal) {
      const provider = modelPolicy.inferProvider(config);
      switch (provider) {
        case 'anthropic':
          return callAnthropicApi(systemPrompt, userPrompt, config, signal);
        case 'ollama':
          return callOllamaApi(systemPrompt, userPrompt, config, signal);
        default:
          return callOpenAICompatibleApi(systemPrompt, userPrompt, config, signal);
      }
    }

    async function callGoogleTranslateApi(text, sourceLang, targetLang, signal) {
      const url = 'https://translate.googleapis.com/translate_a/single'
        + `?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      return withRequestDeadline(async ownedSignal => {
        const response = await fetchImpl(url, {
          method: 'GET',
          signal: ownedSignal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (!response.ok) {
          throw new Error(`Google Translate API error: ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data?.[0])) return text;
        return data[0]
          .map(part => Array.isArray(part) ? part[0] || '' : '')
          .join('');
      }, signal, 'Google translation request timed out');
    }

    async function translateGoogleTexts(texts, config, signal) {
      const results = [];
      const sourceLang = config.sourceLang || 'auto';
      const targetLang = convertToGoogleLangCode(config.targetLang);

      for (const text of texts) {
        if (signal?.aborted) {
          throw rateLimiterApi.createAbortError(signal.reason);
        }
        if (translationCore.shouldSkipText(text, config)) {
          results.push(text);
          continue;
        }

        await rateLimiter.acquire(signal);
        try {
          const translation = await callGoogleTranslateApi(
            text,
            sourceLang,
            targetLang,
            signal
          );
          if (!translationCore.validateProtectedTranslation(text, translation)) {
            throw new Error('Google translation failed protected-token validation');
          }
          results.push(translation);
        } finally {
          rateLimiter.release();
        }
      }

      return results;
    }

    async function testProvider(config) {
      const testPrompt = 'Hello';
      const targetLang = config.targetLang === 'en' ? 'English' : 'Simplified Chinese';

      try {
        switch (modelPolicy.inferProvider(config)) {
          case 'google':
            await callGoogleTranslateApi(
              testPrompt,
              'en',
              convertToGoogleLangCode(config.targetLang)
            );
            break;
          case 'anthropic':
            await callAnthropicApi(`Translate to ${targetLang}`, testPrompt, config);
            break;
          case 'ollama':
            await callOllamaApi(`Translate to ${targetLang}`, testPrompt, config);
            break;
          default:
            await callOpenAICompatibleApi(`Translate to ${targetLang}`, testPrompt, config);
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return Object.freeze({
      convertToGoogleLangCode,
      executeProviderRequest,
      requestLlmContent,
      translateGoogleTexts,
      testProvider
    });
  }

  return Object.freeze({ createProviderTransport });
});
