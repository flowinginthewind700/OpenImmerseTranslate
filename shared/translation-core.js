/**
 * Open Immerse Translate - Translation protocol core.
 *
 * This file is intentionally dependency-free. It is loaded as a classic
 * script in extension pages/content scripts and can also be imported by the
 * MV3 module service worker. The protocol and DOM helpers are original to
 * Open Immerse Translate.
 */
(function initTranslationCore(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITTranslationCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTranslationCore() {
  'use strict';

  const promptPolicy = globalThis.OITPromptPolicy;
  const LANGUAGE_NAMES = promptPolicy?.LANGUAGE_NAMES || Object.freeze({});

  const PROTECTED_TOKEN_PATTERN = /\[\[OIT-[A-Z0-9]+:(?:OPEN|CLOSE|ATOM):\d+\]\]/g;
  const TOKEN_PARSE_PATTERN = /\[\[OIT-([A-Z0-9]+):(OPEN|CLOSE|ATOM):(\d+)\]\]/g;
  const ATOMIC_TAGS = new Set([
    'CODE', 'KBD', 'SAMP', 'VAR', 'MATH', 'MJX-CONTAINER', 'SVG', 'IMG', 'BR', 'WBR',
    'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'VIDEO', 'AUDIO',
    'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'
  ]);
  const PROTECTED_ATOM_SELECTOR = '[contenteditable="true"], [translate="no"], .notranslate, .math';
  const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
    'THEAD', 'TR', 'UL'
  ]);
  const INLINE_HOST_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'BUTTON', 'CITE', 'CODE', 'DFN', 'EM',
    'I', 'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB',
    'SUP', 'TIME', 'U', 'VAR'
  ]);
  const DIRECT_CONTROL_SELECTOR = [
    'a', 'button', 'summary', 'label', 'legend', 'th', 'td',
    '[role="button"]', '[role="link"]', '[role^="menuitem"]', '[role="tab"]'
  ].join(',');
  const COMPACT_CONTROL_CONTEXT_SELECTOR = [
    'a[href]', 'button', 'summary', '[role="button"]', '[role="link"]',
    '[role^="menuitem"]', '[role="tab"]'
  ].join(',');
  const INTERACTIVE_SELECTOR = [
    'a', 'button', 'summary', '[tabindex]', '[onclick]', '[onkeydown]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="switch"]', '[role^="menuitem"]', '[role="tab"]'
  ].join(',');
  const TEXT_FLOW_BOUNDARY_SELECTOR = [
    'html', 'body', 'main', 'article', 'section', 'aside', 'nav', 'header',
    'footer', 'form', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'dialog',
    '[role="dialog"]'
  ].join(',');
  const TEXT_FLOW_MEDIA_SELECTOR = [
    'img:not([aria-hidden="true"])', 'picture', 'video', 'audio', 'iframe',
    'canvas', 'input', 'textarea', 'select',
    '[contenteditable]:not([contenteditable="false"])'
  ].join(',');
  const IN_PLACE_PROTECTED_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'head', 'meta', 'link',
    'title', 'textarea', 'input', 'select', 'option',
    '[contenteditable="true"]', '[translate="no"]', '.notranslate',
    '[hidden]', '[aria-hidden="true"]'
  ].join(',');
  const MAX_TEXT_FLOW_ANCESTORS = 20;

  const layoutSharedStyles = new WeakMap();

  const URL_EMAIL_PATTERN = /^(?:https?:\/\/|www\.|mailto:|[\w.+-]+@[\w.-]+\.\w+)(?:\S*)$/i;
  const TARGET_LANGUAGE_TESTS = Object.freeze({
    'zh-CN': { pattern: /[\u3400-\u9fff]/g, minimumRatio: 0.35 },
    'zh-TW': { pattern: /[\u3400-\u9fff]/g, minimumRatio: 0.35 },
    ja: { pattern: /[\u3040-\u30ff\u3400-\u9fff]/g, minimumRatio: 0.25 },
    ko: { pattern: /[\uac00-\ud7af]/g, minimumRatio: 0.25 }
  });

  function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function getLanguageName(code) {
    return promptPolicy?.getLanguageName(code) || LANGUAGE_NAMES[code] || code || 'target language';
  }

  function normalizeContext(context) {
    requirePromptPolicy();
    return promptPolicy.normalizePromptContext(context);
  }

  function requirePromptPolicy() {
    if (!promptPolicy) {
      throw new Error('OIT prompt policy must load before translation-core.js');
    }
  }

  function buildSystemPrompt(config = {}, options = {}) {
    requirePromptPolicy();
    return promptPolicy.buildSystemPrompt(config, options);
  }

  function buildUserPrompt(texts, config = {}, context = {}) {
    requirePromptPolicy();
    return promptPolicy.buildUserPrompt(texts, config, context);
  }

  function buildTranslationRequest(texts, config = {}, context = {}) {
    requirePromptPolicy();
    return promptPolicy.buildTranslationRequest(texts, config, context);
  }

  function isPlausibleTranslation(source, translation, context = {}) {
    requirePromptPolicy();
    return promptPolicy.isPlausibleTranslation(source, translation, context);
  }

  function stripCodeFence(content) {
    let value = String(content ?? '').replace(/^\uFEFF/, '').trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
    if (fence) value = fence[1].trim();
    return value;
  }

  function findBalancedJsonArray(value) {
    const start = value.indexOf('[');
    if (start < 0) return '';

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index++) {
      const character = value[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '[') {
        depth++;
      } else if (character === ']') {
        depth--;
        if (depth === 0) return value.slice(start, index + 1);
      }
    }
    return '';
  }

  function tryParseJson(value) {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function extractStringArray(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object') return null;

    for (const key of ['translations', 'results', 'items', 'data', 'output']) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    return null;
  }

  function parseBatchTranslations(content, expectedCount) {
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      throw new Error('Expected translation count must be a positive integer');
    }

    const stripped = stripCodeFence(content);
    if (!stripped) throw new Error('Translation response was empty');

    let parsed = tryParseJson(stripped);
    if (!parsed.ok) {
      const arrayText = findBalancedJsonArray(stripped);
      if (arrayText) parsed = tryParseJson(arrayText);
    }
    if (!parsed.ok) throw new Error('Translation response was not valid JSON');

    const translations = extractStringArray(parsed.value);
    if (!translations || !translations.every(item => typeof item === 'string')) {
      throw new Error('Translation response must contain a JSON string array');
    }
    if (translations.length !== expectedCount) {
      throw new Error(`Translation count mismatch: expected ${expectedCount}, received ${translations.length}`);
    }
    return translations;
  }

  function parseSingleTranslation(content) {
    const stripped = stripCodeFence(content);
    if (!stripped) throw new Error('Translation response was empty');

    if (stripped.startsWith('[') || stripped.startsWith('{')) {
      try {
        const parsed = JSON.parse(stripped);
        const array = extractStringArray(parsed);
        if (array && array.length === 1 && typeof array[0] === 'string') return array[0];
        if (typeof parsed === 'string') return parsed;
      } catch (error) {
        // A plain-text translation is still valid for non-batch requests.
      }
    }

    if ((stripped.startsWith('"') && stripped.endsWith('"')) ||
        (stripped.startsWith("'") && stripped.endsWith("'"))) {
      return stripped.slice(1, -1);
    }
    return stripped;
  }

  function extractProtectedTokens(value) {
    return String(value ?? '').match(PROTECTED_TOKEN_PATTERN) || [];
  }

  function hasProtectedTokens(value) {
    return extractProtectedTokens(value).length > 0;
  }

  function validateProtectedTranslation(source, translation) {
    const expected = extractProtectedTokens(source);
    const actual = extractProtectedTokens(translation);
    if (expected.length !== actual.length) return false;
    if (expected.some((token, index) => token !== actual[index])) return false;

    if (expected.length > 0) {
      TOKEN_PARSE_PATTERN.lastIndex = 0;
      let depth = 0;
      const originalSource = source;
      let match;
      while ((match = TOKEN_PARSE_PATTERN.exec(originalSource))) {
        const kind = match[2];
        if (kind === 'OPEN') {
          depth++;
        } else if (kind === 'CLOSE') {
          depth--;
          if (depth < 0) return false;
        } else if (depth < 0) {
          return false;
        }
      }
      if (depth !== 0) return false;
    }

    return true;
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  }

  function removeUnsafeAttributes(element, removeIds) {
    for (const attribute of Array.from(element.attributes || [])) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
      } else if (removeIds && (name === 'id' || name === 'name')) {
        element.removeAttribute(attribute.name);
      } else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
        const value = String(attribute.value || '').trim();
        const compactValue = value.replace(/[\u0000-\u0020]+/g, '');
        if (/^(?:javascript|vbscript|data:text\/html)/i.test(compactValue)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  function sanitizeClone(node, deep) {
    const clone = node.cloneNode(deep);
    if (clone.nodeType !== 1) return clone;
    removeUnsafeAttributes(clone, true);
    if (deep) {
      clone.querySelectorAll?.('*').forEach(child => {
        removeUnsafeAttributes(child, true);
      });
    }
    return clone;
  }

  function hasBlockDescendant(element) {
    for (const child of element.children || []) {
      if (BLOCK_TAGS.has(child.tagName) || hasBlockDescendant(child)) return true;
    }
    return false;
  }

  function isProseStyledCode(node, tagName) {
    if (tagName !== 'CODE' || node.closest?.('pre')) return false;
    const text = normalizeWhitespace(node.textContent);
    if (text.length < 60 || text.split(/\s+/).length < 10) return false;

    const codeSignal = /(?:=>|===|!==|<\/?[a-z][^>]*>|[{};]|\b(?:const|let|var|function|class|import|export|return|if|else|for|while|def|public|private|package|sudo|npm|git|curl|docker|kubectl)\b|\w+\([^)]*\))/i;
    if (codeSignal.test(text)) return false;

    const sentenceSignal = /[.!?](?:\s|$)/;
    return sentenceSignal.test(text);
  }

  function shouldProtectNode(node, tagName) {
    if (isProseStyledCode(node, tagName)) return false;
    return ATOMIC_TAGS.has(tagName)
      || node.matches?.(PROTECTED_ATOM_SELECTOR)
      || node.closest?.('.notranslate, [translate="no"], [contenteditable="true"]');
  }

  function buildInlineTemplate(element) {
    if (!element || element.nodeType !== 1) {
      return {
        text: '',
        sourceHtml: '',
        fragments: new Map(),
        tokenSequence: [],
        hasProtectedMarkup: false
      };
    }

    if (hasBlockDescendant(element)) {
      return null;
    }

    const sourceHint = element.textContent || '';
    let nonce = hashText(`${element.tagName}:${sourceHint}:${element.childNodes.length}`);
    const fragments = new Map();
    const tokenSequence = [];
    let nextId = 0;

    const makeToken = kind => {
      let token;
      do {
        token = `[[OIT-${nonce}:${kind}:${nextId++}]]`;
      } while (sourceHint.includes(token));
      tokenSequence.push(token);
      return token;
    };

    const collect = node => {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1) return '';

      const tagName = String(node.tagName || '').toUpperCase();
      if (IGNORED_TAGS.has(tagName)) return '';
      if (shouldProtectNode(node, tagName)) {
        const token = makeToken('ATOM');
        fragments.set(token, { kind: 'atom', node: sanitizeClone(node, true) });
        return token;
      }

      const openToken = makeToken('OPEN');
      const closeToken = makeToken('CLOSE');
      fragments.set(openToken, { kind: 'open', shell: sanitizeClone(node, false), closeToken });
      fragments.set(closeToken, { kind: 'close', openToken });
      let inner = '';
      for (const child of node.childNodes || []) inner += collect(child);
      return `${openToken}${inner}${closeToken}`;
    };

    let text = '';
    for (const child of element.childNodes || []) text += collect(child);
    const orderedTokenSequence = extractProtectedTokens(text);
    return {
      text,
      sourceHtml: element.innerHTML,
      fragments,
      tokenSequence: orderedTokenSequence,
      hasProtectedMarkup: tokenSequence.length > 0
    };
  }

  function appendTextWithBreaks(parent, value) {
    const parts = String(value ?? '').split(/\r?\n/);
    for (let index = 0; index < parts.length; index++) {
      if (index > 0) parent.appendChild(parent.ownerDocument.createElement('br'));
      if (parts[index]) parent.appendChild(parent.ownerDocument.createTextNode(parts[index]));
    }
  }

  function renderProtectedTranslation(translation, template, documentRef) {
    const doc = documentRef;
    if (!doc) throw new Error('A document is required to render protected translation');

    const expectedTokens = template?.tokenSequence || [];
    const actualTokens = extractProtectedTokens(translation);
    if (expectedTokens.length !== actualTokens.length
        || expectedTokens.some((token, index) => token !== actualTokens[index])) {
      throw new Error('Protected token sequence does not match the source template');
    }

    const fragment = doc.createDocumentFragment();
    const stack = [{ node: fragment }];
    TOKEN_PARSE_PATTERN.lastIndex = 0;
    let cursor = 0;
    let match;

    while ((match = TOKEN_PARSE_PATTERN.exec(String(translation)))) {
      const current = stack[stack.length - 1].node;
      appendTextWithBreaks(current, translation.slice(cursor, match.index));
      const token = match[0];
      const payload = template?.fragments?.get(token);
      if (!payload) throw new Error(`Unknown protected token: ${token}`);

      if (payload.kind === 'open') {
        const shell = sanitizeClone(payload.shell, false);
        current.appendChild(shell);
        stack.push({ node: shell, closeToken: payload.closeToken });
      } else if (payload.kind === 'close') {
        const open = stack[stack.length - 1];
        if (stack.length <= 1 || !open || open.closeToken !== token) {
          throw new Error(`Unbalanced protected token: ${token}`);
        }
        stack.pop();
      } else {
        current.appendChild(sanitizeClone(payload.node, true));
      }
      cursor = match.index + token.length;
    }

    appendTextWithBreaks(stack[stack.length - 1].node, translation.slice(cursor));
    if (stack.length !== 1) throw new Error('Protected translation contains unbalanced tokens');
    return fragment;
  }

  function isTemplateCurrent(element, template) {
    if (!element || element.nodeType !== 1 || !template) return false;
    const current = buildInlineTemplate(element);
    if (!current
        || current.text !== template.text
        || current.sourceHtml !== template.sourceHtml
        || current.tokenSequence.length !== template.tokenSequence.length) {
      return false;
    }
    return current.tokenSequence.every((token, index) => token === template.tokenSequence[index]);
  }

  function isInlineHost(element) {
    return INLINE_HOST_TAGS.has(element.tagName);
  }

  function getComputedStyleSafe(element) {
    try {
      return element?.ownerDocument?.defaultView?.getComputedStyle(element) || null;
    } catch (error) {
      return null;
    }
  }

  function visibleLayoutText(element) {
    if (!element || element.nodeType !== 1) return '';
    const template = buildInlineTemplate(element);
    if (template) return normalizeWhitespace(template.text.replace(PROTECTED_TOKEN_PATTERN, ' '));
    return normalizeWhitespace(element.textContent);
  }

  function isProtectedLayoutNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const tagName = String(node.tagName || '').toUpperCase();
    return IGNORED_TAGS.has(tagName)
      || shouldProtectNode(node, tagName)
      || node.matches?.(IN_PLACE_PROTECTED_SELECTOR);
  }

  function hasLayoutText(node) {
    if (!node) return false;
    if (node.nodeType === 3) return /\S/.test(node.nodeValue || '');
    if (node.nodeType !== 1 || isProtectedLayoutNode(node)) return false;
    if (String(node.tagName || '').toUpperCase() === 'BR') return true;
    for (const child of node.childNodes || []) {
      if (hasLayoutText(child)) return true;
    }
    return false;
  }

  function getOnlyMeaningfulChild(element) {
    const children = Array.from(element.childNodes || []).filter(child => {
      if (child.nodeType === 3) return /\S/.test(child.nodeValue || '');
      return child.nodeType === 1 && hasLayoutText(child);
    });
    return children.length === 1 ? children[0] : null;
  }

  function resolveTranslationAppendTarget(element) {
    let current = element;
    for (let depth = 0; depth < 10; depth++) {
      const child = getOnlyMeaningfulChild(current);
      if (!(child instanceof Element) || isProtectedLayoutNode(child)) break;
      current = child;
    }
    return current;
  }

  function isCompactTranslationTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    const text = visibleLayoutText(node);
    const style = getComputedStyleSafe(node);
    if (!text || !style || style.display === 'contents' || node.querySelector?.('br')) return false;
    if (/pre|break-spaces/.test(style.whiteSpace) && /[\r\n]/.test(text)) return false;
    if (node.querySelector?.('p, li, ul, ol, blockquote, table, section, article')) return false;

    const normalized = text.replace(/\s+/g, ' ').trim();
    const closestControl = node.closest?.(COMPACT_CONTROL_CONTEXT_SELECTOR);
    const controlRect = closestControl?.getBoundingClientRect?.();
    const compactControl = controlRect
      && controlRect.width > 0
      && controlRect.height > 0
      && controlRect.height <= 80;
    return node.matches?.(DIRECT_CONTROL_SELECTOR)
      || Boolean(compactControl)
      || Boolean(node.closest?.('nav, [role="navigation"], [role="menu"], [role="toolbar"], [role="tablist"]'))
      || (normalized.length <= 24 && normalized.split(' ').length <= 4);
  }

  function createTranslationLayout() {
    return {
      changes: new Map(),
      wrappers: []
    };
  }

  function setTranslationStyle(layout, element, property, value) {
    if (!layout || !element?.style) return;
    let properties = layout.changes.get(element);
    if (!properties) {
      properties = new Map();
      layout.changes.set(element, properties);
    }
    let record = properties.get(property);
    if (!record) {
      let shared = layoutSharedStyles.get(element);
      if (!shared) {
        shared = new Map();
        layoutSharedStyles.set(element, shared);
      }
      record = shared.get(property);
      if (!record) {
        const first = shared.values().next().value;
        record = {
          element,
          property,
          original: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
          originalAttribute: first ? first.originalAttribute : element.getAttribute('style'),
          applied: '',
          owners: new Set()
        };
        shared.set(property, record);
      }
      record.owners.add(layout);
      properties.set(property, record);
    }
    element.style.setProperty(property, value, 'important');
    record.applied = element.style.getPropertyValue(property);
  }

  function rememberOriginalWrapper(layout, host, wrapper, parent) {
    layout.wrappers.push({ host, wrapper, parent });
  }

  function wrapChildrenForLayout(layout, host, element, className) {
    const wrapper = element.ownerDocument.createElement('span');
    wrapper.className = className;
    while (element.firstChild) wrapper.appendChild(element.firstChild);
    element.appendChild(wrapper);
    rememberOriginalWrapper(layout, host, wrapper, element);
    return wrapper;
  }

  function wrapDirectTextForFlex(layout, host, target) {
    const style = getComputedStyleSafe(target);
    if (!style || !/flex|grid/.test(style.display)) return target;
    const child = getOnlyMeaningfulChild(target);
    if (!(child instanceof Text)) return target;

    const wrapper = target.ownerDocument.createElement('span');
    wrapper.className = 'oit-original-flow';
    const next = child.nextSibling;
    wrapper.appendChild(child);
    target.insertBefore(wrapper, next);
    rememberOriginalWrapper(layout, host, wrapper, target);
    if (style.whiteSpace === 'nowrap') {
      setTranslationStyle(layout, wrapper, 'white-space', 'nowrap');
    }
    return wrapper;
  }

  function releaseTextFlowConstraints(layout, element, style, options = {}) {
    if (!layout || !element?.style || !style) return;
    const height = Number.parseFloat(style.height);
    const maxHeight = Number.parseFloat(style.maxHeight);
    const lineClamp = Number.parseInt(
      style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp'),
      10
    );
    const overflowX = style.overflowX || style.overflow;
    const overflowY = style.overflowY || style.overflow;
    const clipsX = ['hidden', 'clip'].includes(overflowX);
    const clipsY = ['hidden', 'clip'].includes(overflowY);

    if (height > 0) {
      if (!(Number.parseFloat(style.minHeight) >= height)) {
        setTranslationStyle(layout, element, 'min-height', style.height);
      }
      setTranslationStyle(layout, element, 'height', 'auto');
    }
    if (maxHeight > 0 || (style.maxHeight && style.maxHeight !== 'none')) {
      setTranslationStyle(layout, element, 'max-height', 'none');
    }
    if (options.releaseLineClamp && lineClamp > 0) {
      setTranslationStyle(layout, element, '-webkit-line-clamp', 'none');
      if (/\bwebkit-box\b/.test(style.display)) {
        setTranslationStyle(layout, element, 'display', 'block');
      }
    }
    if (options.releaseOverflow && (clipsX || clipsY)) {
      if (clipsX) setTranslationStyle(layout, element, 'overflow-x', 'visible');
      if (clipsY) setTranslationStyle(layout, element, 'overflow-y', 'visible');
      if (clipsX && clipsY && ['hidden', 'clip'].includes(style.overflow)) {
        setTranslationStyle(layout, element, 'overflow', 'visible');
      }
    }
  }

  function prepareBilingualTextFlow(layout, host, target) {
    const text = visibleLayoutText(target);
    if (!text) return;
    const closestControl = host.closest?.(DIRECT_CONTROL_SELECTOR);
    const controlRect = closestControl?.getBoundingClientRect?.();
    const compactControl = controlRect
      && controlRect.width > 0
      && controlRect.height > 0
      && controlRect.height <= 80
      ? closestControl
      : null;
    let current = target;
    const maxDepth = compactControl ? MAX_TEXT_FLOW_ANCESTORS : 6;
    for (let depth = 0; current && depth < maxDepth; depth++, current = current.parentElement) {
      const withinCompactControl = compactControl
        && (current === compactControl || compactControl.contains(current));
      if ((!withinCompactControl && current.matches(TEXT_FLOW_BOUNDARY_SELECTOR))
          || current.querySelector?.(TEXT_FLOW_MEDIA_SELECTOR)
          || (visibleLayoutText(current) !== text && !withinCompactControl)) {
        break;
      }
      const style = getComputedStyleSafe(current);
      if (!style
          || ['none', 'contents'].includes(style.display)
          || ['absolute', 'fixed'].includes(style.position)
          || style.visibility === 'hidden'
          || ['auto', 'scroll'].includes(style.overflowX || style.overflow)
          || ['auto', 'scroll'].includes(style.overflowY || style.overflow)) {
        break;
      }
      const height = Number.parseFloat(style.height);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      const padding = (Number.parseFloat(style.paddingTop) || 0)
        + (Number.parseFloat(style.paddingBottom) || 0);
      if (height > lineHeight * 12 + padding) break;
      releaseTextFlowConstraints(layout, current, style, {
        releaseLineClamp: Boolean(withinCompactControl),
        releaseOverflow: Boolean(withinCompactControl)
      });
      if (current === compactControl) break;
    }
  }

  function prepareBilingualCardFlow(layout, host, target) {
    const link = target.closest?.('a');
    if (!link) return;
    const path = [];
    let current = target;
    for (let depth = 0; current && current !== link && depth < 6; depth++, current = current.parentElement) {
      const style = getComputedStyleSafe(current);
      if (!style
          || current.matches(TEXT_FLOW_BOUNDARY_SELECTOR)
          || current.querySelector?.('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])')
          || ['absolute', 'fixed'].includes(style.position)
          || ['auto', 'scroll'].includes(style.overflowY || style.overflow)
          || ['none', 'contents'].includes(style.display)
          || style.visibility === 'hidden') {
        return;
      }
      path.push(current);
      if (!/flex/.test(style.display)
          || style.flexDirection !== 'column'
          || !['hidden', 'clip'].includes(style.overflowY || style.overflow)
          || current.children.length < 2) {
        continue;
      }
      setTranslationStyle(layout, current, 'min-height', 'min-content');
      for (const element of path.slice(0, -1)) {
        const flow = getComputedStyleSafe(element);
        const height = Number.parseFloat(flow?.height);
        if (!flow || flow.display === 'inline' || !(height > 0)) continue;
        if (!(Number.parseFloat(flow.minHeight) >= height)) {
          setTranslationStyle(layout, element, 'min-height', flow.height);
        }
        setTranslationStyle(layout, element, 'height', 'auto');
        if (flow.maxHeight && flow.maxHeight !== 'none') {
          setTranslationStyle(layout, element, 'max-height', 'none');
        }
      }
      return;
    }
  }

  function prepareBilingualClipping(layout, host, target, translationNode) {
    if (target !== host) return false;
    let clip = target;
    let lines = 0;
    for (let depth = 0; clip && depth < 4; depth++) {
      const style = getComputedStyleSafe(clip);
      if (!style) return false;
      const clamp = Number.parseInt(style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp'), 10);
      if (clamp > 0 && clamp <= 12) {
        lines = clamp;
        break;
      }
      const limit = Number.parseFloat(style.maxHeight);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      if (['hidden', 'clip'].includes(style.overflowY || style.overflow)
          && limit > 0 && lineHeight > 0) {
        const count = Math.floor(limit / lineHeight);
        if (count > 0 && count <= 12) {
          lines = count;
          break;
        }
      }
      const parent = clip.parentElement;
      if (!parent
          || parent.matches('body, main, article')
          || parent.children.length !== 1
          || Array.from(parent.childNodes).some(node => node.nodeType === 3 && node.nodeValue.trim())) {
        return false;
      }
      clip = parent;
    }
    if (!lines || !clip) return false;

    const source = wrapChildrenForLayout(layout, host, target, 'oit-original-flow');
    for (const block of [source, translationNode]) {
      block.style.setProperty('display', '-webkit-box', 'important');
      block.style.setProperty('-webkit-line-clamp', String(lines), 'important');
      block.style.setProperty('-webkit-box-orient', 'vertical', 'important');
      block.style.setProperty('overflow', 'hidden', 'important');
    }
    let current = target;
    while (current) {
      setTranslationStyle(layout, current, 'display', 'block');
      setTranslationStyle(layout, current, '-webkit-line-clamp', 'unset');
      setTranslationStyle(layout, current, 'max-height', 'none');
      setTranslationStyle(layout, current, 'height', 'auto');
      if (current === clip) break;
      current = current.parentElement;
    }
    return true;
  }

  function restoreRecordedStyles(element, records) {
    const originalAttribute = records[0].originalAttribute;
    const expected = element.ownerDocument.createElement('span');
    if (originalAttribute !== null) expected.setAttribute('style', originalAttribute);
    records.forEach(record => {
      expected.style.setProperty(record.property, record.applied, 'important');
    });
    if (element.style.cssText === expected.style.cssText) {
      if (originalAttribute === null) {
        element.style.cssText = '';
        if (element.hasAttribute('style')) element.removeAttribute('style');
      } else {
        element.setAttribute('style', originalAttribute);
      }
      return;
    }
    for (const record of records) {
      if (element.style.getPropertyValue(record.property) !== record.applied
          || element.style.getPropertyPriority(record.property) !== 'important') {
        continue;
      }
      if (record.original) {
        element.style.setProperty(record.property, record.original, record.priority);
      } else {
        element.style.removeProperty(record.property);
      }
    }
    if (originalAttribute === null && !element.style.cssText && element.hasAttribute('style')) {
      element.removeAttribute('style');
    }
  }

  function restoreTranslationLayout(layout) {
    if (!layout) return false;
    let restored = false;
    for (let index = layout.wrappers.length - 1; index >= 0; index--) {
      const { host, wrapper, parent } = layout.wrappers[index];
      if (wrapper?.parentElement === parent && host?.contains(parent)) {
        while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
        wrapper.remove();
        restored = true;
      }
    }
    layout.wrappers.length = 0;

    const recordsToRestore = [];
    for (const records of layout.changes.values()) {
      for (const record of records.values()) {
        record.owners.delete(layout);
        if (record.owners.size) continue;
        const shared = layoutSharedStyles.get(record.element);
        shared?.delete(record.property);
        if (shared && shared.size === 0) layoutSharedStyles.delete(record.element);
        recordsToRestore.push(record);
      }
    }
    layout.changes.clear();

    const grouped = new Map();
    for (const record of recordsToRestore) {
      const records = grouped.get(record.element) || [];
      records.push(record);
      grouped.set(record.element, records);
    }
    for (const [element, records] of grouped) {
      restoreRecordedStyles(element, records);
      restored = true;
    }
    return restored;
  }

  function textNodeAncestors(node, host) {
    const ancestors = [];
    let current = node.parentNode;
    while (current) {
      ancestors.push(current);
      if (current === host) return ancestors;
      current = current.parentNode;
    }
    return null;
  }

  function isTextPartCurrent(part, host) {
    if (!part?.node?.isConnected || part.node.data !== part.original) return false;
    let current = part.node;
    for (const ancestor of part.ancestors) {
      if (current.parentNode !== ancestor) return false;
      current = ancestor;
    }
    return current === host;
  }

  function buildTextFlowTemplate(element) {
    if (!element || element.nodeType !== 1 || hasBlockDescendant(element)) return null;
    const parts = [];
    const sourceHint = element.textContent || '';
    if (sourceHint.includes('[[OIT-')) return null;
    const nonce = hashText(`FLOW:${element.tagName}:${element.childNodes.length}:${sourceHint}`);
    let nextId = 0;
    const makeToken = () => {
      let token;
      do {
        token = `[[OIT-${nonce}:ATOM:${nextId++}]]`;
      } while (sourceHint.includes(token));
      return token;
    };

    const collect = node => {
      if (node.nodeType === 3) {
        if (!/\S/.test(node.data || '')) return;
        const ancestors = textNodeAncestors(node, element);
        if (!ancestors) return;
        parts.push({
          kind: 'text',
          node,
          original: node.data,
          ancestors,
          slot: makeToken()
        });
        return;
      }
      if (node.nodeType !== 1) return;
      if (isProtectedLayoutNode(node)) {
        parts.push({
          kind: 'atom',
          token: makeToken(),
          slot: makeToken()
        });
        return;
      }
      for (const child of node.childNodes || []) collect(child);
    };

    for (const child of element.childNodes || []) collect(child);
    if (!parts.some(part => part.kind === 'text' && /\S/.test(part.original))) return null;
    const text = parts.map(part => {
      const value = part.kind === 'text' ? part.original : part.token;
      return `${part.slot} ${value}`;
    }).join(' ');
    return {
      host: element,
      text,
      parts,
      slotTokens: parts.map(part => part.slot),
      tokenSequence: extractProtectedTokens(text),
      sourceHtml: element.innerHTML
    };
  }

  function preserveBoundaryWhitespace(original, translated) {
    const value = String(translated ?? '').trim();
    if (!value) return '';
    const leading = /^\s/.test(original) ? ' ' : '';
    const trailing = /\s$/.test(original) ? ' ' : '';
    return `${leading}${value}${trailing}`;
  }

  function translatedInteractiveLabels(host, translatedValues) {
    const elements = Array.from(host.querySelectorAll(INTERACTIVE_SELECTOR));
    if (host.matches(INTERACTIVE_SELECTOR)) elements.unshift(host);
    for (const element of elements) {
      if (!element.textContent?.trim()) continue;
      const walker = element.ownerDocument.createTreeWalker(element, 4);
      let label = '';
      let node;
      while ((node = walker.nextNode())) {
        label += translatedValues.get(node) ?? node.nodeValue ?? '';
      }
      if (!label.trim()) return false;
    }
    return true;
  }

  function applyTranslationInPlace(host, translation, template) {
    if (!host || !template || !template.text || !String(translation || '').trim()) return null;
    if (host.innerHTML !== template.sourceHtml) return null;
    if (!template.parts.every(part => part.kind !== 'text' || isTextPartCurrent(part, host))) return null;
    if (!validateProtectedTranslation(template.text, translation)) return null;

    const slots = template.slotTokens;
    const positions = [];
    let cursor = 0;
    for (const token of slots) {
      const index = String(translation).indexOf(token, cursor);
      if (index < 0) return null;
      positions.push(index);
      cursor = index + token.length;
    }
    const values = template.parts.map((part, index) => {
      const start = positions[index] + slots[index].length;
      const end = index + 1 < positions.length ? positions[index + 1] : translation.length;
      return translation.slice(start, end);
    });

    const translatedValues = new Map();
    for (let index = 0; index < template.parts.length; index++) {
      const part = template.parts[index];
      const value = values[index];
      if (part.kind === 'atom') {
        if (value.replace(part.token, '').trim() || extractProtectedTokens(value).length !== 1) {
          return null;
        }
        continue;
      }
      if (extractProtectedTokens(value).length) return null;
      translatedValues.set(part.node, preserveBoundaryWhitespace(part.original, value));
    }
    if (!Array.from(translatedValues.values()).some(value => value.trim())) return null;
    if (!translatedInteractiveLabels(host, translatedValues)) return null;

    const texts = [];
    for (const part of template.parts) {
      if (part.kind !== 'text') continue;
      const translated = translatedValues.get(part.node);
      if (translated === part.original) continue;
      texts.push({
        node: part.node,
        original: part.original,
        translated,
        ancestors: part.ancestors
      });
    }
    const hadHostClass = host.classList.contains('oit-translated-host');
    const hadClassAttribute = host.hasAttribute('class');
    texts.forEach(part => {
      part.node.data = part.translated;
    });
    if (!hadHostClass) host.classList.add('oit-translated-host');
    return {
      kind: 'in-place',
      host,
      texts,
      sourceHtml: template.sourceHtml,
      hadHostClass,
      hadClassAttribute
    };
  }

  function restoreTranslationInPlace(record) {
    if (!record?.host) return false;
    let restored = false;
    for (const part of record.texts || []) {
      if (part.node.data !== part.translated) continue;
      if (!isTextPartCurrent({ ...part, original: part.translated }, record.host)) continue;
      part.node.data = part.original;
      restored = true;
    }
    if (!record.hadHostClass
        && record.host.classList.contains('oit-translated-host')
        && !record.host.querySelector('.oit-translation')) {
      record.host.classList.remove('oit-translated-host');
    }
    if (!record.hadClassAttribute && record.host.classList.length === 0) {
      record.host.removeAttribute('class');
    }
    return restored;
  }

  function createTranslationView(element, translation, template, options = {}) {
    if (!isTemplateCurrent(element, template)) {
      throw new Error('Source DOM changed before the translation could be applied');
    }

    const doc = element.ownerDocument;
    const fragment = renderProtectedTranslation(translation, template, doc);
    const showOriginal = options.showOriginal !== false;
    const compact = isCompactTranslationTarget(element);
    const inline = options.inline ?? (isInlineHost(element) || compact);
    const layout = createTranslationLayout();
    let appendTarget = showOriginal
      ? (options.keepTranslationInHost
        ? element
        : resolveTranslationAppendTarget(element))
      : element;
    if (showOriginal) appendTarget = wrapDirectTextForFlex(layout, element, appendTarget);

    const translationNode = doc.createElement(inline ? 'span' : 'div');
    translationNode.className = `oit-translation${inline ? ' oit-inline-translation' : ''}`;
    if (options.dark) translationNode.classList.add('oit-dark');
    if (compact) {
      setTranslationStyle(layout, translationNode, 'display', 'block');
      setTranslationStyle(layout, translationNode, 'white-space', 'normal');
    }
    translationNode.appendChild(fragment);

    let originalWrapper = null;
    if (!showOriginal) {
      originalWrapper = doc.createElement(inline ? 'span' : 'div');
      originalWrapper.className = 'oit-original oit-original-hidden';
      while (element.firstChild) originalWrapper.appendChild(element.firstChild);
      element.appendChild(originalWrapper);
    }

    const clipped = showOriginal && !compact
      ? prepareBilingualClipping(layout, element, appendTarget, translationNode)
      : false;
    if (showOriginal && !clipped) prepareBilingualTextFlow(layout, element, appendTarget);
    appendTarget.appendChild(translationNode);
    if (showOriginal && !clipped) prepareBilingualCardFlow(layout, element, appendTarget);

    const hadHostClass = element.classList.contains('oit-translated-host');
    const hadClassAttribute = element.hasAttribute('class');
    if (!hadHostClass) element.classList.add('oit-translated-host');

    return {
      kind: 'bilingual',
      host: element,
      translationNode,
      originalWrapper,
      sourceHtml: template.sourceHtml,
      hadHostClass,
      hadClassAttribute,
      layout
    };
  }

  function restoreTranslationView(record) {
    if (!record?.host) return false;
    if (record.kind === 'in-place') return restoreTranslationInPlace(record);

    let restored = false;
    const { host, translationNode, originalWrapper, layout } = record;
    if (translationNode?.parentNode) {
      translationNode.remove();
      restored = true;
    }

    if (originalWrapper?.parentNode === host) {
      while (originalWrapper.firstChild) {
        host.insertBefore(originalWrapper.firstChild, originalWrapper);
      }
      originalWrapper.remove();
      restored = true;
    }

    if (restoreTranslationLayout(layout)) restored = true;
    if (!record.hadHostClass
        && host.classList.contains('oit-translated-host')
        && !host.querySelector(':scope > .oit-translation')) {
      host.classList.remove('oit-translated-host');
    }
    if (!record.hadClassAttribute && host.classList.length === 0) {
      host.removeAttribute('class');
    }
    return restored;
  }

  function isLikelyTargetLanguage(text, targetLang) {
    const test = TARGET_LANGUAGE_TESTS[targetLang];
    if (!test) return false;
    const compact = String(text ?? '').replace(/\s+/g, '');
    if (!compact) return false;
    const matches = compact.match(test.pattern) || [];
    return matches.length / compact.length >= test.minimumRatio;
  }

  function shouldSkipText(text, config = {}) {
    const value = String(text ?? '').trim();
    if (value.length < 2) return true;
    if (URL_EMAIL_PATTERN.test(value)) return true;

    const withoutTokens = value.replace(PROTECTED_TOKEN_PATTERN, ' ').trim();
    if (!withoutTokens) return true;
    if (URL_EMAIL_PATTERN.test(withoutTokens)) return true;
    if (!/[\p{L}\p{N}]/u.test(withoutTokens)) return true;
    if (config.autoDetect !== false && isLikelyTargetLanguage(withoutTokens, config.targetLang)) return true;
    return false;
  }

  function validateBatchTranslations(sources, translations) {
    if (!Array.isArray(sources) || !Array.isArray(translations) || sources.length !== translations.length) {
      return false;
    }
    return sources.every((source, index) => {
      const translation = translations[index];
      return typeof translation === 'string'
        && translation.trim().length > 0
        && validateProtectedTranslation(source, translation);
    });
  }

  return Object.freeze({
    LANGUAGE_NAMES,
    buildSystemPrompt,
    buildUserPrompt,
    buildTranslationRequest,
    isPlausibleTranslation,
    parseBatchTranslations,
    parseSingleTranslation,
    extractProtectedTokens,
    hasProtectedTokens,
    validateProtectedTranslation,
    validateBatchTranslations,
    buildInlineTemplate,
    buildTextFlowTemplate,
    isTemplateCurrent,
    renderProtectedTranslation,
    resolveTranslationAppendTarget,
    isCompactTranslationTarget,
    createTranslationView,
    applyTranslationInPlace,
    restoreTranslationView,
    restoreTranslationLayout,
    hasBlockDescendant,
    isLikelyTargetLanguage,
    shouldSkipText,
    normalizeWhitespace
  });
});
