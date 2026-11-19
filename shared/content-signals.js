/**
 * Open Immerse Translate - content signal extraction.
 *
 * This module deliberately contains no scanner state. It turns a DOM element
 * into bounded structural and prose signals so classification, filtering, and
 * root detection can share one interpretation of the page.
 */
(function initContentSignals(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentSignals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentSignals() {
  'use strict';

  const PROTECTED_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp',
    'var', 'math', '.math', 'mjx-container', 'svg', 'canvas', 'iframe',
    'input', 'textarea', 'select', 'option',
    '[contenteditable]:not([contenteditable="false"])',
    '[translate="no"]', '.notranslate', '.oit-wrapper',
    '.oit-translated-host', '.oit-translation', '.oit-original',
    '[hidden]', '[aria-hidden="true"]'
  ].join(',');

  const BLOCK_SELECTOR = 'p, blockquote, li, figcaption, dd, td, th, pre';
  const CONTROL_SELECTOR = [
    'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[contenteditable]'
  ].join(',');
  const MEDIA_SELECTOR = 'img, picture, video, audio, canvas, svg';
  const HINT_ATTRIBUTES = [
    'id', 'class', 'role', 'aria-label', 'itemprop', 'data-testid',
    'data-test-id', 'data-component-name'
  ];

  const NOISE_HINT = /\b(ad|ads|advert|advertisement|advertising|banner|cookie|login|modal|newsletter|promo|recommend|recommended|related|share|sidebar|sponsor|sponsored|subscribe|toolbar|trending|widget)\b/i;
  const UI_HINT = /\b(button|control|dropdown|filter|menu|nav|pagination|search|sort|tab|toolbar)\b/i;
  const POSITIVE_HINT = /\b(article|body|content|entry|main|markdown|post|prose|read|story|text|docs?|document)\b/i;
  const TITLE_HINT = /\b(title|headline|heading|subject|topic|thread-title|post-title)\b/i;
  const SUMMARY_HINT = /\b(summary|description|excerpt|dek|standfirst|lead|subtitle|sub-title)\b/i;
  const CARD_HINT = /\b(card|result|search-result|story-card|product|listing|item)\b/i;
  const FORUM_HINT = /\b(forum|thread|topic|discussion|community|question|answer|reply)\b/i;
  const URL_ONLY_PATTERN = /^(?:https?:\/\/|www\.|mailto:|[\w.+-]+@[\w.-]+\.\w+)(?:\S*)$/i;
  const SENTENCE_PATTERN = /[.!?\u3002\uff01\uff1f\u2026]+/g;
  const LATIN_WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hasLexicalText(value) {
    return /\p{L}/u.test(normalizeText(value));
  }

  function getClassText(element) {
    const value = element?.className;
    if (typeof value === 'string') return value;
    return value?.baseVal || '';
  }

  function getStructuralHint(element) {
    if (!element || element.nodeType !== 1) return '';
    return HINT_ATTRIBUTES
      .map(name => name === 'class' ? getClassText(element) : element.getAttribute?.(name))
      .filter(Boolean)
      .join(' ');
  }

  function getStructuralSignals(element) {
    const hint = normalizeText(getStructuralHint(element));
    const tag = String(element?.tagName || '').toLowerCase();
    const role = String(element?.getAttribute?.('role') || '').toLowerCase();
    const classText = getClassText(element);
    const textualTag = /^(p|blockquote|li|dd|dt|td|th|caption|figcaption)$/.test(tag);

    return Object.freeze({
      tag,
      role,
      hint,
      positive: POSITIVE_HINT.test(hint),
      noiseScore: NOISE_HINT.test(hint) ? 1 : 0,
      uiScore: UI_HINT.test(hint) ? 1 : 0,
      title: TITLE_HINT.test(hint) || /^h[1-6]$/.test(tag) || role === 'heading',
      summary: SUMMARY_HINT.test(hint),
      card: CARD_HINT.test(hint),
      forum: FORUM_HINT.test(hint),
      elementProse: !textualTag
        && Boolean(classText.trim())
        && !NOISE_HINT.test(hint)
        && !UI_HINT.test(hint)
        && !TITLE_HINT.test(hint)
        && !SUMMARY_HINT.test(hint)
    });
  }

  function getVisibleText(element) {
    if (!element || element.nodeType !== 1) return '';
    const copy = element.cloneNode(true);
    copy.querySelectorAll?.(PROTECTED_SELECTOR).forEach(node => node.remove());
    if (copy.matches?.(PROTECTED_SELECTOR)) return '';
    return normalizeText(copy.textContent);
  }

  function countLinks(element) {
    return Array.from(element?.querySelectorAll?.('a[href]') || []);
  }

  function countControls(element) {
    return Array.from(element?.querySelectorAll?.(CONTROL_SELECTOR) || []);
  }

  function getTextSignals(element) {
    const text = getVisibleText(element);
    const links = countLinks(element);
    const controls = countControls(element);
    const linkTextLength = links.reduce(
      (total, link) => total + getVisibleText(link).length,
      0
    );
    const blocks = Array.from(element?.querySelectorAll?.(BLOCK_SELECTOR) || []);
    const textBlockLength = blocks.reduce(
      (total, block) => total + getVisibleText(block).length,
      0
    );
    const latinWords = text.match(LATIN_WORD_PATTERN) || [];
    const cjkCharacters = text.match(CJK_PATTERN) || [];
    const sentenceCount = (text.match(SENTENCE_PATTERN) || []).length;
    const paragraphCount = blocks.length;
    const headingCount = element?.querySelectorAll?.(
      'h1, h2, h3, h4, h5, h6, [role="heading"]'
    ).length || 0;
    const mediaCount = element?.querySelectorAll?.(MEDIA_SELECTOR).length || 0;

    return Object.freeze({
      text,
      length: text.length,
      latinWordCount: latinWords.length,
      cjkCount: cjkCharacters.length,
      wordCount: latinWords.length + cjkCharacters.length,
      sentenceCount,
      paragraphCount,
      headingCount,
      textBlockLength,
      linkCount: links.length,
      linkTextLength,
      linkDensity: text.length > 0 ? linkTextLength / text.length : 0,
      controlCount: controls.length,
      interactiveCount: links.length + controls.length,
      mediaCount,
      urlOnly: URL_ONLY_PATTERN.test(text)
    });
  }

  function getProseEvidence(signals) {
    if (!signals || signals.length < 2 || signals.urlOnly) {
      return Object.freeze({
        level: 'none',
        score: 0,
        reasons: Object.freeze([])
      });
    }

    const reasons = [];
    let score = 0;
    if (signals.latinWordCount >= 18) {
      score += 2;
      reasons.push('words');
    } else if (signals.latinWordCount >= 7) {
      score += 1;
      reasons.push('short-words');
    }
    if (signals.cjkCount >= 30) {
      score += 2;
      reasons.push('cjk-text');
    } else if (signals.cjkCount >= 12) {
      score += 1;
      reasons.push('short-cjk-text');
    }
    if (signals.sentenceCount >= 2) {
      score += 2;
      reasons.push('sentences');
    } else if (signals.sentenceCount === 1) {
      score += 1;
      reasons.push('sentence');
    }
    if (signals.paragraphCount >= 2) {
      score += 2;
      reasons.push('paragraphs');
    } else if (signals.paragraphCount === 1 && signals.textBlockLength >= 60) {
      score += 1;
      reasons.push('text-block');
    }
    if (signals.linkDensity >= 0.75) score -= 3;

    const level = score >= 4 ? 'strong' : score >= 2 ? 'weak' : 'none';
    return Object.freeze({ level, score, reasons: Object.freeze(reasons) });
  }

  function isLikelyLinkFarm(signals) {
    if (!signals || signals.length < 12 || signals.linkCount < 2) return false;
    return signals.linkDensity >= 0.72
      || (signals.linkDensity >= 0.55 && signals.sentenceCount === 0);
  }

  function hasSentenceSignal(signals) {
    return Boolean(signals && (signals.sentenceCount > 0
      || signals.paragraphCount > 1
      || signals.cjkCount >= 20));
  }

  return Object.freeze({
    PROTECTED_SELECTOR,
    normalizeText,
    hasLexicalText,
    getStructuralHint,
    getStructuralSignals,
    getVisibleText,
    getTextSignals,
    getProseEvidence,
    isLikelyLinkFarm,
    hasSentenceSignal
  });
});
