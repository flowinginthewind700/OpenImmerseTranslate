/**
 * Open Immerse Translate - request scheduling primitives.
 *
 * This module is dependency-free so it can run in the MV3 worker and in
 * browser-based kernel tests. Waiting requests are cancellable to prevent
 * stale page batches from occupying queue slots after navigation.
 */
(function initRateLimiter(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITRateLimiter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRateLimiterApi() {
  'use strict';

  function createAbortError(reason) {
    if (typeof DOMException === 'function') {
      return new DOMException('The operation was aborted', 'AbortError');
    }
    const error = new Error(reason?.message || 'The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return error?.name === 'AbortError'
      || (typeof error?.message === 'string'
        && error.message.toLowerCase().includes('abort'));
  }

  function clampMaxConcurrent(value, fallback = 6) {
    const number = parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(12, Math.max(1, number));
  }

  function isRetryableRateLimit(error) {
    if (!error?.message) return false;
    const message = error.message.toLowerCase();
    return message.includes('concurrency')
      || message.includes('rate limit')
      || message.includes('too many requests')
      || message.includes('429');
  }

  function sleep(milliseconds, signal) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }

    const delay = Math.max(0, Number(milliseconds) || 0);
    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(createAbortError(signal.reason));
      };

      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  class RateLimiter {
    constructor(maxConcurrent = 6, minInterval = 300, options = {}) {
      this.maxConcurrent = clampMaxConcurrent(maxConcurrent);
      this.minInterval = Math.max(0, Number(minInterval) || 0);
      this.activeRequests = 0;
      this.lastRequestTime = 0;
      this.waitQueue = [];
      this.timer = null;
      this.now = typeof options.now === 'function' ? options.now : Date.now;
      this.setTimeoutFn = typeof options.setTimeout === 'function'
        ? options.setTimeout
        : (callback, delay) => setTimeout(callback, delay);
      this.clearTimeoutFn = typeof options.clearTimeout === 'function'
        ? options.clearTimeout
        : timer => clearTimeout(timer);
    }

    acquire(signal) {
      if (signal?.aborted) {
        return Promise.reject(createAbortError(signal.reason));
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          signal,
          onAbort: null,
          granted: false
        };

        if (signal) {
          waiter.onAbort = () => {
            if (waiter.granted) return;
            waiter.cancelled = true;
            reject(createAbortError(signal.reason));
            this._drain();
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }

        this.waitQueue.push(waiter);
        this._drain();
      });
    }

    release() {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      this._drain();
    }

    applyConfig(config) {
      this.maxConcurrent = clampMaxConcurrent(
        config?.maxConcurrent,
        this.maxConcurrent
      );
      this._drain();
    }

    _cancelTimer() {
      if (this.timer !== null) {
        this.clearTimeoutFn(this.timer);
        this.timer = null;
      }
    }

    _drain() {
      this._cancelTimer();

      while (this.waitQueue.length > 0 && this.waitQueue[0].cancelled) {
        this.waitQueue.shift();
      }

      if (this.waitQueue.length === 0 || this.activeRequests >= this.maxConcurrent) {
        return;
      }

      const elapsed = this.now() - this.lastRequestTime;
      const remainingInterval = this.minInterval - elapsed;
      if (remainingInterval > 0) {
        this.timer = this.setTimeoutFn(() => {
          this.timer = null;
          this._drain();
        }, remainingInterval + 1);
        return;
      }

      const waiter = this.waitQueue.shift();
      waiter.granted = true;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      this.activeRequests++;
      this.lastRequestTime = this.now();
      waiter.resolve();
      this._drain();
    }
  }

  async function withRetry(task, options = {}) {
    const retryCount = Math.floor(Number(options.maxRetries));
    const maxRetries = Number.isFinite(retryCount) ? Math.max(1, retryCount) : 3;
    const baseDelay = Math.max(0, Number(options.baseDelay) || 2000);
    const sleepFn = typeof options.sleep === 'function' ? options.sleep : sleep;
    const shouldRetry = typeof options.shouldRetry === 'function'
      ? options.shouldRetry
      : isRetryableRateLimit;
    const signal = options.signal;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (signal?.aborted) {
        throw createAbortError(signal.reason);
      }
      try {
        return await task({ attempt, signal });
      } catch (error) {
        lastError = error;
        if (isAbortError(error) || !shouldRetry(error) || attempt >= maxRetries - 1) {
          throw error;
        }
        await sleepFn(baseDelay * Math.pow(2, attempt), signal);
      }
    }

    throw lastError;
  }

  return Object.freeze({
    RateLimiter,
    clampMaxConcurrent,
    createAbortError,
    isAbortError,
    isRetryableRateLimit,
    sleep,
    withRetry
  });
});
