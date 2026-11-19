/**
 * Open Immerse Translate - cancellable request deadlines.
 *
 * The helper owns the deadline while callers may still provide their own
 * cancellation signal. It settles independently of the task so a transport
 * that ignores AbortSignal cannot leave higher-level work pending forever.
 */
(function initRequestTimeout(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITRequestTimeout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRequestTimeoutApi() {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 30000;

  function createAbortError(reason) {
    const message = reason?.message || 'The operation was aborted';
    if (typeof DOMException === 'function') {
      return new DOMException(message, 'AbortError');
    }
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function createTimeoutError(message, timeoutMs) {
    const resolvedMessage = String(message || 'Request timed out');
    const error = new Error(`${resolvedMessage} after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    error.timeoutMs = timeoutMs;
    return error;
  }

  function normalizeTimeout(timeoutMs) {
    const value = Number(timeoutMs);
    return Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_TIMEOUT_MS;
  }

  function withTimeout(task, options = {}) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Timed task must be a function'));
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const callerSignal = options.signal;
    if (callerSignal?.aborted) {
      return Promise.reject(createAbortError(callerSignal.reason));
    }

    const controller = new AbortController();
    let settled = false;
    let timer = null;
    let onCallerAbort = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (callerSignal && onCallerAbort) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    };

    return new Promise((resolve, reject) => {
      const settle = callback => {
        if (settled) return false;
        settled = true;
        cleanup();
        callback();
        return true;
      };

      onCallerAbort = () => {
        const error = createAbortError(callerSignal.reason);
        if (settle(() => reject(error))) {
          controller.abort(callerSignal.reason || error);
        }
      };

      callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
      timer = setTimeout(() => {
        const error = createTimeoutError(options.message, timeoutMs);
        if (settle(() => reject(error))) {
          controller.abort(error);
        }
      }, timeoutMs);

      let taskResult;
      try {
        taskResult = task(controller.signal);
      } catch (error) {
        settle(() => reject(error));
        return;
      }

      Promise.resolve(taskResult).then(
        value => settle(() => resolve(value)),
        error => settle(() => reject(error))
      );
    });
  }

  return Object.freeze({
    DEFAULT_TIMEOUT_MS,
    createAbortError,
    createTimeoutError,
    withTimeout
  });
});
