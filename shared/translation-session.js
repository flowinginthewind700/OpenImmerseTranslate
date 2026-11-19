/**
 * Translation session lifecycle.
 *
 * A page translation session can stay active to observe SPA updates after its
 * current pipeline has settled. UI loading state must follow pipelineBusy, not
 * sessionActive, otherwise completed or failed pages spin forever.
 */
(function initTranslationSession(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationSession = api.TranslationSession;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSessionApi() {
  'use strict';

  const PHASES = Object.freeze({
    IDLE: 'idle',
    SCANNING: 'scanning',
    TRANSLATING: 'translating',
    COMPLETED: 'completed',
    FAILED: 'failed',
    STOPPED: 'stopped'
  });

  const PHASE_VALUES = new Set(Object.values(PHASES));
  const NO_CONTENT_ERROR = 'No translatable page content was found';

  function safeTimestamp(value, fallback = Date.now()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function normalizeError(value) {
    if (value instanceof Error) return value.message || value.name;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  class TranslationSession {
    constructor(options = {}) {
      this.now = typeof options.now === 'function' ? options.now : Date.now;
      this.listeners = new Set();
      this.reset();
    }

    reset(now = this.now()) {
      return this.transition({
        phase: PHASES.IDLE,
        sessionActive: false,
        pipelineBusy: false,
        lastError: null,
        translatedCount: 0,
        failedRequestCount: 0,
        lastActivityAt: safeTimestamp(now)
      });
    }

    start(now = this.now()) {
      return this.transition({
        phase: PHASES.SCANNING,
        sessionActive: true,
        pipelineBusy: true,
        lastError: null,
        translatedCount: 0,
        failedRequestCount: 0,
        lastActivityAt: safeTimestamp(now)
      });
    }

    markActivity(now = this.now()) {
      if (!this.sessionActive || this.phase === PHASES.STOPPED) {
        return this.snapshot();
      }
      return this.transition({
        phase: PHASES.TRANSLATING,
        pipelineBusy: true,
        lastActivityAt: safeTimestamp(now)
      });
    }

    settle(outcome = {}, now = this.now()) {
      if (!this.sessionActive || this.phase === PHASES.STOPPED) {
        return this.snapshot();
      }

      const translatedCount = safeCount(outcome.translatedCount);
      const failedRequestCount = safeCount(outcome.failedRequestCount);
      const completed = translatedCount > 0;
      const failureError = normalizeError(outcome.error);
      const lastError = completed
        ? null
        : failureError
          || (failedRequestCount > 0 ? 'Page translation failed' : NO_CONTENT_ERROR);

      return this.transition({
        phase: completed ? PHASES.COMPLETED : PHASES.FAILED,
        pipelineBusy: false,
        lastError,
        translatedCount,
        failedRequestCount,
        lastActivityAt: safeTimestamp(now)
      });
    }

    fail(error, outcome = {}, now = this.now()) {
      if (!this.sessionActive || this.phase === PHASES.STOPPED) {
        return this.snapshot();
      }
      return this.transition({
        phase: PHASES.FAILED,
        pipelineBusy: false,
        lastError: normalizeError(error) || 'Page translation failed',
        translatedCount: safeCount(outcome.translatedCount ?? this.translatedCount),
        failedRequestCount: safeCount(
          outcome.failedRequestCount ?? this.failedRequestCount
        ),
        lastActivityAt: safeTimestamp(now)
      });
    }

    stop(now = this.now()) {
      return this.transition({
        phase: PHASES.STOPPED,
        sessionActive: false,
        pipelineBusy: false,
        lastError: null,
        lastActivityAt: safeTimestamp(now)
      });
    }

    transition(updates = {}) {
      if (updates.phase && !PHASE_VALUES.has(updates.phase)) {
        throw new TypeError(`Unknown translation session phase: ${updates.phase}`);
      }
      Object.assign(this, updates);
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          // Observers must not break the translation lifecycle.
        }
      }
      return snapshot;
    }

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    snapshot() {
      return Object.freeze({
        phase: this.phase,
        sessionActive: this.sessionActive,
        pipelineBusy: this.pipelineBusy,
        lastError: this.lastError,
        translatedCount: this.translatedCount,
        failedRequestCount: this.failedRequestCount,
        lastActivityAt: this.lastActivityAt
      });
    }
  }

  return Object.freeze({
    PHASES,
    NO_CONTENT_ERROR,
    TranslationSession
  });
});
