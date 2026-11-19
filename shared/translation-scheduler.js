/**
 * Open Immerse Translate - translation work scheduling.
 *
 * Navigation is a latency-sensitive part of a page translation session. This
 * scheduler keeps reserved capacity available for adaptive UI and supplemental
 * page content while allowing those lanes to share unused total capacity. The
 * content pipeline owns the actual request queue; this module owns only
 * bounded lane accounting.
 */
(function initTranslationScheduler(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationScheduler = api.TranslationScheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSchedulerApi() {
  'use strict';

  const LANES = Object.freeze({
    BODY: 'body',
    ADAPTIVE: 'adaptive',
    SUPPLEMENTAL: 'supplemental'
  });
  const LANE_VALUES = new Set(Object.values(LANES));
  const DEFAULT_CONCURRENCY = 6;
  const MAX_CONCURRENCY = 12;

  function normalizeConcurrency(value, fallback = DEFAULT_CONCURRENCY) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(MAX_CONCURRENCY, Math.max(1, parsed));
  }

  function normalizeReserve(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  }

  class TranslationScheduler {
    constructor(options = {}) {
      this.maxConcurrent = normalizeConcurrency(options.maxConcurrent);
      this.adaptiveReserve = normalizeReserve(options.adaptiveReserve);
      this.supplementalReserve = normalizeReserve(
        options.supplementalReserve,
        0
      );
      this.active = {
        [LANES.BODY]: 0,
        [LANES.ADAPTIVE]: 0,
        [LANES.SUPPLEMENTAL]: 0
      };
      this.reset();
    }

    get bodyLimit() {
      return Math.max(
        1,
        this.maxConcurrent
          - this.configuredAdaptiveReserve
          - this.configuredSupplementalReserve
      );
    }

    get activeTotal() {
      return this.active[LANES.BODY]
        + this.active[LANES.ADAPTIVE]
        + this.active[LANES.SUPPLEMENTAL];
    }

    get configuredAdaptiveReserve() {
      return this.maxConcurrent <= 1
        ? 0
        : Math.min(this.adaptiveReserve, this.maxConcurrent - 1);
    }

    get configuredSupplementalReserve() {
      if (this.maxConcurrent <= 1 || this.supplementalReserve === 0) return 0;
      return Math.min(
        this.supplementalReserve,
        Math.max(0, this.maxConcurrent - 1 - this.configuredAdaptiveReserve)
      );
    }

    configure(options = {}) {
      if (Object.prototype.hasOwnProperty.call(options, 'maxConcurrent')) {
        this.maxConcurrent = normalizeConcurrency(
          options.maxConcurrent,
          this.maxConcurrent
        );
      }
      if (Object.prototype.hasOwnProperty.call(options, 'adaptiveReserve')) {
        this.adaptiveReserve = normalizeReserve(options.adaptiveReserve);
      }
      if (Object.prototype.hasOwnProperty.call(options, 'supplementalReserve')) {
        this.supplementalReserve = normalizeReserve(
          options.supplementalReserve,
          0
        );
      }
      // In-flight work must remain accounted for when limits shrink. Acquisitions
      // stay blocked until those requests release naturally.
      return this.snapshot();
    }

    canAcquire(lane) {
      if (!LANE_VALUES.has(lane) || this.activeTotal >= this.maxConcurrent) {
        return false;
      }
      if (lane === LANES.BODY) {
        return this.active[LANES.BODY] < this.bodyLimit;
      }
      return true;
    }

    acquire(lane) {
      if (!this.canAcquire(lane)) return false;
      this.active[lane]++;
      return true;
    }

    release(lane) {
      if (!LANE_VALUES.has(lane) || this.active[lane] <= 0) return false;
      this.active[lane]--;
      return true;
    }

    reset() {
      this.active[LANES.BODY] = 0;
      this.active[LANES.ADAPTIVE] = 0;
      this.active[LANES.SUPPLEMENTAL] = 0;
    }

    snapshot() {
      return Object.freeze({
        maxConcurrent: this.maxConcurrent,
        adaptiveReserve: this.configuredAdaptiveReserve,
        supplementalReserve: this.configuredSupplementalReserve,
        bodyLimit: this.bodyLimit,
        active: Object.freeze({
          total: this.activeTotal,
          body: this.active[LANES.BODY],
          adaptive: this.active[LANES.ADAPTIVE],
          supplemental: this.active[LANES.SUPPLEMENTAL]
        })
      });
    }
  }

  Object.defineProperties(TranslationScheduler, {
    LANES: {
      value: LANES,
      enumerable: true
    },
    DEFAULT_CONCURRENCY: {
      value: DEFAULT_CONCURRENCY,
      enumerable: true
    },
    MAX_CONCURRENCY: {
      value: MAX_CONCURRENCY,
      enumerable: true
    }
  });

  return Object.freeze({
    LANES,
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
    normalizeConcurrency,
    TranslationScheduler
  });
});
