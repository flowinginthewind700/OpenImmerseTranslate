/**
 * Open Immerse Translate - subtitle translation orchestration.
 *
 * This controller owns batching, result validation, partial failure handling,
 * cancellation, and progress events. Transport and rendering remain injected
 * so the same workflow can be exercised without an extension runtime.
 */
(function initSubtitleController(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITSubtitleController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSubtitleControllerApi() {
  'use strict';

  function createAbortError(message = 'Subtitle translation cancelled') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
  }

  function createRequestId(prefix, batchIndex) {
    const random = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${batchIndex + 1}-${random}`;
  }

  function createSubtitleTranslationController(options = {}) {
    const createBatches = options.createBatches
      || globalThis.OITSubtitleCore?.createTranslationBatches;
    if (typeof createBatches !== 'function') {
      throw new Error('Subtitle controller requires createBatches');
    }
    if (typeof options.translateBatch !== 'function') {
      throw new Error('Subtitle controller requires translateBatch');
    }

    const translateBatch = options.translateBatch;
    const abortRequest = typeof options.abortRequest === 'function'
      ? options.abortRequest
      : () => false;
    const logger = options.logger || console;
    let activeJob = null;

    function emit(callback, event) {
      if (typeof callback !== 'function') return;
      try {
        callback(event);
      } catch (error) {
        logger.warn?.('[OpenImmerseTranslate] Subtitle progress callback failed:', error);
      }
    }

    function validateBatchResponse(translations, batch) {
      if (!Array.isArray(translations) || translations.length !== batch.length) {
        throw new Error(
          `Translation result count mismatch: expected ${batch.length}, `
          + `received ${Array.isArray(translations) ? translations.length : 0}`,
        );
      }

      translations.forEach((translation, index) => {
        if (typeof translation !== 'string' || !translation.trim()) {
          throw new Error(`Translation result ${index + 1} is empty or invalid`);
        }
      });
    }

    async function translate(sourceSegments, translateOptions = {}) {
      if (activeJob) {
        throw new Error('A subtitle translation is already running');
      }

      const segments = (Array.isArray(sourceSegments) ? sourceSegments : []).map(
        segment => ({ ...segment, translatedText: String(segment?.translatedText || '') }),
      );
      const job = {
        controller: new AbortController(),
        currentRequestId: '',
      };
      activeJob = job;

      const externalSignal = translateOptions.signal;
      const forwardAbort = () => job.controller.abort(externalSignal.reason);
      if (externalSignal) {
        if (externalSignal.aborted) {
          job.controller.abort(externalSignal.reason);
        } else {
          externalSignal.addEventListener('abort', forwardAbort, { once: true });
        }
      }

      const signal = job.controller.signal;
      const onProgress = translateOptions.onProgress || options.onProgress;
      const onBatchError = translateOptions.onBatchError || options.onBatchError;
      const continueOnError = translateOptions.continueOnError
        ?? options.continueOnError
        ?? false;
      const requestPrefix = translateOptions.requestIdPrefix || 'subtitle';
      const failures = [];
      let completedBatches = 0;
      let processedBatches = 0;
      let translatedCount = 0;
      let totalBatches = 0;
      let sawAbort = false;

      try {
        const batches = createBatches(segments, translateOptions.batchOptions || {});
        if (!Array.isArray(batches)) {
          throw new Error('Subtitle batch factory must return an array');
        }
        totalBatches = batches.length;
        emit(onProgress, {
          type: 'start',
          totalBatches,
          totalSegments: segments.length,
        });

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          if (signal.aborted) break;

          const batch = Array.isArray(batches[batchIndex]) ? batches[batchIndex] : [];
          if (batch.length === 0) continue;

          const requestId = createRequestId(requestPrefix, batchIndex);
          job.currentRequestId = requestId;

          try {
            const translations = await translateBatch(
              batch.map(segment => segment.sourceText),
              {
                requestId,
                batchIndex,
                totalBatches,
                signal,
                context: translateOptions.context || {},
              },
            );

            if (signal.aborted) break;
            validateBatchResponse(translations, batch);

            batch.forEach((sourceSegment, itemIndex) => {
              const target = segments.find(segment => segment.id === sourceSegment.id);
              if (!target) {
                throw new Error(`Unable to map translated segment ${sourceSegment.id}`);
              }
              target.translatedText = translations[itemIndex].trim();
            });

            completedBatches++;
            processedBatches++;
            translatedCount += batch.length;
            const progress = {
              type: 'batch-complete',
              batchIndex,
              completedBatches,
              processedBatches,
              totalBatches,
              translatedCount,
              totalSegments: segments.length,
              translatedItems: batch.map((sourceSegment, itemIndex) => ({
                id: sourceSegment.id,
                translatedText: translations[itemIndex].trim(),
              })),
            };
            emit(onProgress, progress);
            emit(translateOptions.onBatchComplete || options.onBatchComplete, progress);
          } catch (error) {
            if (signal.aborted || isAbortError(error)) {
              sawAbort = true;
              break;
            }

            const failure = {
              batchIndex,
              requestId,
              error,
              message: error?.message || String(error),
            };
            failures.push(failure);
            processedBatches++;
            const errorEvent = {
              ...failure,
              completedBatches,
              processedBatches,
              totalBatches,
              translatedCount,
              totalSegments: segments.length,
            };
            emit(onProgress, { ...errorEvent, type: 'batch-error' });
            emit(onBatchError, errorEvent);

            if (!continueOnError) {
              emit(onProgress, {
                type: 'error',
                error,
                message: failure.message,
                completedBatches,
                totalBatches,
              });
              throw error;
            }
          } finally {
            job.currentRequestId = '';
          }
        }

        const result = {
          segments,
          failures,
          translatedCount,
          completedBatches,
          processedBatches,
          totalBatches,
          cancelled: signal.aborted || sawAbort,
        };
        emit(onProgress, { ...result, type: result.cancelled ? 'cancelled' : 'complete' });
        return result;
      } finally {
        if (externalSignal) {
          externalSignal.removeEventListener('abort', forwardAbort);
        }
        if (activeJob === job) activeJob = null;
      }
    }

    function cancel(reason = 'user') {
      if (!activeJob) return false;
      activeJob.controller.abort(reason);
      if (activeJob.currentRequestId) {
        try {
          abortRequest(activeJob.currentRequestId);
        } catch (error) {
          logger.warn?.(
            '[OpenImmerseTranslate] Subtitle request cancellation integration failed:',
            error,
          );
        }
      }
      return true;
    }

    return Object.freeze({
      translate,
      cancel,
      isTranslating: () => activeJob !== null,
    });
  }

  return Object.freeze({
    createAbortError,
    isAbortError,
    createSubtitleTranslationController,
  });
});
