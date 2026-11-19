/**
 * Open Immerse Translate - DOM text unitization.
 *
 * Unitization is intentionally independent from scanning policy. It turns
 * mixed-layout containers into stable translation elements without deciding
 * whether page chrome should be translated.
 */
(function initContentUnitizer(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentUnitizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentUnitizer() {
  'use strict';

  const DIRECT_TEXT_RUN_CLASS = 'oit-direct-text-run';
  const DIRECT_TEXT_RUN_SELECTOR = `.${DIRECT_TEXT_RUN_CLASS}`;
  const ATTRIBUTE_LABEL_HOST_CLASS = 'oit-attribute-label-host';
  const ATTRIBUTE_LABEL_HOST_SELECTOR = `.${ATTRIBUTE_LABEL_HOST_CLASS}`;
  const ATTRIBUTE_LABEL_SOURCE_ATTRIBUTE = 'data-oit-source-label';
  const SEMANTIC_UNIT_SELECTOR = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'figcaption',
    'li', 'dt', 'dd', 'td', 'th', 'caption', 'label', 'legend', 'summary',
    '[role="heading"]', '[role="article"]', '[data-testid="tweetText"]'
  ].join(',');
  const CONTROL_SELECTOR = [
    'button', 'a[href]', '[role="button"]', '[role="link"]',
    '[role^="menuitem"]', '[role="tab"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]'
  ].join(',');
  const SAFE_INLINE_LINK_SELECTOR = 'a[href], [role="link"]';
  const CONTROL_AUXILIARY_SELECTOR = [
    'time',
    '[datetime]',
    '[role="status"]',
    '[role="timer"]',
    '[role="progressbar"]',
    '[role="meter"]',
    '[aria-live]',
    '[data-testid*="badge" i]',
    '[data-testid*="count" i]',
    '[data-testid*="status" i]',
    '[data-testid*="timestamp" i]',
    '[class*="badge" i]',
    '[class*="count" i]',
    '[class*="status" i]',
    '[class*="timestamp" i]'
  ].join(',');
  const CONTROL_AUXILIARY_TEXT_PATTERN = new RegExp(
    '^(?:'
      + '\\d[\\d,.]*\\s*[kmb]?'
      + '|\\d+\\s*[smhdw]'
      + '|\\d[\\d,.]*\\s*[kmb]?\\s+'
        + '(?:replies|reply|likes|like|reposts|repost|views|view|'
        + 'followers|follower|posts|post|comments|comment)'
      + '|@[a-z0-9_.]+'
      + '|(?:just\\s+)?now'
      + '|yesterday'
      + ')$',
    'i'
  );
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
    'OL', 'P', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD',
    'TR', 'UL'
  ]);
  const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DEL', 'EM', 'FONT', 'I',
    'INS', 'MARK', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP',
    'TIME', 'U'
  ]);
  const TEXTUAL_TAGS = new Set([
    'ADDRESS', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DT', 'FIGCAPTION', 'H1',
    'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'LEGEND', 'LI', 'P', 'SUMMARY',
    'TD', 'TH'
  ]);

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hasReadableText(value) {
    return /[\p{L}\p{N}]/u.test(normalizeText(value));
  }

  function isDirectTextRun(element) {
    return Boolean(element?.matches?.(DIRECT_TEXT_RUN_SELECTOR));
  }

  function isInsideDirectTextRun(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(DIRECT_TEXT_RUN_SELECTOR));
  }

  function isProtectedNode(node, protectedSelector) {
    if (!node) return true;
    if (node.nodeType === 1 && node.matches?.(protectedSelector)) return true;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(element?.closest?.(protectedSelector));
  }

  function isRenderedTextNode(textNode, boundary) {
    const parent = textNode?.parentElement;
    if (!parent) return false;

    let current = parent;
    while (current) {
      if (current.hasAttribute?.('hidden')
          || current.getAttribute?.('aria-hidden') === 'true'
          || current.closest?.('details:not([open]) > :not(summary)')) {
        return false;
      }

      let style = null;
      try {
        style = current.ownerDocument?.defaultView?.getComputedStyle(current);
      } catch (error) {
        style = null;
      }
      if (style
          && (style.display === 'none'
            || style.visibility === 'hidden'
            || style.visibility === 'collapse'
            || style.contentVisibility === 'hidden'
            || style.opacity === '0')) {
        return false;
      }
      if (current === boundary) break;
      current = current.parentElement;
    }
    return true;
  }

  function isInsideElement(node, ancestor) {
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    while (current) {
      if (current === ancestor) return true;
      current = current.parentElement;
    }
    return false;
  }

  function hasAuxiliaryAncestor(element, control, selector) {
    let current = element;
    while (current && current !== control) {
      if (current.matches?.(selector)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function isAuxiliaryControlText(textNode, control, options = {}) {
    const text = normalizeText(textNode?.nodeValue);
    if (!text) return false;
    if (CONTROL_AUXILIARY_TEXT_PATTERN.test(text)) return true;
    return hasAuxiliaryAncestor(
      textNode.parentElement,
      control,
      options.auxiliarySelector || CONTROL_AUXILIARY_SELECTOR
    );
  }

  function isLayoutBlock(node) {
    if (node?.nodeType !== 1) return false;
    if (BLOCK_TAGS.has(String(node.tagName || '').toUpperCase())) return true;
    try {
      const display = node.ownerDocument?.defaultView?.getComputedStyle(node)?.display || '';
      return /^(?:block|flex|grid|list-item|table|flow-root)$/.test(display);
    } catch (error) {
      return false;
    }
  }

  function isInlineNode(node, options = {}) {
    if (!node) return false;
    if (node.nodeType === 3) return hasReadableText(node.nodeValue);
    if (node.nodeType !== 1) return false;
    if (isProtectedNode(node, options.protectedSelector)) return false;
    const controlSelector = options.controlSelector || CONTROL_SELECTOR;
    const isSafeInlineLink = node.matches?.(SAFE_INLINE_LINK_SELECTOR);
    if (!isSafeInlineLink && node.matches?.(controlSelector)) return false;
    if (node.querySelector?.(controlSelector)
        && !Array.from(node.querySelectorAll?.(controlSelector) || [])
          .every(control => control.matches?.(SAFE_INLINE_LINK_SELECTOR))) {
      return false;
    }
    if (isLayoutBlock(node)) return false;
    if (isDirectTextRun(node)) return true;
    if (INLINE_TAGS.has(String(node.tagName || '').toUpperCase())) return true;
    try {
      return (node.ownerDocument?.defaultView?.getComputedStyle(node)?.display || '')
        .startsWith('inline');
    } catch (error) {
      return false;
    }
  }

  function directChildHasBlockOrControl(element, options = {}) {
    const controlSelector = options.controlSelector || CONTROL_SELECTOR;
    return Array.from(element?.childNodes || []).some(node => {
      if (node.nodeType !== 1) return false;
      const isSafeInlineLink = node.matches?.(SAFE_INLINE_LINK_SELECTOR);
      return isLayoutBlock(node) || (!isSafeInlineLink && node.matches?.(controlSelector));
    });
  }

  function isEligibleMixedParent(element, options = {}) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    if (isDirectTextRun(element)) return false;
    if (element.matches?.(options.semanticSelector || SEMANTIC_UNIT_SELECTOR)) return false;
    if (element.matches?.(options.controlSelector || CONTROL_SELECTOR)) return false;
    if (TEXTUAL_TAGS.has(String(element.tagName || '').toUpperCase())) return false;
    if (isProtectedNode(element, options.protectedSelector)) return false;
    if (!directChildHasBlockOrControl(element, options)) return false;
    return true;
  }

  function collectRunNodes(textNode, options = {}) {
    const run = [textNode];
    let sibling = textNode.previousSibling;
    while (sibling && isInlineNode(sibling, options)) {
      run.unshift(sibling);
      sibling = sibling.previousSibling;
    }
    sibling = textNode.nextSibling;
    while (sibling && isInlineNode(sibling, options)) {
      run.push(sibling);
      sibling = sibling.nextSibling;
    }
    return run;
  }

  function runText(nodes) {
    return normalizeText(nodes.map(node => node.textContent || '').join(' '));
  }

  function materializeRun(nodes, options = {}) {
    const first = nodes[0];
    const parent = first?.parentNode;
    if (!parent || nodes.some(node => node.parentNode !== parent)) return null;
    if (nodes.some(node => node.nodeType === 3 && !normalizeText(node.nodeValue))) return null;

    const text = runText(nodes);
    if (text.length < 2 || !hasReadableText(text)) return null;
    const doc = first.ownerDocument || parent.ownerDocument || document;
    const wrapper = doc.createElement(options.wrapperTagName || 'span');
    wrapper.className = DIRECT_TEXT_RUN_CLASS;
    wrapper.setAttribute('data-oit-unit', 'direct-text-run');
    parent.insertBefore(wrapper, first);
    for (const node of nodes) wrapper.appendChild(node);
    return wrapper;
  }

  function collectDirectTextRunTargets(root, options = {}) {
    if (!root?.ownerDocument?.createTreeWalker) return [];
    const targets = [];
    const seenParents = new Set();
    const walker = root.ownerDocument.createTreeWalker(
      root,
      typeof Node !== 'undefined' ? NodeFilter.SHOW_TEXT : 4
    );
    let node;

    while ((node = walker.nextNode())) {
      if (!hasReadableText(node.nodeValue)) continue;
      const parent = node.parentElement;
      if (!parent || !isEligibleMixedParent(parent, options)) continue;
      if (isProtectedNode(parent, options.protectedSelector)) continue;

      const run = collectRunNodes(node, options);
      const currentText = runText(run);
      if (!hasReadableText(currentText)) continue;
      if (run.length === 1 && parent.childNodes.length === 1) continue;

      const wrapper = materializeRun(run, options);
      if (wrapper) {
        targets.push(wrapper);
        seenParents.add(parent);
      }
    }

    return Array.from(new Set(targets));
  }

  function unwrapDirectTextRun(wrapper, expectedParent = null) {
    if (!isDirectTextRun(wrapper)) return false;
    const parent = wrapper.parentNode;
    if (!parent || (expectedParent && parent !== expectedParent)) return false;
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
    return true;
  }

  function unwrapAll(root = document) {
    const wrappers = Array.from(root?.querySelectorAll?.(DIRECT_TEXT_RUN_SELECTOR) || []);
    let count = 0;
    for (const wrapper of wrappers) {
      if (unwrapDirectTextRun(wrapper)) count++;
    }
    return count;
  }

  function findReadableLabelTarget(element, options = {}) {
    const layoutSelector = options.layoutSelector
      || 'html, body, main, article, section, nav, header, footer, aside, form, ul, ol, table, thead, tbody, tr, details';
    const semanticSelector = options.semanticSelector || SEMANTIC_UNIT_SELECTOR;
    let current = element;

    while (current && current.nodeType === 1) {
      if (current.matches?.(semanticSelector)) return current;
      if (current.matches?.(layoutSelector) || current === document.body) return null;
      if (!isEligibleMixedParent(current, options)
          && !Array.from(current.children || []).every(child => isInlineNode(child, options))) {
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function collectControlTextNodes(control, options = {}) {
    if (!control?.ownerDocument?.createTreeWalker) return [];
    const protectedSelector = options.protectedSelector || '';
    const walker = control.ownerDocument.createTreeWalker(
      control,
      typeof Node !== 'undefined' ? NodeFilter.SHOW_TEXT : 4
    );
    const nodes = [];
    let node;

    while ((node = walker.nextNode())) {
      if (!normalizeText(node.nodeValue)) continue;
      const parent = node.parentElement;
      if (!parent || !isInsideElement(parent, control)) continue;
      if (protectedSelector && isProtectedNode(parent, protectedSelector)) continue;
      if (!isRenderedTextNode(node, control)) continue;
      nodes.push(node);
    }
    return nodes;
  }

  function getControlAttributeLabel(control) {
    const label = normalizeText(
      control?.getAttribute?.('aria-label')
        || control?.getAttribute?.('title')
    );
    return hasReadableText(label) ? label : '';
  }

  function findAttributeLabelHost(control) {
    return Array.from(control?.children || []).find(child => (
      child.matches?.(ATTRIBUTE_LABEL_HOST_SELECTOR)
    )) || null;
  }

  function ensureAttributeLabelHost(control, label) {
    const existing = findAttributeLabelHost(control);
    if (existing) {
      const previous = existing.getAttribute(ATTRIBUTE_LABEL_SOURCE_ATTRIBUTE);
      if (previous !== label
          && !existing.classList.contains('oit-translated-host')) {
        existing.textContent = label;
      }
      existing.setAttribute(ATTRIBUTE_LABEL_SOURCE_ATTRIBUTE, label);
      return existing;
    }

    const doc = control.ownerDocument || document;
    const host = doc.createElement('span');
    host.className = ATTRIBUTE_LABEL_HOST_CLASS;
    host.setAttribute('data-oit-unit', 'attribute-label');
    host.setAttribute(ATTRIBUTE_LABEL_SOURCE_ATTRIBUTE, label);
    host.textContent = label;
    control.appendChild(host);
    return host;
  }

  function getCandidateSummary(element, naturalNodes, control, options = {}) {
    const labelNodes = naturalNodes.filter(node => (
      node.parentElement === element || element.contains(node.parentElement)
    ));
    if (labelNodes.length === 0) return null;

    const textNodes = collectControlTextNodes(element, options);
    let foreignCount = 0;
    for (const node of textNodes) {
      if (naturalNodes.includes(node)) continue;
      if (isAuxiliaryControlText(node, control, options)) foreignCount++;
      else foreignCount++;
    }
    const controlSelector = options.controlSelector || CONTROL_SELECTOR;
    const hasNestedControl = Array.from(
      element.querySelectorAll?.(controlSelector) || []
    ).some(controlElement => controlElement !== control);
    if (hasNestedControl) return null;

    const parent = element.parentElement;
    let parentForeignCount = 0;
    if (parent && parent !== control) {
      const parentSummary = getTextNodeCounts(parent, naturalNodes, control, options);
      parentForeignCount = parentSummary.foreignCount;
    }
    const isBoundary = parent === control || parentForeignCount > 0;
    const hasMedia = Boolean(element.querySelector?.(
      'svg, img, picture, video, audio, canvas'
    ));
    const textLength = labelNodes.reduce(
      (total, node) => total + normalizeText(node.nodeValue).length,
      0
    );
    let depth = 0;
    let current = element;
    while (current && current !== control) {
      depth++;
      current = current.parentElement;
    }

    return {
      element,
      labelCount: labelNodes.length,
      foreignCount,
      isBoundary,
      hasForeignBoundary: parentForeignCount > 0,
      hasMedia,
      hasStableIdentity: Boolean(
        element.id
        || element.getAttribute?.('data-testid')
        || element.getAttribute?.('data-test')
        || element.getAttribute?.('data-qa')
        || element.getAttribute?.('aria-label')
      ),
      textLength,
      depth,
      descendantCount: element.querySelectorAll?.('*').length || 0
    };
  }

  function getTextNodeCounts(element, naturalNodes, control, options = {}) {
    const textNodes = collectControlTextNodes(element, options);
    let labelCount = 0;
    let foreignCount = 0;
    for (const node of textNodes) {
      if (naturalNodes.includes(node)) {
        labelCount++;
      } else {
        foreignCount++;
      }
    }
    return { labelCount, foreignCount };
  }

  /**
   * Resolve one stable translation host for an interactive control.
   *
   * Natural-language leaves are grouped into the narrowest common container
   * that does not absorb badges, counts, status text, or timestamps. The
   * control itself remains untouched so href, focus, listeners, and framework
   * reconciliation identity are preserved.
   */
  function findControlTranslationTarget(control, options = {}) {
    if (!control || control.nodeType !== 1 || !control.isConnected) return null;
    const controlSelector = options.controlSelector || CONTROL_SELECTOR;
    if (!control.matches?.(controlSelector)) return null;

    const attributeLabel = getControlAttributeLabel(control);
    const existingAttributeHost = findAttributeLabelHost(control);
    if (attributeLabel && existingAttributeHost) {
      return ensureAttributeLabelHost(control, attributeLabel);
    }
    const textNodes = collectControlTextNodes(control, options);
    const naturalNodes = textNodes.filter(node => (
      hasReadableText(node.nodeValue)
      && !isAuxiliaryControlText(node, control, options)
    ));
    if (naturalNodes.length === 0) {
      return attributeLabel
        ? ensureAttributeLabelHost(control, attributeLabel)
        : null;
    }

    const candidateElements = new Set();
    for (const node of naturalNodes) {
      let current = node.parentElement;
      while (current && current !== control) {
        if (!isProtectedNode(current, options.protectedSelector || '')) {
          candidateElements.add(current);
        }
        current = current.parentElement;
      }
    }

    const candidates = Array.from(candidateElements)
      .map(element => getCandidateSummary(element, naturalNodes, control, options))
      .filter(Boolean)
      .sort((left, right) => (
        right.labelCount - left.labelCount
        || left.foreignCount - right.foreignCount
        || Number(right.hasForeignBoundary) - Number(left.hasForeignBoundary)
        || Number(right.hasStableIdentity) - Number(left.hasStableIdentity)
        || Number(left.hasMedia) - Number(right.hasMedia)
        || left.depth - right.depth
        || left.descendantCount - right.descendantCount
        || right.textLength - left.textLength
        || Number(right.isBoundary) - Number(left.isBoundary)
      ));
    if (candidates.length > 0) return candidates[0].element;

    const directNaturalNodes = naturalNodes.filter(node => (
      node.parentElement === control
    ));
    const allTextIsNatural = textNodes.every(node => naturalNodes.includes(node));
    return directNaturalNodes.length > 0 && allTextIsNatural ? control : null;
  }

  return Object.freeze({
    DIRECT_TEXT_RUN_CLASS,
    DIRECT_TEXT_RUN_SELECTOR,
    ATTRIBUTE_LABEL_HOST_CLASS,
    ATTRIBUTE_LABEL_HOST_SELECTOR,
    ATTRIBUTE_LABEL_SOURCE_ATTRIBUTE,
    SEMANTIC_UNIT_SELECTOR,
    CONTROL_SELECTOR,
    SAFE_INLINE_LINK_SELECTOR,
    CONTROL_AUXILIARY_SELECTOR,
    CONTROL_AUXILIARY_TEXT_PATTERN,
    normalizeText,
    isDirectTextRun,
    isInsideDirectTextRun,
    isLayoutBlock,
    isInlineNode,
    isEligibleMixedParent,
    collectDirectTextRunTargets,
    unwrapDirectTextRun,
    unwrapAll,
    findReadableLabelTarget,
    findControlTranslationTarget
  });
});
