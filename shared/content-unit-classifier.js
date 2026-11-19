/**
 * Open Immerse Translate - semantic content unit classifier.
 *
 * The classifier labels a candidate for prompt context and batching. Filtering
 * policy remains separate so classification can be inspected without silently
 * removing content.
 */
(function initContentUnitClassifier(root, factory) {
  const signals = root.OITContentSignals
    || (typeof require === 'function' ? require('./content-signals.js') : null);
  const api = factory(signals);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentUnitClassifier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentUnitClassifier(signals) {
  'use strict';

  if (!signals) {
    throw new Error('OIT content signals must load before content-unit-classifier.js');
  }

  const META_HINT = /\b(meta|metadata|byline|dateline|caption-credit|tag|tags|category|categories|replies|views?|activity|avatar|timestamp|date|score|stats?|count)\b/i;
  const FORUM_CONTEXT_SELECTOR = [
    '[class*="forum"]', '[class*="thread"]', '[class*="topic"]',
    '[class*="discussion"]', '[class*="community"]', '[data-testid*="post"]'
  ].join(',');
  const CONTROL_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]', '[role="tab"]'
  ].join(',');

  function clampConfidence(value) {
    return Math.max(0.05, Math.min(1, Number(value) || 0.05));
  }

  function result(kind, role, confidence, reasons) {
    return Object.freeze({
      kind,
      role,
      confidence: clampConfidence(confidence),
      reasons: Object.freeze(reasons.filter(Boolean))
    });
  }

  function hasNearbyHeading(element) {
    if (!element?.parentElement) return false;
    const siblings = Array.from(element.parentElement.children);
    const index = siblings.indexOf(element);
    for (let cursor = index - 1; cursor >= 0 && cursor >= index - 2; cursor--) {
      if (siblings[cursor].matches?.('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
        return true;
      }
      if (signals.normalizeText(siblings[cursor].textContent).length > 0) break;
    }
    return false;
  }

  function hasTitleRegion(element) {
    if (element.matches?.('h1, h2, h3, h4, h5, h6, [role="heading"]')) return true;
    if (element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')) return true;
    return Array.from(element.children || []).some(child => {
      return signals.getStructuralSignals(child).title;
    });
  }

  function hasForumContext(element) {
    if (element.closest?.(FORUM_CONTEXT_SELECTOR)) return true;
    const article = element.closest?.('article');
    return Boolean(article && signals.getStructuralSignals(article).forum);
  }

  function isMetadata(element, textSignals, hintSignals, proseEvidence) {
    if (!textSignals.text || textSignals.length > 180) return false;
    if (element.matches?.('time, [datetime], [itemprop="datePublished"]')) return true;
    if (proseEvidence?.level !== 'none' && textSignals.length >= 80) return false;
    if (/\b\d+(?:\.\d+)?\s*(?:replies?|views?|comments?|likes?|votes?|points?)\b/i
      .test(textSignals.text)) {
      return true;
    }
    if (!META_HINT.test(hintSignals.hint)) return false;
    return textSignals.sentenceCount === 0
      || textSignals.length <= 80
      || textSignals.linkCount > 0 && textSignals.linkDensity > 0.4;
  }

  function classifyContentUnit(element, options = {}) {
    if (!element || element.nodeType !== 1) {
      return result('unknown', 'paragraph', 0.05, ['missing-element']);
    }

    const textSignals = options.textSignals || signals.getTextSignals(element);
    const hintSignals = options.hintSignals || signals.getStructuralSignals(element);
    const prose = options.proseEvidence || signals.getProseEvidence(textSignals);
    const tag = hintSignals.tag;
    const forumContext = hasForumContext(element);

    if (element.matches?.(CONTROL_SELECTOR)
        || element.closest?.('button, [role="button"]')) {
      return result('ui', 'control', 1, ['interactive-control']);
    }

    if (isMetadata(element, textSignals, hintSignals, prose)) {
      return result('metadata', 'metadata', META_HINT.test(hintSignals.hint) ? 1 : 0.9, [
        'metadata-hint',
        'short-structured-text'
      ]);
    }

    if (element.matches?.('nav, footer, aside, form, dialog')
        || /^(navigation|menu|menubar|toolbar|dialog)$/.test(hintSignals.role)) {
      return result('noise', 'ui', 1, ['structural-shell']);
    }

    if (/^h[1-6]$/.test(tag) || hintSignals.role === 'heading' || hintSignals.title) {
      if (forumContext && (hintSignals.forum || /thread|topic|question/i.test(hintSignals.hint))) {
        return result('forum-topic', 'title', 0.96, ['heading', 'forum-context']);
      }
      return result('title', 'title', 1, ['heading']);
    }

    if (forumContext && (hintSignals.summary
        || (['p', 'blockquote'].includes(tag) && hasNearbyHeading(element)))) {
      return result('forum-excerpt', 'summary', 0.9, [
        'forum-context',
        hintSignals.summary ? 'summary-hint' : 'nearby-heading'
      ]);
    }

    if (hintSignals.summary && (hasNearbyHeading(element) || element.matches?.('figcaption'))) {
      return result('subtitle', 'summary', 0.84, ['summary-hint', 'nearby-heading']);
    }

    if ((hintSignals.card || element.matches?.('a[href]'))
        && hasTitleRegion(element)
        && textSignals.length <= 800) {
      return result('content-card', 'paragraph', 0.88, ['card-structure', 'heading']);
    }

    if (element.matches?.('figcaption, summary, legend')) {
      return result('summary', 'summary', 0.78, ['semantic-summary']);
    }
    if (tag === 'li' || hintSignals.role === 'listitem') {
      return result('list-item', 'list-item', 0.84, ['list-structure']);
    }
    if (['td', 'th', 'caption', 'dt', 'dd', 'label'].includes(tag)) {
      return result('label', 'label', 0.86, ['label-structure']);
    }
    if (prose.level === 'strong' || (tag === 'p' && prose.level !== 'none')) {
      return result('paragraph', 'paragraph', prose.level === 'strong' ? 0.9 : 0.72, [
        'prose',
        ...prose.reasons.slice(0, 2)
      ]);
    }
    if (hintSignals.noiseScore || hintSignals.uiScore || textSignals.interactiveCount > 0) {
      return result('noise', 'ui', 0.72, ['sparse-interactive-content']);
    }

    return result('paragraph', 'paragraph', prose.level === 'weak' ? 0.62 : 0.35, [
      prose.level === 'weak' ? 'weak-prose' : 'fallback-text'
    ]);
  }

  return Object.freeze({
    classifyContentUnit,
    isMetadata
  });
});
