/**
 * Open Immerse Translate - primary reading root detection.
 *
 * The detector combines conservative semantic fast paths with a bottom-up
 * prose score and content-shell promotion. It returns diagnostics instead of
 * hiding why a root won, which makes regressions testable.
 */
(function initContentRootDetector(root, factory) {
  const signals = root.OITContentSignals
    || (typeof require === 'function' ? require('./content-signals.js') : null);
  const classifier = root.OITContentUnitClassifier
    || (typeof require === 'function' ? require('./content-unit-classifier.js') : null);
  const api = factory(signals, classifier);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentRootDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentRootDetector(
  signals,
  classifier
) {
  'use strict';

  if (!signals || !classifier) {
    throw new Error('Content signals and classifier must load before content-root-detector.js');
  }

  const SEMANTIC_ROOT_SELECTOR = [
    'main', '[role="main"]', 'article', '[role="article"]',
    '[itemprop="articleBody"]'
  ].join(',');
  const CONTENT_ROOT_SELECTOR = [
    SEMANTIC_ROOT_SELECTOR,
    '[class*="article-body"]', '[class*="articleBody"]',
    '[class*="post-content"]', '[class*="postContent"]',
    '[class*="entry-content"]', '[class*="entryContent"]',
    '[class*="story-body"]', '[class*="storyBody"]',
    '[class*="markdown-body"]', '[class*="prose"]',
    '[class*="article"]', '[class*="story"]', '[class*="content"]',
    'section', 'div'
  ].join(',');
  const EXCLUDED_ROOT_ANCESTOR = 'nav, aside, footer, form, dialog';
  const POSITIVE_HINT = /\b(article|body|content|entry|main|markdown|post|prose|read|story|text|docs?|document)\b/i;
  const MIN_PROSE_LENGTH = 40;
  const TRUST_SCORE = 150;

  function getDocument(element) {
    return element?.ownerDocument || document;
  }

  function isVisibleByDefault(element) {
    if (!element?.isConnected || element.getClientRects?.().length === 0) return false;
    const view = getDocument(element).defaultView;
    const style = view?.getComputedStyle?.(element);
    return !style
      || (style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse');
  }

  function createAnalysis(element, options) {
    const textSignals = signals.getTextSignals(element);
    const hintSignals = signals.getStructuralSignals(element);
    const proseEvidence = signals.getProseEvidence(textSignals);
    const linkFarm = signals.isLikelyLinkFarm(textSignals);
    const elementRole = element.getAttribute?.('role') || '';
    const semantic = element.matches?.(SEMANTIC_ROOT_SELECTOR)
      || /^(main|article)$/i.test(elementRole);
    let score = 0;

    score += Math.min(textSignals.length, 12000) * 0.055;
    score += Math.min(textSignals.textBlockLength, 8000) * 0.32;
    score += Math.min(textSignals.sentenceCount, 80) * 17;
    score += Math.min(textSignals.paragraphCount, 60) * 30;
    score += Math.min(textSignals.headingCount, 16) * 12;
    score += proseEvidence.score * 24;
    if (semantic) score += element.matches?.('article, [role="article"]') ? 180 : 220;
    if (POSITIVE_HINT.test(hintSignals.hint)) score += 80;
    if (hintSignals.card) score -= 70;
    if (linkFarm) score -= Math.max(180, textSignals.length * 1.4);
    score -= textSignals.controlCount * 12;

    return Object.freeze({
      element,
      textSignals,
      hintSignals,
      proseEvidence,
      linkFarm,
      semantic,
      score
    });
  }

  function isNormalSemanticCandidate(analysis) {
    return analysis.textSignals.length >= MIN_PROSE_LENGTH
      && analysis.proseEvidence.level !== 'none'
      && !analysis.linkFarm
      && analysis.textSignals.linkDensity < 0.68;
  }

  function getUniqueSemanticAnalyses(base, options, selector, predicate) {
    const doc = getDocument(base);
    const isVisible = options.isVisible || isVisibleByDefault;
    const isOwned = options.isOwned || (() => false);
    return Array.from(doc.querySelectorAll?.(selector) || [])
      .filter(element => {
        if (!isVisible(element) || isOwned(element)) return false;
        if (element.closest?.(EXCLUDED_ROOT_ANCESTOR)) return false;
        if (!predicate(element)) return false;
        return !element.parentElement?.closest?.(
          'article, [role="article"], [itemprop="articleBody"]'
        );
      })
      .map(element => createAnalysis(element, options));
  }

  function findPreferredMain(article) {
    let current = article?.parentElement;
    while (current && current !== article.ownerDocument?.body) {
      if (current.matches?.('main, [role="main"]')) return current;
      current = current.parentElement;
    }
    return null;
  }

  function hasCompetingProseRegion(base, article, options) {
    const doc = getDocument(base);
    const isVisible = options.isVisible || isVisibleByDefault;
    const isOwned = options.isOwned || (() => false);
    const limit = Math.max(1, Number(options.candidateLimit) || 600);
    const elements = Array.from(doc.querySelectorAll?.(
      `${CONTENT_ROOT_SELECTOR}, p, blockquote`
    ) || []).slice(0, limit);

    return elements.some(element => {
      if (element === article || article.contains(element) || element.contains(article)) {
        return false;
      }
      if (!isVisible(element) || isOwned(element)) return false;
      if (element.closest?.(EXCLUDED_ROOT_ANCESTOR)) return false;
      const analysis = createAnalysis(element, options);
      return analysis.textSignals.length >= MIN_PROSE_LENGTH
        && analysis.proseEvidence.level !== 'none'
        && !analysis.linkFarm
        && analysis.textSignals.linkDensity < 0.68;
    });
  }

  function isPromotableShell(shell, bodyAnalysis, options) {
    if (!shell || !bodyAnalysis || shell === shell.ownerDocument?.body) return false;
    const shellSignals = signals.getTextSignals(shell);
    if (shellSignals.linkDensity >= 0.45 || shellSignals.length > 24000) return false;
    if (shell.children.length > 8) return false;

    const heading = shell.querySelector?.('h1, h2, h3, [role="heading"]');
    const titleRegion = Array.from(shell.children).some(child => {
      const childSignals = signals.getStructuralSignals(child);
      return childSignals.title || childSignals.positive;
    });
    const bodyContained = bodyAnalysis.element === shell
      || bodyAnalysis.element.parentElement === shell
      || shell.contains(bodyAnalysis.element);
    return bodyContained
      && bodyAnalysis.proseEvidence.level === 'strong'
      && Boolean(heading || titleRegion);
  }

  function findPromotedShell(bodyAnalysis, analyses, options) {
    const byElement = new Map(analyses.map(item => [item.element, item]));
    let parent = bodyAnalysis.element.parentElement;
    while (parent && parent !== parent.ownerDocument?.body) {
      const parentAnalysis = byElement.get(parent)
        || createAnalysis(parent, options);
      if (isPromotableShell(parent, bodyAnalysis, options)) {
        return parentAnalysis;
      }
      if (parentAnalysis.semantic || parentAnalysis.textSignals.length > 24000) break;
      parent = parent.parentElement;
    }
    return null;
  }

  function selectIndependentContentRoots(root, analyses, options = {}) {
    const fallback = options.fallback || document.body;
    const primary = root || fallback;
    if (primary === fallback || primary === primary.ownerDocument?.body) {
      return [primary];
    }

    const selected = [primary];
    const candidates = analyses
      .filter(analysis => (
        analysis.semantic
        && analysis.element !== primary
        && analysis.textSignals.length >= MIN_PROSE_LENGTH
        && analysis.proseEvidence.level !== 'none'
        && !analysis.linkFarm
        && analysis.textSignals.linkDensity < 0.68
      ))
      .sort((left, right) => right.score - left.score);

    for (const candidate of candidates) {
      if (selected.some(existing => (
        existing.contains(candidate.element) || candidate.element.contains(existing)
      ))) {
        continue;
      }
      selected.push(candidate.element);
      if (selected.length >= 8) break;
    }
    return selected;
  }

  function toResult(root, strategy, trusted, analyses, options = {}) {
    const resolvedRoot = root || options.fallback || document.body;
    const ranked = analyses
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map(item => Object.freeze({
        element: item.element,
        score: Math.round(item.score * 100) / 100,
        evidence: item.proseEvidence.level,
        linkDensity: Math.round(item.textSignals.linkDensity * 1000) / 1000
      }));
    const roots = selectIndependentContentRoots(resolvedRoot, analyses, options);
    return Object.freeze({
      root: resolvedRoot,
      roots: Object.freeze(roots),
      strategy,
      trusted,
      confidence: trusted ? 0.9 : 0.5,
      candidates: Object.freeze(ranked)
    });
  }

  function detectContentRoot(base, options = {}) {
    const fallback = options.fallback || base?.ownerDocument?.body || base || document.body;
    if (!base || base.nodeType !== 1) {
      return toResult(fallback, 'fallback', false, [], { fallback });
    }

    const articleAnalyses = getUniqueSemanticAnalyses(
      base,
      options,
      'article, [role="article"], [itemprop="articleBody"]',
      element => !element.parentElement?.closest?.(
        'article, [role="article"], [itemprop="articleBody"]'
      )
    ).filter(isNormalSemanticCandidate);

    if (articleAnalyses.length === 1) {
      const article = articleAnalyses[0].element;
      const main = findPreferredMain(article);
      if (main && (options.preferMain === true
          || hasCompetingProseRegion(base, article, options))) {
        const analysis = createAnalysis(main, options);
        return toResult(main, 'unique-main-container', true, [analysis, articleAnalyses[0]], {
          fallback
        });
      }
      return toResult(
        article,
        'unique-article',
        true,
        articleAnalyses,
        { fallback }
      );
    }

    const mainAnalyses = getUniqueSemanticAnalyses(
      base,
      options,
      'main, [role="main"]',
      () => true
    ).filter(analysis => analysis.textSignals.length >= MIN_PROSE_LENGTH
      && analysis.proseEvidence.level !== 'none'
      && !analysis.linkFarm);

    if (mainAnalyses.length === 1) {
      return toResult(mainAnalyses[0].element, 'unique-main', true, mainAnalyses, { fallback });
    }

    const isVisible = options.isVisible || isVisibleByDefault;
    const isOwned = options.isOwned || (() => false);
    const limit = Math.max(1, Number(options.candidateLimit) || 600);
    const elements = Array.from(base.querySelectorAll?.(CONTENT_ROOT_SELECTOR) || [])
      .slice(0, limit)
      .filter(element => !isVisible || isVisible(element))
      .filter(element => !isOwned(element))
      .filter(element => !element.closest?.(EXCLUDED_ROOT_ANCESTOR));
    if (base.matches?.(CONTENT_ROOT_SELECTOR)) elements.unshift(base);

    const analyses = Array.from(new Set(elements))
      .map(element => createAnalysis(element, options))
      .filter(analysis => analysis.textSignals.length >= MIN_PROSE_LENGTH);
    if (analyses.length === 0) {
      return toResult(fallback, 'fallback', false, [], { fallback });
    }

    analyses.sort((left, right) => right.score - left.score);
    const best = analyses[0];
    if (isPromotableShell(best.element, best, options)) {
      return toResult(best.element, 'content-shell-promotion', true, analyses, { fallback });
    }
    const promoted = findPromotedShell(best, analyses, options);
    if (promoted) {
      return toResult(
        promoted.element,
        'content-shell-promotion',
        true,
        [promoted, ...analyses.filter(item => item !== promoted)],
        { fallback }
      );
    }

    if (best.score >= TRUST_SCORE) {
      const semanticTrust = best.semantic
        && best.proseEvidence.level !== 'none'
        && !best.linkFarm;
      const hintTrust = !best.hintSignals.card
        && best.proseEvidence.level === 'strong'
        && best.textSignals.linkDensity < 0.45;
      return toResult(best.element, 'prose-score', semanticTrust || hintTrust, analyses, {
        fallback
      });
    }

    return toResult(fallback, 'fallback', false, analyses, { fallback });
  }

  return Object.freeze({
    detectContentRoot,
    createAnalysis,
    isPromotableShell
  });
});
