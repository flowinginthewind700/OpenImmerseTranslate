/**
 * Open Immerse Translate - three-way page content filtering.
 *
 * Decisions distinguish an element that is itself disposable from a shell
 * whose entire subtree should be skipped. That gives traversal code enough
 * information to avoid both over-filtering prose and wasting work in page
 * chrome.
 */
(function initContentFilter(root, factory) {
  const signals = root.OITContentSignals
    || (typeof require === 'function' ? require('./content-signals.js') : null);
  const classifier = root.OITContentUnitClassifier
    || (typeof require === 'function' ? require('./content-unit-classifier.js') : null);
  const uiPolicy = root.OITContentUiPolicy
    || (typeof require === 'function' ? require('./content-ui-policy.js') : null);
  const api = factory(signals, classifier, uiPolicy);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentFilter = api;
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function createContentFilter(signals, classifier, uiPolicy) {
  'use strict';

  if (!signals || !classifier || !uiPolicy) {
    throw new Error(
      'Content signals, classifier, and UI policy must load before content-filter.js'
    );
  }

  const SHELL_SELECTOR = [
    'nav', 'aside', 'footer', 'form', 'dialog',
    '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
    '[role="dialog"]', '[role="alertdialog"]'
  ].join(',');
  const HARD_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD',
    'PRE', 'CODE', 'KBD', 'SAMP', 'VAR', 'MATH', 'SVG', 'CANVAS',
    'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'INPUT', 'TEXTAREA', 'SELECT',
    'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'MAP', 'AREA'
  ]);
  function makeDecision(action, reason, confidence, details = {}) {
    return Object.freeze({
      action,
      reason,
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      ...details
    });
  }

  function isHidden(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.hasAttribute?.('hidden')
          || current.getAttribute?.('aria-hidden') === 'true'
          || current.closest?.('details:not([open]) > :not(summary)')) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function isProtected(element) {
    return HARD_SKIP_TAGS.has(element.tagName)
      || Boolean(element.closest?.(signals.PROTECTED_SELECTOR));
  }

  function decidesWholeSubtree(element, scope) {
    return scope !== 'full' && (
      element.matches?.(SHELL_SELECTOR)
      || /^(navigation|complementary|contentinfo|dialog|alertdialog)$/
        .test(element.getAttribute?.('role') || '')
    );
  }

  function decideContentFilter(element, options = {}) {
    if (!element || element.nodeType !== 1) {
      return makeDecision('skip-subtree', 'missing-element', 1);
    }
    const scope = options.scope === 'full' ? 'full' : 'smart';
    const textSignals = options.textSignals || signals.getTextSignals(element);
    const hintSignals = options.hintSignals || signals.getStructuralSignals(element);
    const classification = options.classification || classifier.classifyContentUnit(element, {
      textSignals,
      hintSignals,
      proseEvidence: options.proseEvidence
    });

    if (isHidden(element) || isProtected(element)) {
      return makeDecision('skip-subtree', 'hidden-or-protected', 1, { classification });
    }
    if (!textSignals.text
        || textSignals.length < 2
        || textSignals.urlOnly
        || !signals.hasLexicalText(textSignals.text)) {
      return makeDecision('skip-self', 'non-lexical-text', 1, { classification });
    }

    if (element.matches?.('time, [datetime], [role="timer"]')) {
      return makeDecision('skip-self', 'date-or-time', 1, { classification });
    }

    if (scope === 'full') {
      return makeDecision('keep', 'full-scope-visible-text', 1, { classification });
    }

    const adaptiveLabel = options.adaptiveUiLabel === undefined
      ? options.adaptiveUi === true && uiPolicy.isAdaptiveUiLabel(element)
      : options.adaptiveUiLabel === true;
    if (adaptiveLabel) {
      return makeDecision('keep', 'adaptive-interface-label', 0.98, { classification });
    }

    if (options.supplementalContent === true) {
      return makeDecision('keep', 'site-supplemental-content', 1, {
        classification
      });
    }

    if (decidesWholeSubtree(element, scope)) {
      return makeDecision('skip-subtree', 'page-shell', 1, { classification });
    }
    if (element.closest?.(SHELL_SELECTOR)) {
      return makeDecision('skip-self', 'inside-page-shell', 0.96, { classification });
    }

    if (classification.kind === 'metadata') {
      return makeDecision('skip-self', 'metadata', classification.confidence, { classification });
    }
    if (classification.kind === 'ui') {
      return makeDecision('skip-self', 'interactive-label', classification.confidence, {
        classification
      });
    }

    const trusted = options.trustedContentRoot === true;
    const linkedHeading = hintSignals.title
      && textSignals.linkDensity >= 0.75
      && textSignals.length <= 240;
    if (linkedHeading && !trusted) {
      return makeDecision('skip-self', 'untrusted-linked-heading', 0.9, { classification });
    }

    if (signals.isLikelyLinkFarm(textSignals) && !trusted) {
      return makeDecision('skip-self', 'link-farm', 0.96, { classification });
    }

    const structuralNoise = hintSignals.noiseScore > 0
      && textSignals.length < 240
      && !signals.hasSentenceSignal(textSignals)
      && textSignals.linkDensity > 0.12;
    if (structuralNoise) {
      return makeDecision('skip-self', 'noise-shell', 0.9, { classification });
    }

    return makeDecision('keep', classification.kind, 1 - (1 - classification.confidence) / 2, {
      classification
    });
  }

  return Object.freeze({
    SHELL_SELECTOR,
    decideContentFilter
  });
  }
);
