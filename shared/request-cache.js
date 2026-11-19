/**
 * Open Immerse Translate - bounded request cache.
 *
 * The cache owns request deduplication and TTL/LRU behavior, while callers own
 * transport and validation. Concurrent waiters share one real load, but a
 * cancelled waiter cannot abort a load that another waiter still needs.
 */
(function initRequestCache(root, factory) {
  const promptPolicy = root.OITPromptPolicy
    || (typeof require === 'function' ? require('./prompt-policy.js') : null);
  const api = factory(promptPolicy);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITRequestCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRequestCacheApi(
  promptPolicy
) {
  'use strict';

  const CACHE_KEY_VERSION = 1;
  const DEFAULT_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_MAX_ENTRIES = 500;
  const PROTECTED_TOKEN_PATTERN = /\[\[OIT-[A-Z0-9]+:(OPEN|CLOSE|ATOM):\d+\]\]/g;
  const MISSING = Symbol('cache-miss');

  function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function cloneValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (error) {
        // Fall through for values that cannot be cloned by the platform.
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function createAbortError(reason) {
    if (typeof DOMException === 'function') {
      return new DOMException('The operation was aborted', 'AbortError');
    }
    const error = new Error(reason?.message || 'The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function normalizePromptContext(context) {
    if (promptPolicy?.normalizePromptContext) {
      return promptPolicy.normalizePromptContext(context);
    }
    return {
      scene: normalizeWhitespace(context?.scene || 'page').toLowerCase(),
      title: normalizeWhitespace(context?.title),
      surroundingText: normalizeWhitespace(context?.surroundingText),
      itemContexts: Array.isArray(context?.itemContexts)
        ? context.itemContexts.map(normalizeWhitespace)
        : []
    };
  }

  function buildTranslationCacheKey(input = {}) {
    const texts = (Array.isArray(input.texts) ? input.texts : [input.texts])
      .map(text => String(text ?? ''));
    const tokenSequence = [];
    const canonicalTexts = texts.map(text => text.replace(
      PROTECTED_TOKEN_PATTERN,
      (token, kind) => {
        tokenSequence.push(kind);
        return `[[OIT:${kind}]]`;
      }
    ));
    const config = input.config || {};
    const context = normalizePromptContext(input.context || {});

    return JSON.stringify({
      cacheKeyVersion: CACHE_KEY_VERSION,
      promptPolicyVersion: String(
        input.promptPolicyVersion
        || promptPolicy?.PROMPT_POLICY_VERSION
        || 'unknown'
      ),
      texts: canonicalTexts,
      protectedTokenSequence: tokenSequence,
      config: {
        provider: normalizeWhitespace(config.provider || 'custom').toLowerCase(),
        endpoint: normalizeWhitespace(config.apiEndpoint),
        model: normalizeWhitespace(config.modelName),
        sourceLang: normalizeWhitespace(config.sourceLang || 'auto'),
        targetLang: normalizeWhitespace(config.targetLang || 'zh-CN'),
        translationStyle: normalizeWhitespace(config.translationStyle || 'accurate'),
        autoDetect: config.autoDetect !== false,
        customPrompt: normalizeWhitespace(config.customPrompt),
        maxTokens: normalizePositiveInteger(config.maxTokens, 2048),
        temperature: Number.isFinite(Number(config.temperature))
          ? Number(config.temperature)
          : 0.3
      },
      context: {
        scene: context.scene,
        title: context.title,
        surroundingText: context.surroundingText,
        itemContexts: Array.from(context.itemContexts || [])
      }
    });
  }

  function createRequestCache(options = {}) {
    const maxEntries = normalizePositiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
    const ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_TTL_MS);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const shouldCache = typeof options.shouldCache === 'function'
      ? options.shouldCache
      : value => value !== undefined && value !== null;
    const entries = new Map();
    const inflight = new Map();
    const metrics = {
      requests: 0,
      hits: 0,
      misses: 0,
      shared: 0,
      loads: 0,
      failures: 0,
      cancelled: 0,
      expired: 0,
      evictions: 0
    };

    function deleteEntry(key) {
      return entries.delete(key);
    }

    function readEntry(key) {
      const entry = entries.get(key);
      if (!entry) {
        metrics.misses++;
        return MISSING;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        metrics.expired++;
        metrics.misses++;
        return MISSING;
      }

      entries.delete(key);
      entries.set(key, entry);
      metrics.hits++;
      return cloneValue(entry.value);
    }

    function writeEntry(key, value) {
      if (!shouldCache(value)) return false;
      if (entries.has(key)) entries.delete(key);
      entries.set(key, {
        value: cloneValue(value),
        expiresAt: now() + ttlMs
      });

      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        entries.delete(oldestKey);
        metrics.evictions++;
      }
      return true;
    }

    function get(key) {
      const value = readEntry(key);
      return value === MISSING ? undefined : value;
    }

    function detachWaiter(entry, state) {
      if (state.detached) return;
      state.detached = true;
      entry.waiters = Math.max(0, entry.waiters - 1);
      if (entry.waiters === 0 && !entry.settled) {
        entry.cancelledByWaiters = true;
        entry.controller.abort();
      }
    }

    function waitForEntry(entry, signal) {
      const state = { detached: false };
      entry.waiters++;

      if (!signal) return entry.promise;
      if (signal.aborted) {
        detachWaiter(entry, state);
        metrics.cancelled++;
        return Promise.reject(createAbortError(signal.reason));
      }

      return new Promise((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          cleanup();
          detachWaiter(entry, state);
          metrics.cancelled++;
          reject(createAbortError(signal.reason));
        };

        signal.addEventListener('abort', onAbort, { once: true });
        entry.promise.then(
          value => {
            cleanup();
            resolve(value);
          },
          error => {
            cleanup();
            reject(error);
          }
        );
      });
    }

    function getOrLoad(key, loader, requestOptions = {}) {
      if (typeof loader !== 'function') {
        return Promise.reject(new TypeError('Request cache loader must be a function'));
      }
      metrics.requests++;

      const signal = requestOptions.signal;
      if (signal?.aborted) {
        metrics.cancelled++;
        return Promise.reject(createAbortError(signal.reason));
      }

      const cached = readEntry(key);
      if (cached !== MISSING) return Promise.resolve(cached);

      let entry = inflight.get(key);
      if (entry) {
        metrics.shared++;
        return waitForEntry(entry, signal);
      }

      metrics.loads++;
      const controller = new AbortController();
      entry = {
        controller,
        promise: null,
        waiters: 0,
        settled: false,
        cancelledByWaiters: false
      };

      entry.promise = Promise.resolve()
        .then(() => loader({
          key,
          signal: controller.signal
        }))
        .then(
          value => {
            entry.settled = true;
            if (!entry.cancelledByWaiters) writeEntry(key, value);
            return value;
          },
          error => {
            entry.settled = true;
            metrics.failures++;
            throw error;
          }
        )
        .finally(() => {
          if (inflight.get(key) === entry) inflight.delete(key);
        });
      inflight.set(key, entry);
      return waitForEntry(entry, signal);
    }

    function prune() {
      const timestamp = now();
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= timestamp) {
          entries.delete(key);
          metrics.expired++;
        }
      }
    }

    function clear() {
      for (const entry of inflight.values()) {
        if (!entry.settled) {
          entry.cancelledByWaiters = true;
          entry.controller.abort();
        }
      }
      inflight.clear();
      entries.clear();
    }

    function stats() {
      prune();
      return Object.freeze({
        size: entries.size,
        inflight: inflight.size,
        maxEntries,
        ttlMs,
        ...metrics
      });
    }

    return Object.freeze({
      get,
      getOrLoad,
      set: writeEntry,
      delete: deleteEntry,
      clear,
      prune,
      stats,
      buildTranslationCacheKey
    });
  }

  return Object.freeze({
    CACHE_KEY_VERSION,
    DEFAULT_TTL_MS,
    DEFAULT_MAX_ENTRIES,
    buildTranslationCacheKey,
    createRequestCache
  });
});
