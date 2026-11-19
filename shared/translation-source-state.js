/**
 * Open Immerse Translate - translation source generation guard.
 *
 * Site frameworks can replace source text while a provider request is in
 * flight. A response may only update the DOM when it still belongs to the
 * current source generation and normalized text.
 */
(function initTranslationSourceState(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationSourceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTranslationSourceState() {
  'use strict';

  function createSourceStateStore() {
    const revisions = new WeakMap();

    function getState(element) {
      let sourceState = revisions.get(element);
      if (!sourceState) {
        sourceState = { revision: 0 };
        revisions.set(element, sourceState);
      }
      return sourceState;
    }

    function capture(element, fingerprint = '') {
      if (!element || element.nodeType !== 1) return null;
      const sourceState = getState(element);
      return Object.freeze({
        element,
        revision: sourceState.revision,
        fingerprint: String(fingerprint ?? '')
      });
    }

    function invalidate(element) {
      if (!element || element.nodeType !== 1) return 0;
      const sourceState = getState(element);
      sourceState.revision++;
      return sourceState.revision;
    }

    function isCurrent(snapshot, fingerprint = snapshot?.fingerprint) {
      if (!snapshot?.element?.isConnected || snapshot.element.nodeType !== 1) {
        return false;
      }
      const sourceState = getState(snapshot.element);
      return sourceState.revision === snapshot.revision
        && String(fingerprint ?? '') === snapshot.fingerprint;
    }

    return Object.freeze({
      capture,
      invalidate,
      isCurrent
    });
  }

  return Object.freeze({
    createSourceStateStore
  });
});
