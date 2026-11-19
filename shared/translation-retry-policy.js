/**
 * Open Immerse Translate - bounded content retry policy.
 *
 * Provider transports own network retries. The content kernel uses this
 * policy to prevent scanner-driven retry loops from turning one failed unit
 * into an endless stream of new provider requests.
 */
(function initTranslationRetryPolicy(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationRetryPolicy = api.TranslationRetryPolicy;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRetryPolicyModule() {
  'use strict';

  const DEFAULT_OPTIONS = Object.freeze({
    maxAttempts: 2,
    cooldownMs: 30000,
    maxCooldownMs: 120000
  });

  function clampInteger(value, minimum, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
  }

  function normalizeFingerprint(value) {
    return String(value ?? '');
  }

  class TranslationRetryPolicy {
    constructor(options = {}) {
      this.maxAttempts = clampInteger(
        options.maxAttempts,
        1,
        DEFAULT_OPTIONS.maxAttempts
      );
      this.cooldownMs = clampInteger(
        options.cooldownMs,
        1,
        DEFAULT_OPTIONS.cooldownMs
      );
      this.maxCooldownMs = Math.max(
        this.cooldownMs,
        clampInteger(
          options.maxCooldownMs,
          this.cooldownMs,
          DEFAULT_OPTIONS.maxCooldownMs
        )
      );
      this.records = new WeakMap();
    }

    getStatus(element, fingerprint, now = Date.now()) {
      if (!element || (typeof element !== 'object' && typeof element !== 'function')) {
        return Object.freeze({
          allowed: false,
          reason: 'invalid-element',
          attempts: 0,
          retryAfter: 0
        });
      }

      const normalizedFingerprint = normalizeFingerprint(fingerprint);
      const record = this.records.get(element);
      if (!record || record.fingerprint !== normalizedFingerprint) {
        return Object.freeze({
          allowed: true,
          reason: record ? 'content-changed' : 'new-content',
          attempts: 0,
          retryAfter: 0
        });
      }
      if (record.attempts >= this.maxAttempts) {
        return Object.freeze({
          allowed: false,
          reason: 'exhausted',
          attempts: record.attempts,
          retryAfter: record.retryAfter
        });
      }
      if (now < record.retryAfter) {
        return Object.freeze({
          allowed: false,
          reason: 'cooldown',
          attempts: record.attempts,
          retryAfter: record.retryAfter
        });
      }
      return Object.freeze({
        allowed: true,
        reason: 'retry-ready',
        attempts: record.attempts,
        retryAfter: record.retryAfter
      });
    }

    recordFailure(element, fingerprint, now = Date.now()) {
      const status = this.getStatus(element, fingerprint, now);
      if (status.reason === 'invalid-element') return status;

      const previous = status.reason === 'content-changed' ? 0 : status.attempts;
      const attempts = previous + 1;
      const backoff = Math.min(
        this.maxCooldownMs,
        this.cooldownMs * (2 ** Math.max(0, attempts - 1))
      );
      const record = Object.freeze({
        fingerprint: normalizeFingerprint(fingerprint),
        attempts,
        retryAfter: now + backoff
      });
      this.records.set(element, record);
      return record;
    }

    recordSuccess(element) {
      if (element && (typeof element === 'object' || typeof element === 'function')) {
        this.records.delete(element);
      }
    }

    clear() {
      this.records = new WeakMap();
    }
  }

  return Object.freeze({
    DEFAULT_OPTIONS,
    TranslationRetryPolicy
  });
});
