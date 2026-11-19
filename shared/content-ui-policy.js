/**
 * Open Immerse Translate - shared adaptive UI semantics.
 *
 * Smart mode keeps readable content and persistent interface labels without
 * opening every page shell. Scanners and filters consume these predicates so
 * both stages agree on navigation roots, interactive labels, and shadow DOM.
 */
(function initContentUiPolicy(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentUiPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentUiPolicy() {
  'use strict';

  const ADAPTIVE_UI_ROOT_SELECTOR = [
    'header', 'nav', '[role="navigation"]', '[role="menu"]',
    '[role="menubar"]', '[role="toolbar"]', '[role="tablist"]'
  ].join(',');
  const INTERACTIVE_CONTROL_SELECTOR = [
    'button', 'a[href]', '[role="button"]', '[role="link"]',
    '[role^="menuitem"]', '[role="tab"]', '[role="option"]'
  ].join(',');
  const STRONG_CLUSTER_CONTROL_SELECTOR = [
    '[role="tab"]', '[role^="menuitem"]', '[role="option"]',
    '[aria-selected="true"]', '[aria-selected="false"]',
    '[aria-current]:not([aria-current="false"])'
  ].join(',');
  const NAVIGATION_COLLECTION_EXCLUSION_SELECTOR = [
    'article', '[role="article"]', 'main', 'body', 'html'
  ].join(',');
  const NAVIGATION_PROSE_SELECTOR = [
    'article', '[role="article"]', 'blockquote',
    'p', '[class*="description"]', '[class*="summary"]'
  ].join(',');
  const PRIMARY_READING_REGION_SELECTOR = [
    'main', '[role="main"]', 'article', '[role="article"]'
  ].join(',');
  const DEFAULT_NAVIGATION_LIMITS = Object.freeze({
    minControls: 3,
    maxControls: 500,
    maxExaminedControls: 20000,
    ancestorDepth: 12,
    maxRoots: 40,
    maxLabelLength: 120,
    maxMedianLabelLength: 48,
    maxProseLength: 180
  });

  function getComposedParentElement(node) {
    if (!node) return null;
    if (node.nodeType === 1 && node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) {
      if (node.nodeType === 1
          && node.parentElement.shadowRoot
          && !node.assignedSlot) {
        return null;
      }
      return node.parentElement;
    }
    const rootNode = node.getRootNode?.();
    return rootNode && rootNode.host ? rootNode.host : null;
  }

  function composedClosest(element, selector) {
    let current = element;
    while (current) {
      if (current.nodeType === 1 && current.matches?.(selector)) return current;
      current = getComposedParentElement(current);
    }
    return null;
  }

  function isAdaptiveUiRoot(element) {
    return Boolean(element?.matches?.(ADAPTIVE_UI_ROOT_SELECTOR));
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hasLexicalText(value) {
    return /[\p{L}\p{N}]/u.test(normalizeText(value));
  }

  function getControlLabel(control) {
    return normalizeText(
      control?.getAttribute?.('aria-label')
        || control?.getAttribute?.('title')
        || control?.textContent
    );
  }

  function getRect(element) {
    try {
      return element?.getBoundingClientRect?.()
        || { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
    } catch (error) {
      return { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function hasVisibleArea(element) {
    const rect = getRect(element);
    if (rect.width <= 0 || rect.height <= 0) return false;

    let visible = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    };
    let current = getComposedParentElement(element);
    while (current) {
      if (current.nodeType === 1) {
        let style;
        try {
          style = (current.ownerDocument?.defaultView || globalThis)
            .getComputedStyle?.(current);
        } catch (error) {
          style = null;
        }
        const clipsX = style
          && ['clip', 'hidden'].includes(style.overflowX || style.overflow);
        const clipsY = style
          && ['clip', 'hidden'].includes(style.overflowY || style.overflow);
        if (clipsX || clipsY) {
          const clip = getRect(current);
          if (clipsY) {
            visible.top = Math.max(visible.top, clip.top);
            visible.bottom = Math.min(visible.bottom, clip.bottom);
          }
          if (clipsX) {
            visible.left = Math.max(visible.left, clip.left);
            visible.right = Math.min(visible.right, clip.right);
          }
          if (visible.right <= visible.left || visible.bottom <= visible.top) {
            return false;
          }
        }
      }
      current = getComposedParentElement(current);
    }
    return true;
  }

  function defaultIsVisible(element) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    let current = element;
    while (current) {
      if (current.nodeType === 1) {
        if (current.hasAttribute?.('hidden')
            || current.getAttribute?.('aria-hidden') === 'true') {
          return false;
        }
        let style;
        try {
          style = (current.ownerDocument?.defaultView || globalThis)
            .getComputedStyle?.(current);
        } catch (error) {
          style = null;
        }
        if (style
            && (style.display === 'none'
              || style.visibility === 'hidden'
              || style.visibility === 'collapse'
              || style.opacity === '0')) {
          return false;
        }
      }
      current = getComposedParentElement(current);
    }
    return hasVisibleArea(element);
  }

  /**
   * Navigation inference may walk from split top bars and rails into their
   * layout shell. Such a shell is not a navigation collection once it contains
   * a visible reading region: treating it as one turns post authors, dates and
   * actions into navigation labels. Keep the bounded child roots instead.
   */
  function containsSubstantialReadingRegion(root, options = {}) {
    if (!root?.querySelectorAll) return false;
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : defaultIsVisible;
    const regions = root.matches?.(PRIMARY_READING_REGION_SELECTOR) ? [root] : [];
    regions.push(...root.querySelectorAll(PRIMARY_READING_REGION_SELECTOR));

    return regions.some(region => {
      if (!isVisible(region)) return false;
      const rect = getRect(region);
      if (rect.width <= 0 || rect.height <= 0) return false;
      const text = normalizeText(region.textContent);
      return text.length >= 24
        || Boolean(region.querySelector(
          'p, blockquote, pre, h1, h2, h3, [data-testid="tweetText"]'
        ));
    });
  }

  function getNormalizedRoots(roots) {
    if (!roots) return [];
    return roots instanceof Set ? Array.from(roots) : Array.from(roots);
  }

  function isWithinAdaptiveUiScope(element, roots = null) {
    if (!element?.matches) return false;
    const inferredRoots = getNormalizedRoots(roots);
    const inferred = inferredRoots.length ? new Set(inferredRoots) : null;
    let current = element;
    while (current) {
      if (current.nodeType === 1) {
        if (current.matches?.(ADAPTIVE_UI_ROOT_SELECTOR)) return true;
        if (inferred?.has(current)) return true;
      }
      current = getComposedParentElement(current);
    }
    return false;
  }

  function isAdaptiveUiLabel(element, roots = null) {
    if (!element?.matches) return false;
    const control = composedClosest(element, INTERACTIVE_CONTROL_SELECTOR);
    if (!control) return false;
    return isWithinAdaptiveUiScope(control, roots)
      || Boolean(findAdaptiveUiRoot(control));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[midpoint]
      : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  function hasNavigationLayout(rects, viewport, minimumControls = 3) {
    if (rects.length < minimumControls) return false;
    const centersX = rects.map(rect => rect.left + rect.width / 2);
    const centersY = rects.map(rect => rect.top + rect.height / 2);
    const spreadX = Math.max(...centersX) - Math.min(...centersX);
    const spreadY = Math.max(...centersY) - Math.min(...centersY);
    const uniqueRows = new Set(centersY.map(value => Math.round(value / 4))).size;
    const uniqueColumns = new Set(centersX.map(value => Math.round(value / 4))).size;
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const vertical = uniqueRows >= Math.ceil(rects.length * 0.6)
      && spreadX <= Math.max(28, width * 0.24);
    const horizontal = uniqueColumns >= Math.ceil(rects.length * 0.6)
      && spreadY <= Math.max(24, height * 0.08);
    return vertical || horizontal;
  }

  function isNavigationCollection(element, options = {}) {
    const limits = { ...DEFAULT_NAVIGATION_LIMITS, ...(options.limits || {}) };
    if (!element?.matches
        || element.matches?.(NAVIGATION_COLLECTION_EXCLUSION_SELECTOR)) {
      return false;
    }
    if (composedClosest(getComposedParentElement(element), 'article, [role="article"]')) {
      return false;
    }

    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : defaultIsVisible;
    const controls = [];
    const labeledControls = [];
    let examinedControls = 0;
    const candidates = element.querySelectorAll?.(INTERACTIVE_CONTROL_SELECTOR) || [];

    for (const control of candidates) {
      if (control.matches?.(
        '.oit-wrapper, .oit-translated-host, .oit-translation, .oit-original'
      ) || composedClosest(control, 'article, [role="article"]')) {
        continue;
      }
      if (examinedControls++ >= limits.maxExaminedControls
          || labeledControls.length >= limits.maxControls) {
        break;
      }
      if (!isVisible(control)) continue;

      const label = getControlLabel(control);
      const rect = getRect(control);
      if (label.length < 2
          || !hasLexicalText(label)
          || label.length > limits.maxLabelLength
          || rect.width <= 0
          || rect.height <= 0) {
        continue;
      }
      controls.push(control);
      labeledControls.push({ control, label, rect });
    }

    const strongCluster = labeledControls.length >= 2
      && labeledControls.every(({ control }) => (
        control.matches?.(STRONG_CLUSTER_CONTROL_SELECTOR)
      ));
    const minimumControls = strongCluster ? 2 : limits.minControls;
    if (labeledControls.length < minimumControls) return false;

    const labels = labeledControls.map(item => item.label);
    if (median(labels.map(label => label.length)) > limits.maxMedianLabelLength) {
      return false;
    }

    const rootText = normalizeText(element.textContent);
    const labelTextLength = labels.reduce((sum, label) => sum + label.length, 0);
    const labelDensity = labelTextLength / Math.max(labelTextLength, rootText.length);
    if (labelTextLength === 0 || labelDensity < 0.55) return false;

    const prose = Array.from(element.querySelectorAll?.(NAVIGATION_PROSE_SELECTOR) || []);
    if (prose.some(item => !controls.some(control => control.contains(item)))) {
      return false;
    }
    if (prose.some(item => normalizeText(item.textContent).length > limits.maxProseLength)) {
      return false;
    }

    const viewport = options.viewport || {
      width: globalThis.innerWidth || getRect(element).width,
      height: globalThis.innerHeight || getRect(element).height
    };

    return hasNavigationLayout(
      labeledControls.map(item => item.rect),
      viewport,
      minimumControls
    );
  }

  function isVisibleAdaptiveUiRoot(element, options = {}) {
    if (!element?.matches || !element.isConnected) return false;
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : defaultIsVisible;
    if (isVisible(element)) return true;

    const limits = { ...DEFAULT_NAVIGATION_LIMITS, ...(options.limits || {}) };
    const controls = element.querySelectorAll?.(INTERACTIVE_CONTROL_SELECTOR) || [];
    let examined = 0;
    for (const control of controls) {
      if (examined++ >= limits.maxExaminedControls) break;
      const label = getControlLabel(control);
      if (isVisible(control)
          && hasLexicalText(label)
          && label.length <= limits.maxLabelLength) {
        return true;
      }
    }
    return false;
  }

  function collectMatches(base, selector) {
    if (!base?.querySelectorAll) return [];
    const matches = base.nodeType === 1 && base.matches?.(selector) ? [base] : [];
    matches.push(...base.querySelectorAll(selector));
    return matches;
  }

  function findAdaptiveUiRoots(base = globalThis.document?.body, options = {}) {
    if (!base?.querySelectorAll) return [];
    const limits = { ...DEFAULT_NAVIGATION_LIMITS, ...(options.limits || {}) };
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : defaultIsVisible;
    const semanticRoots = collectMatches(base, ADAPTIVE_UI_ROOT_SELECTOR)
      .filter(root => isVisibleAdaptiveUiRoot(root, { ...options, isVisible, limits }));
    const inferredCounts = new Map();
    const controls = collectMatches(base, INTERACTIVE_CONTROL_SELECTOR);
    let examinedControls = 0;

    for (const control of controls) {
      if (control.matches?.(
        '.oit-wrapper, .oit-translated-host, .oit-translation, .oit-original'
      ) || composedClosest(control, 'article, [role="article"]')) {
        continue;
      }
      if (examinedControls++ >= limits.maxExaminedControls) break;

      const label = getControlLabel(control);
      if (!isVisible(control)
          || !hasLexicalText(label)
          || label.length > limits.maxLabelLength) {
        continue;
      }
      let current = getComposedParentElement(control);
      let depth = 0;
      while (current
          && current.nodeType === 1
          && depth++ < limits.ancestorDepth
          && !current.matches('body, html')) {
        inferredCounts.set(current, (inferredCounts.get(current) || 0) + 1);
        current = getComposedParentElement(current);
      }
    }

    const inferredRoots = Array.from(inferredCounts.entries())
      .filter(([root, count]) => (
        count >= 2
        && isNavigationCollection(root, { ...options, isVisible, limits })
      ))
      .map(([root]) => root);
    const discovered = Array.from(new Set([...semanticRoots, ...inferredRoots]))
      .filter(root => !containsSubstantialReadingRegion(root, {
        ...options,
        isVisible
      }))
      .slice(0, limits.maxRoots);

    return discovered.filter(root => !discovered.some(other => (
      other !== root && composedClosest(root, 'body') && other.contains(root)
    )));
  }

  /**
   * Resolve a dynamically inserted label to its nearest existing UI cluster.
   * Mutation records often contain only one newly rendered anchor, while its
   * sibling anchors are already in the DOM and establish the navigation root.
   */
  function findAdaptiveUiRoot(element, options = {}) {
    const normalized = element?.nodeType === 1 ? element : element?.parentElement;
    if (!normalized?.matches || !normalized.isConnected) return null;
    const limits = { ...DEFAULT_NAVIGATION_LIMITS, ...(options.limits || {}) };
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : defaultIsVisible;
    if (!isVisibleAdaptiveUiRoot(normalized, { ...options, isVisible, limits })) {
      return null;
    }

    let current = normalized;
    for (let depth = 0;
      current
        && current.nodeType === 1
        && !current.matches(NAVIGATION_COLLECTION_EXCLUSION_SELECTOR)
        && depth <= limits.ancestorDepth;
      depth++, current = getComposedParentElement(current)
    ) {
      if (current.matches?.(ADAPTIVE_UI_ROOT_SELECTOR)
          && isVisibleAdaptiveUiRoot(current, { ...options, isVisible, limits })) {
        return current;
      }
      if (isNavigationCollection(current, { ...options, isVisible, limits })) {
        return current;
      }
    }
    return null;
  }

  return Object.freeze({
    ADAPTIVE_UI_ROOT_SELECTOR,
    INTERACTIVE_CONTROL_SELECTOR,
    NAVIGATION_COLLECTION_EXCLUSION_SELECTOR,
    PRIMARY_READING_REGION_SELECTOR,
    getComposedParentElement,
    hasVisibleArea,
    containsSubstantialReadingRegion,
    isVisibleAdaptiveUiRoot,
    isAdaptiveUiRoot,
    isWithinAdaptiveUiScope,
    isAdaptiveUiLabel,
    isNavigationCollection,
    findAdaptiveUiRoots,
    findAdaptiveUiRoot
  });
});
