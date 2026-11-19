/**
 * Open Immerse Translate - page discovery kernel.
 *
 * The scanner is independent, dependency-free code. It selects readable page
 * content for smart scope, supports full-page coverage, tracks open shadow
 * roots, and supplies bounded semantic context to the translation core.
 */
(function initPageScanner(root, factory) {
  const signals = root.OITContentSignals
    || (typeof require === 'function' ? require('./content-signals.js') : null);
  const classifier = root.OITContentUnitClassifier
    || (typeof require === 'function' ? require('./content-unit-classifier.js') : null);
  const contentFilter = root.OITContentFilter
    || (typeof require === 'function' ? require('./content-filter.js') : null);
  const contentRootDetector = root.OITContentRootDetector
    || (typeof require === 'function' ? require('./content-root-detector.js') : null);
  const unitizer = root.OITContentUnitizer
    || (typeof require === 'function' ? require('./content-unitizer.js') : null);
  const siteAdapters = root.OITSiteAdapters
    || (typeof require === 'function' ? require('./content-site-adapters.js') : null);
  const uiPolicy = root.OITContentUiPolicy
    || (typeof require === 'function' ? require('./content-ui-policy.js') : null);
  const api = factory(
    signals,
    classifier,
    contentFilter,
    contentRootDetector,
    unitizer,
    siteAdapters,
    uiPolicy
  );

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITPageScanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPageScanner(
  signals,
  classifier,
  contentFilter,
  contentRootDetector,
  unitizer,
  siteAdapters,
  uiPolicy
) {
  'use strict';

  if (!signals
      || !classifier
      || !contentFilter
      || !contentRootDetector
      || !unitizer
      || !siteAdapters
      || !uiPolicy) {
    throw new Error(
      'Content signals, unitizer, classifier, filter, root detector, site adapters, '
        + 'and UI policy '
        + 'must load before page-scanner.js'
    );
  }

  const HARD_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD',
    'PRE', 'CODE', 'KBD', 'SAMP', 'VAR', 'MATH', 'MJX-CONTAINER',
    'SVG', 'CANVAS', 'IMG', 'PICTURE', 'SOURCE', 'TRACK',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED',
    'VIDEO', 'AUDIO', 'MAP', 'AREA', 'BR', 'HR'
  ]);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
    'OL', 'P', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD',
    'TR', 'UL'
  ]);
  const SEMANTIC_TARGETS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'figcaption',
    'li', 'dt', 'dd', 'td', 'th', 'caption', 'label', 'legend', 'summary',
    '[role="heading"]', '[role="article"]'
  ].join(',');
  const CONTROL_TARGETS = uiPolicy.INTERACTIVE_CONTROL_SELECTOR;
  const GENERIC_TARGETS = [
    'div', 'span', 'strong', 'b', 'em', 'i', 'small', 'cite', 'q',
    'abbr', 'time', '[class*="title"]', '[class*="headline"]',
    '[class*="summary"]', '[class*="description"]', '[class*="excerpt"]'
  ].join(',');
  const ROOT_CANDIDATES = [
    'main', 'article', '[role="main"]', '[role="article"]',
    '[itemprop="articleBody"]', '[class*="article-body"]',
    '[class*="articleBody"]', '[class*="post-content"]', '[class*="postContent"]',
    '[class*="entry-content"]', '[class*="entryContent"]', '[class*="story-body"]',
    '[class*="storyBody"]', '[class*="markdown-body"]', '[class*="prose"]',
    '[class*="content"]', '[class*="post"]', '[class*="story"]',
    '[class*="docs"]', '[class*="document"]', 'section', 'div'
  ].join(',');
  const HARD_PROTECTED_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp',
    'var', 'math', '.math', 'mjx-container', 'svg', 'canvas', 'iframe',
    'input', 'textarea', 'select', 'option',
    '[contenteditable]:not([contenteditable="false"])',
    '[translate="no"]', '.notranslate', '.oit-wrapper',
    '.oit-translated-host', '.oit-translation', '.oit-original',
    '[hidden]', '[aria-hidden="true"]'
  ].join(',');
  const SMART_UI_SELECTOR = [
    'nav', 'footer', 'form', 'dialog', '[role="navigation"]',
    '[role="menu"]', '[role="menubar"]', '[role="toolbar"]',
    '[role="tablist"]', '[role="tab"]'
  ].join(',');
  const ADAPTIVE_UI_ROOT_SELECTOR = uiPolicy.ADAPTIVE_UI_ROOT_SELECTOR;
  const OWNED_SELECTOR = '.oit-wrapper, .oit-translated-host, .oit-translation, .oit-original';

  const DEFAULT_BUDGETS = Object.freeze({
    root: 600,
    page: 5000,
    adaptive: 900,
    supplemental: 900,
    dynamic: 900,
    siteRoots: 120,
    shadowRoots: 160
  });

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function structuralHint(element) {
    return signals.getStructuralHint(element);
  }

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

  function composedContains(ancestor, node) {
    if (!ancestor || !node) return false;
    let current = node;
    while (current) {
      if (current === ancestor) return true;
      current = getComposedParentElement(current);
    }
    return false;
  }

  function composedClosest(element, selector) {
    let current = element;
    while (current) {
      if (current.nodeType === 1 && current.matches?.(selector)) return current;
      current = getComposedParentElement(current);
    }
    return null;
  }

  function isOwnedElement(element) {
    return Boolean(composedClosest(element, OWNED_SELECTOR));
  }

  function isAdaptiveUiLabel(element, context = null) {
    return uiPolicy.isAdaptiveUiLabel(element, context?.adaptiveUiRoots);
  }

  function isWithinAdaptiveUiScope(element, context = null) {
    return uiPolicy.isWithinAdaptiveUiScope(element, context?.adaptiveUiRoots);
  }

  function isRelatedToAdaptiveUiScope(element, context = null) {
    if (!element || !context?.adaptiveUiRoots) return false;
    for (const root of context.adaptiveUiRoots) {
      if (!root?.isConnected) continue;
      if (composedContains(root, element) || composedContains(element, root)) {
        return true;
      }
    }
    return false;
  }

  function createScanContext(options = {}) {
    return {
      scope: options.scope === 'full' ? 'full' : 'smart',
      site: options.site || siteAdapters.detectSite(),
      stats: {
        scannedElements: 0,
        textNodes: 0,
        classifiedElements: 0,
        skippedSubtrees: 0,
        budgetExceeded: false,
        emptyRootBodyFallback: 0,
        openShadowRoots: 0,
        adaptiveUiRootsFound: 0,
        adaptiveUiRootsAccepted: 0,
        adaptiveUiRootsRejected: 0,
        adaptiveUiRootSources: {},
        adaptiveUiRootSamples: [],
        supplementalRootsFound: 0,
        supplementalRootsAccepted: 0,
        supplementalRootsRejected: 0,
        supplementalRootSamples: []
      },
      budgets: {
        root: options.rootBudget ?? DEFAULT_BUDGETS.root,
        page: options.pageBudget ?? DEFAULT_BUDGETS.page,
        adaptive: options.adaptiveBudget ?? DEFAULT_BUDGETS.adaptive,
        supplemental: options.supplementalBudget
          ?? DEFAULT_BUDGETS.supplemental,
        dynamic: options.dynamicBudget ?? DEFAULT_BUDGETS.dynamic,
        siteRoots: options.siteRootBudget ?? DEFAULT_BUDGETS.siteRoots,
        shadowRoots: options.shadowRootBudget ?? DEFAULT_BUDGETS.shadowRoots
      },
      text: new WeakMap(),
      prose: new WeakMap(),
      signals: new WeakMap(),
      visibility: new WeakMap(),
      classification: new WeakMap(),
      contentRoot: null,
      contentRoots: [],
      contentRootBase: null,
      adaptiveUiRoots: new Set(),
      supplementalRoots: new Set(),
      openShadowRoots: new Set(),
      shadowDiscovery: {
        initialized: false,
        lastFullAt: 0,
        fullRuns: 0
      }
    };
  }

  function resolveSite(context, options = {}) {
    const site = options.site
      || context?.site
      || siteAdapters.detectSite();
    if (context) context.site = site;
    return site;
  }

  function getSemanticTargetSelector(site) {
    return [SEMANTIC_TARGETS, ...siteAdapters.getSemanticTargets(site)].join(',');
  }

  function invalidateScanCache(context, root) {
    if (!context || !root) return;
    const clearElement = element => {
      context.text.delete(element);
      context.prose.delete(element);
      context.signals.delete(element);
      context.visibility.delete(element);
      context.classification.delete(element);
    };
    if (root.nodeType === 1) {
      clearElement(root);
      let parent = getComposedParentElement(root);
      while (parent) {
        clearElement(parent);
        parent = getComposedParentElement(parent);
      }
    }

    let count = 0;
    const walker = root.ownerDocument?.createTreeWalker
      ? root.ownerDocument.createTreeWalker(root, 1)
      : document.createTreeWalker(root, 1);
    while (walker.nextNode() && count++ < 800) {
      clearElement(walker.currentNode);
    }
  }

  function discoverOpenShadowRoots(root, registry = new Set(), limit = DEFAULT_BUDGETS.shadowRoots) {
    pruneShadowRootRegistry(registry);
    const pending = [root];
    const visited = new Set();

    while (pending.length > 0 && registry.size < limit) {
      const currentRoot = pending.shift();
      if (!currentRoot || visited.has(currentRoot)) continue;
      visited.add(currentRoot);
      if (!currentRoot.querySelectorAll) continue;

      const elements = currentRoot.nodeType === 1
        ? [currentRoot, ...currentRoot.querySelectorAll('*')]
        : Array.from(currentRoot.querySelectorAll('*'));
      for (const element of elements) {
        if (isOwnedElement(element)) continue;
        const shadowRoot = element.shadowRoot;
        if (!shadowRoot || registry.has(shadowRoot)) continue;
        registry.add(shadowRoot);
        pending.push(shadowRoot);
        if (registry.size >= limit) break;
      }
    }

    return registry;
  }

  function pruneShadowRootRegistry(registry) {
    if (!registry) return registry;
    for (const shadowRoot of Array.from(registry)) {
      if (!shadowRoot.host?.isConnected) registry.delete(shadowRoot);
    }
    return registry;
  }

  /**
   * Keep shadow-root discovery fresh without walking the entire document on
   * every viewport scan. Mutation-triggered subtree scans still register new
   * roots immediately; this throttle covers attachShadow on existing hosts.
   */
  function refreshOpenShadowRoots(root, context, options = {}) {
    if (!context || !root) return context?.openShadowRoots || new Set();
    const registry = pruneShadowRootRegistry(context.openShadowRoots);
    const interval = options.interval ?? 15000;
    const now = options.now ?? performance.now();
    const discovery = context.shadowDiscovery || {
      initialized: false,
      lastFullAt: 0,
      fullRuns: 0
    };
    context.shadowDiscovery = discovery;

    const due = !discovery.initialized
      || options.force === true
      || now - discovery.lastFullAt >= interval;
    if (due) {
      discoverOpenShadowRoots(root, registry, context.budgets.shadowRoots);
      discovery.initialized = true;
      discovery.lastFullAt = now;
      discovery.fullRuns++;
    }
    context.stats.openShadowRoots = registry.size;
    return registry;
  }

  function getQueryRoots(context, contentRoot, primaryRoot) {
    const queryBase = primaryRoot || contentRoot || document;
    const roots = [queryBase];
    const shadowRoots = context?.openShadowRoots || new Set();
    for (const shadowRoot of shadowRoots) {
      if (!shadowRoot.host?.isConnected) continue;
      if (queryBase !== document
          && shadowRoot !== queryBase
          && !composedContains(queryBase, shadowRoot.host)) {
        continue;
      }
      roots.push(shadowRoot);
    }
    return Array.from(new Set(roots));
  }

  function pruneAdaptiveUiRoots(context) {
    if (!context?.adaptiveUiRoots) return;
    for (const root of context.adaptiveUiRoots) {
      if (!root?.isConnected) context.adaptiveUiRoots.delete(root);
    }
  }

  function recordAdaptiveUiRoot(
    context,
    root,
    source,
    accepted,
    reason = null
  ) {
    const stats = context?.stats;
    if (!stats) return;
    const normalizedSource = source || 'unknown';
    stats.adaptiveUiRootsFound++;
    if (accepted) {
      stats.adaptiveUiRootsAccepted++;
    } else {
      stats.adaptiveUiRootsRejected++;
    }
    stats.adaptiveUiRootSources[normalizedSource] =
      (stats.adaptiveUiRootSources[normalizedSource] || 0) + 1;
    if (stats.adaptiveUiRootSamples.length < 40) {
      stats.adaptiveUiRootSamples.push({
        source: normalizedSource,
        accepted,
        reason,
        tag: root?.tagName || null,
        id: root?.id || null
      });
    }
  }

  function getAdaptiveUiRootRejectionReason(context, root) {
    if (!context?.adaptiveUiRoots) return 'missing-context';
    if (!root?.isConnected) return 'disconnected';
    if (isOwnedElement(root)) return 'owned-translation';
    if (!isVisible(root, context)) return 'not-visible';
    return null;
  }

  function registerAdaptiveUiRoot(context, root, source = 'unknown') {
    const rejectionReason = getAdaptiveUiRootRejectionReason(context, root);
    if (rejectionReason) {
      recordAdaptiveUiRoot(
        context,
        root,
        source,
        false,
        rejectionReason
      );
      return false;
    }
    context.adaptiveUiRoots.add(root);
    recordAdaptiveUiRoot(context, root, source, true);
    return true;
  }

  function findAdaptiveUiRoots(context, base = document.body) {
    if (!base?.querySelectorAll) return [];
    pruneAdaptiveUiRoots(context);
    const genericRoots = uiPolicy.findAdaptiveUiRoots(base, {
      isVisible: element => isVisible(element, context)
    });
    const siteRoots = siteAdapters.diagnoseAdaptiveRoots?.(base, {
      site: resolveSite(context)
    }) || [];
    const discovered = [
      ...genericRoots.map(root => ({ root, source: 'generic' })),
      ...siteRoots
    ];
    const accepted = [];
    for (const item of discovered) {
      if (!item?.root) continue;
      if (registerAdaptiveUiRoot(context, item.root, item.source)) {
        accepted.push(item.root);
      }
    }
    return Array.from(new Set(accepted));
  }

  function pruneSupplementalRoots(context) {
    if (!context?.supplementalRoots) return;
    for (const root of context.supplementalRoots) {
      if (!root?.isConnected) context.supplementalRoots.delete(root);
    }
  }

  function recordSupplementalRoot(
    context,
    root,
    accepted,
    reason = null
  ) {
    const stats = context?.stats;
    if (!stats) return;
    stats.supplementalRootsFound++;
    if (accepted) {
      stats.supplementalRootsAccepted++;
    } else {
      stats.supplementalRootsRejected++;
    }
    if (stats.supplementalRootSamples.length < 20) {
      stats.supplementalRootSamples.push({
        accepted,
        reason,
        tag: root?.tagName || null,
        id: root?.id || null
      });
    }
  }

  function registerSupplementalRoot(context, root) {
    if (!root?.isConnected || root.nodeType !== Node.ELEMENT_NODE) {
      recordSupplementalRoot(context, root, false, 'disconnected');
      return false;
    }
    if (root.closest?.(OWNED_SELECTOR) || isOwnedElement(root)) {
      recordSupplementalRoot(context, root, false, 'owned-translation');
      return false;
    }
    if (!isVisible(root, context)) {
      recordSupplementalRoot(context, root, false, 'not-visible');
      return false;
    }
    context.supplementalRoots.add(root);
    recordSupplementalRoot(context, root, true);
    return true;
  }

  function findSiteSupplementalRoots(context, base = document.body) {
    if (!context || !base) return [];
    const searchBase = base.nodeType === Node.DOCUMENT_NODE ? base.body : base;
    if (!searchBase?.querySelectorAll) return [];
    pruneSupplementalRoots(context);
    const roots = siteAdapters.findSupplementalRoots?.(searchBase, {
      site: resolveSite(context),
      isVisible: element => isVisible(element, context),
      limit: context.budgets.siteRoots
    }) || [];
    return Array.from(new Set(roots)).filter(root => (
      registerSupplementalRoot(context, root)
    ));
  }

  function resolveNearestSupplementalRoot(context, element) {
    if (!context || !element) return null;
    const root = siteAdapters.getSupplementalRoot?.(element, {
      site: resolveSite(context),
      isVisible: candidate => isVisible(candidate, context)
    });
    return root && registerSupplementalRoot(context, root) ? root : null;
  }

  function isRelatedToSupplementalScope(element, context = null) {
    if (!element || !context?.supplementalRoots) return false;
    const nearest = resolveNearestSupplementalRoot(context, element);
    if (nearest) return true;
    for (const root of context.supplementalRoots) {
      if (!root?.isConnected) continue;
      if (composedContains(root, element) || composedContains(element, root)) {
        return true;
      }
    }
    return false;
  }

  function resolveNearestAdapterRoot(context, element) {
    const root = siteAdapters.getAdaptiveRoot?.(element, {
      site: resolveSite(context)
    });
    if (root && registerAdaptiveUiRoot(context, root, 'nearest-site')) {
      return root;
    }
    const genericRoot = uiPolicy.findAdaptiveUiRoot?.(element, {
      isVisible: candidate => isVisible(candidate, context)
    });
    return genericRoot
      && registerAdaptiveUiRoot(context, genericRoot, 'nearest-generic')
      ? genericRoot
      : null;
  }

  function registerNearestSiteAdaptiveRoot(context, element) {
    return Boolean(resolveNearestAdapterRoot(context, element));
  }

  function normalizeContentRoots(primaryRoot, roots = []) {
    const normalized = [];
    for (const root of [primaryRoot, ...(Array.isArray(roots) ? roots : [])]) {
      if (!root?.isConnected || root.nodeType !== 1) continue;
      if (normalized.some(existing => (
        existing === root || existing.contains(root) || root.contains(existing)
      ))) {
        continue;
      }
      normalized.push(root);
    }
    return normalized.length ? normalized : [primaryRoot || document.body];
  }

  function getContentRoots(context, primaryRoot = context?.contentRoot) {
    if (!context) return primaryRoot ? [primaryRoot] : [document.body];
    const roots = normalizeContentRoots(primaryRoot, context.contentRoots);
    context.contentRoots = roots;
    return roots;
  }

  function findSiteContentRoots(context, base = document.body) {
    if (!context || !base) return [];
    const searchBase = base.nodeType === Node.DOCUMENT_NODE
      ? base.body
      : base;
    if (!searchBase?.querySelectorAll) return [];
    const roots = siteAdapters.findContentRoots?.(searchBase, {
      site: resolveSite(context),
      isVisible: element => isVisible(element, context),
      limit: context.budgets.siteRoots
    }) || [];
    return Array.from(new Set(roots)).filter(root => (
      root?.nodeType === Node.ELEMENT_NODE
      && root.isConnected
      && isVisible(root, context)
    ));
  }

  function registerSiteContentRoot(context, primaryRoot, root) {
    if (!context || !root?.isConnected || root.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const base = primaryRoot || context.contentRoot || document.body;
    context.contentRoots = normalizeContentRoots(
      base,
      [...(context.contentRoots || []), root]
    );
    return context.contentRoots.some(candidate => (
      candidate === document.body || composedContains(candidate, root)
    ));
  }

  function isVisible(element, context) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    const cached = context?.visibility.get(element);
    if (cached !== undefined) return cached;

    let visible = true;
    let current = element;
    while (current) {
      if (current.nodeType === 1) {
        if (current.hasAttribute('hidden')
            || current.getAttribute('aria-hidden') === 'true'
            || current.closest?.('details:not([open]) > :not(summary)')) {
          visible = false;
          break;
        }
        let style;
        try {
          style = (current.ownerDocument?.defaultView || window).getComputedStyle(current);
        } catch (error) {
          style = null;
        }
        if (style
            && (style.display === 'none'
              || style.visibility === 'hidden'
              || style.visibility === 'collapse'
              || style.opacity === '0')) {
          visible = false;
          break;
        }
      }
      current = getComposedParentElement(current);
    }

    if (visible) {
      visible = uiPolicy.hasVisibleArea(element);
    }
    context?.visibility.set(element, visible);
    return visible;
  }

  function getElementText(element, context) {
    const cached = context?.text.get(element);
    if (cached !== undefined) return cached;

    const text = signals.getVisibleText(element);
    context?.text.set(element, text);
    return text;
  }

  function getTextSignals(element, context) {
    const cached = context?.signals.get(element);
    if (cached) return cached;
    const value = signals.getTextSignals(element);
    context?.signals.set(element, value);
    context?.text.set(element, value.text);
    return value;
  }

  function findContentRoot(context, primaryRoot, options = {}) {
    const base = primaryRoot || document.body;
    if (!base) return document.body;
    const siteContentRoots = options.discoverSiteContentRoots === false
      ? []
      : findSiteContentRoots(context, base.ownerDocument?.body || base);
    if (context) context.siteContentRoots = siteContentRoots;
    const cached = context?.contentRoot;
    const sameBase = !context?.contentRootBase
      || context.contentRootBase === base
      || (context.contentRootBase === document && base === document.body);
    const insideBase = base === document
      || base === document.body
      || composedContains(base, cached);
    if (options.refresh !== true
        && cached?.isConnected
        && sameBase
        && insideBase) {
      context.contentRoots = normalizeContentRoots(cached, [
        ...(context.contentRoots || []),
        ...siteContentRoots
      ]);
      return cached;
    }
    if (context) context.contentRootBase = base;

    const detection = contentRootDetector.detectContentRoot(base, {
      fallback: document.body,
      isVisible: element => isVisible(element, context),
      isOwned: isOwnedElement,
      candidateLimit: context?.budgets.root || DEFAULT_BUDGETS.root,
      preferMain: options.preferMain !== false
    });
    const root = detection.root || document.body;
    if (context) {
      context.contentRoot = root;
      context.contentRoots = normalizeContentRoots(root, [
        ...detection.roots,
        ...siteContentRoots
      ]);
      context.contentRootBase = base;
      context.contentRootDetection = detection;
    }
    return root;
  }

  function resolveContentRootForElement(element, primaryRoot, context = null) {
    const roots = context
      ? normalizeContentRoots(primaryRoot, context.contentRoots)
      : normalizeContentRoots(primaryRoot);
    return roots.find(root => composedContains(root, element))
      || primaryRoot
      || document.body;
  }

  function isPlainTextDocument(documentRef = document) {
    if (!documentRef?.body) return false;
    if (String(documentRef.contentType || '').toLowerCase() === 'text/plain') return true;
    const meaningful = Array.from(documentRef.body.childNodes).filter(node => {
      return node.nodeType === 1 || (node.nodeType === 3 && /\S/.test(node.nodeValue || ''));
    });
    return meaningful.length === 1
      && meaningful[0].nodeType === 1
      && String(meaningful[0].tagName || '').toUpperCase() === 'PRE'
      && !/\S/.test(Array.from(documentRef.body.childNodes)
        .filter(node => node !== meaningful[0])
        .map(node => node.textContent || '')
        .join(''));
  }

  function classifyElement(element, scope, context, contentRoot, options = {}) {
    const cacheKey = scope === 'full' ? 'full' : 'smart';
    const domain = options.supplementalDomain === true
      ? 'supplemental'
      : 'default';
    const cache = context?.classification.get(element);
    if (cache && cache.scope === cacheKey && cache.domain === domain) return cache;

    context && context.stats.classifiedElements++;
    const sitePolicy = siteAdapters.getElementPolicy?.(
      resolveSite(context),
      element,
      cacheKey
    );
    if (sitePolicy?.action === 'skip-self' || sitePolicy?.action === 'skip-subtree') {
      const result = {
        scope: cacheKey,
        domain,
        allow: false,
        action: sitePolicy.action,
        kind: 'metadata',
        role: sitePolicy.role || 'metadata',
        reason: sitePolicy.reason || 'site-metadata',
        confidence: 1,
        siteRole: sitePolicy.role || 'metadata',
        classification: null
      };
      context?.classification.set(element, result);
      return result;
    }

    const textSignals = getTextSignals(element, context);
    const hintSignals = signals.getStructuralSignals(element);
    const proseEvidence = signals.getProseEvidence(textSignals);
    const classification = sitePolicy?.action === 'keep'
      ? Object.freeze({
        kind: sitePolicy.role === 'navigation-label' ? 'ui' : 'paragraph',
        role: sitePolicy.role,
        confidence: 1,
        reasons: Object.freeze(['site-adapter-semantic-unit'])
      })
      : classifier.classifyContentUnit(element, {
        textSignals,
        hintSignals,
        proseEvidence
      });
    const adaptiveUi = cacheKey === 'smart' && isAdaptiveUiLabel(element, context);
    const supplementalContent = sitePolicy?.role === 'supplemental-content';
    let decision = contentFilter.decideContentFilter(element, {
      scope: cacheKey,
      textSignals,
      hintSignals,
      proseEvidence,
      classification,
      adaptiveUi,
      adaptiveUiLabel: adaptiveUi,
      supplementalContent,
      trustedContentRoot: Boolean(
        contentRoot
        && contentRoot !== document.body
        && composedContains(contentRoot, element)
      )
    });

    if (decision.action === 'keep'
        && contentRoot
        && contentRoot !== document.body
        && !composedContains(contentRoot, element)
        && !adaptiveUi
        && !supplementalContent) {
      decision = Object.freeze({
        ...decision,
        action: 'skip-self',
        reason: 'outside-smart-content-root'
      });
    }
    if (!isVisible(element, context)) {
      decision = Object.freeze({
        ...decision,
        action: 'skip-subtree',
        reason: 'hidden-element'
      });
    }

    const result = {
      scope: cacheKey,
      domain,
      allow: decision.action === 'keep',
      action: decision.action,
      kind: classification.kind,
      role: classification.role,
      reason: decision.reason,
      confidence: Math.min(decision.confidence, classification.confidence),
      siteRole: sitePolicy?.role
        || (adaptiveUi ? 'navigation-label' : null)
        || siteAdapters.getSemanticContentRole(resolveSite(context), element),
      classification
    };

    context?.classification.set(element, result);
    return result;
  }

  function findSemanticTarget(element, scope, contentRoot, semanticSelector) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.matches?.(semanticSelector)) return current;
      if (scope === 'full' && current.matches?.(CONTROL_TARGETS)) {
        return findControlLabelTarget(element, current);
      }
      if (current === contentRoot || current === document.body) break;
      current = getComposedParentElement(current);
    }
    return null;
  }

  function findGenericTarget(element, scope, contentRoot, context = null) {
    if (scope === 'smart' && isAdaptiveUiLabel(element, context)) {
      const control = composedClosest(element, CONTROL_TARGETS);
      return findControlLabelTarget(element, control);
    }
    if (scope === 'smart' && composedClosest(element, CONTROL_TARGETS)) {
      return null;
    }
    if (scope === 'full') {
      const control = composedClosest(element, CONTROL_TARGETS);
      if (control) {
        const label = findControlLabelTarget(element, control);
        if (label) return label;
        return null;
      }
    }

    let current = element;
    let best = null;
    while (current && current.nodeType === 1) {
      if (current === contentRoot || current === document.body) break;
      if (current.matches?.(HARD_PROTECTED_SELECTOR)) return null;
      const tag = String(current.tagName || '').toUpperCase();
      const text = normalize(current.textContent);
      if (!text) return null;
      if (BLOCK_TAGS.has(tag) && !['DIV', 'SECTION', 'ARTICLE'].includes(tag)) {
        best = best || current;
        break;
      }
      if (!BLOCK_TAGS.has(tag) || current.children.length <= 1) best = current;
      const parent = getComposedParentElement(current);
      if (!parent) break;
      if (BLOCK_TAGS.has(String(parent.tagName || '').toUpperCase())) break;
      current = parent;
    }
    return best || element;
  }

  function findControlLabelTarget(element, control) {
    if (!element || !control || !composedContains(control, element)) return null;
    if (composedClosest(control, HARD_PROTECTED_SELECTOR)) return null;
    return unitizer.findControlTranslationTarget(control, {
      protectedSelector: HARD_PROTECTED_SELECTOR,
      controlSelector: CONTROL_TARGETS
    });
  }

  function getHeadingTrail(element, contentRoot) {
    const trail = [];
    const seen = new Set();
    let current = element;

    while (current && current !== contentRoot && current !== document.body) {
      let sibling = current.previousElementSibling;
      while (sibling && trail.length < 4) {
        if (sibling.matches?.('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
          const text = normalize(sibling.textContent);
          if (text && !seen.has(sibling)) {
            trail.unshift(text);
            seen.add(sibling);
          }
          break;
        }
        sibling = sibling.previousElementSibling;
      }
      current = getComposedParentElement(current);
    }

    if (trail.length === 0 && contentRoot && contentRoot !== element) {
      const heading = contentRoot.querySelector?.('h1, h2, [role="heading"]');
      const text = normalize(heading?.textContent);
      if (text) trail.push(text);
    }
    return trail.slice(-4);
  }

  function getNearbyText(element, contentRoot) {
    const parts = [];
    let sibling = element.previousElementSibling;
    while (sibling && parts.length < 2) {
      if (!sibling.matches?.(HARD_PROTECTED_SELECTOR)) {
        const text = normalize(sibling.textContent);
        if (text) parts.push(text);
      }
      sibling = sibling.previousElementSibling;
    }
    sibling = element.nextElementSibling;
    while (sibling && parts.length < 3) {
      if (!sibling.matches?.(HARD_PROTECTED_SELECTOR)) {
        const text = normalize(sibling.textContent);
        if (text) parts.push(text);
      }
      sibling = sibling.nextElementSibling;
    }
    if (parts.length === 0 && contentRoot) {
      const text = normalize(contentRoot.textContent);
      if (text && text.length > 40) parts.push(text);
    }
    return parts.join(' ').slice(0, 700);
  }

  function getTableContext(element) {
    const cell = element.closest?.('td, th');
    const row = cell?.parentElement;
    const table = cell?.closest?.('table');
    if (!cell || !row || !table) return '';

    const cells = Array.from(row.children);
    const cellIndex = cells.indexOf(cell);
    const headers = Array.from(table.querySelectorAll('thead tr:first-child th'))
      .map(header => normalize(header.textContent))
      .filter(Boolean);
    const rowLabel = cells
      .slice(0, Math.max(0, cellIndex))
      .map(item => normalize(item.textContent))
      .find(Boolean);
    const values = [];
    if (rowLabel) values.push(`row label: ${rowLabel}`);
    if (headers[cellIndex]) values.push(`column label: ${headers[cellIndex]}`);
    return values.join('; ');
  }

  function buildItemContext(element, options = {}) {
    const contentRoot = options.contentRoot || options.context?.contentRoot || document.body;
    const hint = structuralHint(element);
    const parts = [];
    const headings = getHeadingTrail(element, contentRoot);
    const nearby = getNearbyText(element, contentRoot);
    const table = getTableContext(element);

    if (headings.length) parts.push(`heading trail: ${headings.join(' > ')}`);
    if (table) parts.push(table);
    if (nearby) parts.push(`nearby text: ${nearby}`);
    if (hint.trim()) parts.push(`element: ${normalize(hint).slice(0, 160)}`);
    return normalize(parts.join(' | ')).slice(0, 700);
  }

  function isCandidateInScope(
    element,
    scope,
    contentRoot,
    context = null,
    options = {}
  ) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    if (scope === 'full') return true;
    if (options.supplementalDomain === true) {
      return isRelatedToSupplementalScope(element, context);
    }
    if (isAdaptiveUiLabel(element, context)) return true;
    const roots = context
      ? normalizeContentRoots(contentRoot, context.contentRoots)
      : normalizeContentRoots(contentRoot);
    return roots.some(root => (
      root === document.body || composedContains(root, element)
    ));
  }

  function addCandidate(candidateMap, element, options) {
    if (!element || candidateMap.has(element)) return;
    const {
      scope,
      context,
      contentRoot,
      includeContext,
      supplementalDomain
    } = options;
    const site = resolveSite(context);
    if (!isCandidateInScope(
      element,
      scope,
      contentRoot,
      context,
      { supplementalDomain }
    )) return;
    if (isOwnedElement(element)) return;
    const candidateContentRoot = resolveContentRootForElement(
      element,
      contentRoot,
      context
    );

    const decision = classifyElement(
      element,
      scope,
      context,
      candidateContentRoot,
      { supplementalDomain }
    );
    if (!decision.allow) {
      if (context) context.stats.skippedSubtrees++;
      return;
    }

    const text = getElementText(element, context);
    if (text.length > 5000) return;
    candidateMap.set(element, {
      element,
      scope,
      kind: decision.kind,
      role: decision.role,
      reason: decision.reason,
      site,
      siteRole: decision.siteRole
        || siteAdapters.getSemanticContentRole(site, element),
      unitType: options.unitType || 'element',
      container: candidateContentRoot,
      text,
      context: includeContext
        ? buildItemContext(element, { contentRoot: candidateContentRoot, context })
        : '',
      headingTrail: getHeadingTrail(element, candidateContentRoot),
      nearbyText: getNearbyText(element, candidateContentRoot),
      tableContext: getTableContext(element),
      ownTextLength: getOwnTextLength(element, context),
      parent: getComposedParentElement(element)
    });
  }

  function getOwnTextLength(element, context) {
    if (!element) return 0;
    const walker = element.ownerDocument?.createTreeWalker?.(element, 4);
    if (!walker) return 0;

    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || composedClosest(parent, HARD_PROTECTED_SELECTOR)) continue;
      let blockAncestor = parent;
      while (blockAncestor && blockAncestor !== element) {
        if (BLOCK_TAGS.has(String(blockAncestor.tagName || '').toUpperCase())) break;
        blockAncestor = getComposedParentElement(blockAncestor);
      }
      if (blockAncestor && blockAncestor !== element) continue;
      text += node.nodeValue || '';
    }
    return normalize(text).length;
  }

  function hasCoveredAncestor(element, covered) {
    let current = getComposedParentElement(element);
    while (current) {
      if (covered.has(current)) return true;
      current = getComposedParentElement(current);
    }
    return false;
  }

  function collectCandidatesFromRoots(options) {
    const {
      scope,
      context,
      contentRoot,
      roots,
      dynamic,
      includeContext,
      semanticOnly
    } = options;
    const semanticSelector = getSemanticTargetSelector(resolveSite(context));
    const candidates = new Map();
    const covered = new Set();
    const budgetKey = options.supplementalDomain
      ? 'supplemental'
      : options.adaptiveDomain
        ? 'adaptive'
        : dynamic ? 'dynamic' : 'page';
    const budget = context?.budgets?.[budgetKey]
      || DEFAULT_BUDGETS[budgetKey]
      || DEFAULT_BUDGETS.page;
    let visited = 0;

    for (const root of new Set(roots)) {
      if (!root?.querySelectorAll) continue;
      const directTextTargets = unitizer.collectDirectTextRunTargets(root, {
        protectedSelector: HARD_PROTECTED_SELECTOR,
        semanticSelector,
        controlSelector: CONTROL_TARGETS
      });
      for (const target of directTextTargets) {
        if (visited++ >= budget) {
          if (context) context.stats.budgetExceeded = true;
          break;
        }
        if (!isCandidateInScope(
          target,
          scope,
          contentRoot,
          context,
          { supplementalDomain: options.supplementalDomain }
        )) continue;
        if (covered.has(target) || hasCoveredAncestor(target, covered)) continue;
    addCandidate(candidates, target, {
      scope,
      context,
      contentRoot,
      includeContext,
      supplementalDomain: options.supplementalDomain,
      unitType: 'direct-text-run'
        });
        if (candidates.has(target)) covered.add(target);
      }

      const semanticElements = root.querySelectorAll?.(semanticSelector) || [];
      for (const element of semanticElements) {
        if (visited++ >= budget) {
          if (context) context.stats.budgetExceeded = true;
          break;
        }
        if (!isCandidateInScope(
          element,
          scope,
          contentRoot,
          context,
          { supplementalDomain: options.supplementalDomain }
        )) continue;
        if (composedClosest(element, HARD_PROTECTED_SELECTOR)
            && !element.matches(semanticSelector)) {
          continue;
        }
        addCandidate(candidates, element, {
          scope,
          context,
          contentRoot,
          includeContext,
          supplementalDomain: options.supplementalDomain
        });
        if (candidates.has(element)) covered.add(element);
      }

      if (scope === 'full' || scope === 'smart') {
        const containingControl = root.nodeType === Node.ELEMENT_NODE
          ? composedClosest(root, CONTROL_TARGETS)
          : null;
        if (containingControl
            && (scope === 'full' || isAdaptiveUiLabel(containingControl, context))) {
          if (visited++ >= budget) {
            if (context) context.stats.budgetExceeded = true;
          } else {
            const target = unitizer.findControlTranslationTarget(containingControl, {
              protectedSelector: HARD_PROTECTED_SELECTOR,
              semanticSelector,
              controlSelector: CONTROL_TARGETS
            });
            if (target) {
              addCandidate(candidates, target, {
                scope,
                context,
                contentRoot,
                includeContext,
                supplementalDomain: options.supplementalDomain
              });
              if (candidates.has(target)) covered.add(target);
            }
          }
        }

        const controls = root.querySelectorAll?.(CONTROL_TARGETS) || [];
        for (const element of controls) {
          if (visited++ >= budget) {
            if (context) context.stats.budgetExceeded = true;
            break;
          }
          if (scope === 'smart' && !isAdaptiveUiLabel(element, context)) continue;
          const target = unitizer.findControlTranslationTarget(element, {
            protectedSelector: HARD_PROTECTED_SELECTOR,
            semanticSelector,
            controlSelector: CONTROL_TARGETS
          });
          if (!target) continue;
          addCandidate(candidates, target, {
            scope,
            context,
            contentRoot,
            includeContext,
            supplementalDomain: options.supplementalDomain
          });
          if (candidates.has(target)) covered.add(target);
        }
      }

      if (visited >= budget || semanticOnly || !root.ownerDocument?.createTreeWalker) continue;
      const walker = root.ownerDocument.createTreeWalker(root, 4);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (visited++ >= budget) {
          if (context) context.stats.budgetExceeded = true;
          break;
        }
        if (context) context.stats.textNodes++;
        if (!normalize(textNode.nodeValue)) continue;
        const parent = textNode.parentElement;
        if (!parent || isOwnedElement(parent)) continue;
        if (composedClosest(parent, HARD_PROTECTED_SELECTOR)) continue;
        if (composedClosest(parent, CONTROL_TARGETS)) continue;

        let target = findSemanticTarget(parent, scope, contentRoot, semanticSelector);
        if (!target) target = findGenericTarget(parent, scope, contentRoot, context);
        if (!target || covered.has(target)) continue;
        if (hasCoveredAncestor(target, covered)) continue;
        addCandidate(candidates, target, {
          scope,
          context,
          contentRoot,
          includeContext,
          supplementalDomain: options.supplementalDomain
        });
        if (candidates.has(target)) covered.add(target);
      }
    }

    if (context) {
      context.stats.scannedElements += visited;
      context.stats.openShadowRoots = context.openShadowRoots?.size || 0;
    }

    return dedupeNestedCandidates(Array.from(candidates.values()));
  }

  function dedupeNestedCandidates(candidates) {
    const byElement = new Map(candidates.map(candidate => [candidate.element, candidate]));
    const removedAncestors = new Set();

    for (const candidate of candidates) {
      if (candidate.unitType === 'direct-text-run') {
        let directParent = getComposedParentElement(candidate.element);
        while (directParent) {
          const parentCandidate = byElement.get(directParent);
          if (parentCandidate && parentCandidate.unitType !== 'direct-text-run') {
            removedAncestors.add(parentCandidate.element);
          }
          directParent = getComposedParentElement(directParent);
        }
      }

      let parent = getComposedParentElement(candidate.element);
      while (parent) {
        const parentCandidate = byElement.get(parent);
        if (parentCandidate
            && parentCandidate.ownTextLength < 2
            && candidate.ownTextLength >= 2) {
          removedAncestors.add(parentCandidate.element);
        }
        parent = getComposedParentElement(parent);
      }
    }

    return candidates.filter(candidate => {
      if (removedAncestors.has(candidate.element)) return false;
      let parent = getComposedParentElement(candidate.element);
      while (parent) {
        const parentCandidate = byElement.get(parent);
        if (parentCandidate && !removedAncestors.has(parentCandidate.element)) {
          return false;
        }
        parent = getComposedParentElement(parent);
      }
      return true;
    }).map((candidate, order) => ({ ...candidate, order }));
  }

  function mergeCandidateCollections(...collections) {
    const rolePriority = new Map([
      ['supplemental-content', 1],
      ['navigation-label', 2]
    ]);
    const merged = new Map();
    for (const collection of collections) {
      for (const candidate of collection) {
        const existing = merged.get(candidate.element);
        if (!existing
            || (rolePriority.get(candidate.siteRole) || 0)
              > (rolePriority.get(existing.siteRole) || 0)) {
          merged.set(candidate.element, candidate);
        }
      }
    }
    return dedupeNestedCandidates(Array.from(merged.values()));
  }

  function collectPlainTextCandidate(context, scope) {
    const pre = document.body?.querySelector(':scope > pre');
    if (!pre || !isVisible(pre, context)) return [];
    const text = normalize(pre.textContent);
    if (!/[\p{L}\p{N}]/u.test(text)) return [];
    return [{
      element: pre,
      scope,
      role: 'paragraph',
      reason: 'plain-text-document',
      site: context.site,
      siteRole: null,
      kind: 'plain-text',
      container: document.body,
      parent: document.body,
      text,
      context: '',
      headingTrail: [],
      nearbyText: '',
      tableContext: '',
      order: 0
    }];
  }

  function collectPageCandidates(scope = 'smart', options = {}) {
    const context = options.context || createScanContext({ scope });
    resolveSite(context, options);
    const primaryRoot = options.root || document.body;
    if (isPlainTextDocument(primaryRoot.ownerDocument || document)) {
      context.contentRoot = document.body;
      context.contentRootBase = primaryRoot;
      return collectPlainTextCandidate(context, scope);
    }
    if (options.discoverShadowRoots === false) {
      context.openShadowRoots = pruneShadowRootRegistry(context.openShadowRoots);
    } else {
      context.openShadowRoots = refreshOpenShadowRoots(primaryRoot, context, {
        force: true,
        now: options.now
      });
    }
    const contentRoot = scope === 'full'
      ? document.body
      : findContentRoot(context, primaryRoot === document ? document.body : primaryRoot);
    context.contentRoot = contentRoot;
    const contentRoots = scope === 'full'
      ? [contentRoot]
      : getContentRoots(context, contentRoot);
    const contentQueryRoots = [];
    for (const candidateRoot of contentRoots) {
      const queryBase = options.root
        && (options.root === candidateRoot
          || composedContains(options.root, candidateRoot))
        ? options.root
        : candidateRoot;
      contentQueryRoots.push(...getQueryRoots(context, candidateRoot, queryBase));
    }
    const adaptiveQueryRoots = [];
    const supplementalQueryRoots = [];
    if (scope === 'smart') {
      for (const adaptiveRoot of findAdaptiveUiRoots(context, primaryRoot)) {
        adaptiveQueryRoots.push(...getQueryRoots(context, adaptiveRoot, adaptiveRoot));
      }
      for (const supplementalRoot of findSiteSupplementalRoots(context, primaryRoot)) {
        supplementalQueryRoots.push(
          ...getQueryRoots(context, supplementalRoot, supplementalRoot)
        );
      }
    }

    const collectOptions = {
      scope,
      context,
      contentRoot,
      dynamic: options.dynamic === true,
      includeContext: options.includeContext !== false,
      semanticOnly: options.semanticOnly === true
    };
    const adaptiveCandidates = scope === 'smart' && adaptiveQueryRoots.length
      ? collectCandidatesFromRoots({
        ...collectOptions,
        contentRoot: document.body,
        roots: Array.from(new Set(adaptiveQueryRoots)),
        adaptiveDomain: true
      })
      : [];
    const supplementalCandidates = scope === 'smart'
        && supplementalQueryRoots.length
      ? collectCandidatesFromRoots({
        ...collectOptions,
        contentRoot: document.body,
        roots: Array.from(new Set(supplementalQueryRoots)),
        supplementalDomain: true
      })
      : [];
    const contentCandidates = collectCandidatesFromRoots({
      ...collectOptions,
      roots: Array.from(new Set(contentQueryRoots))
    });
    let candidates = mergeCandidateCollections(
      adaptiveCandidates,
      supplementalCandidates,
      contentCandidates
    );
    if (scope !== 'smart'
        || contentCandidates.length > 0
        || supplementalCandidates.length > 0
        || contentRoot === document.body) {
      return candidates;
    }

    context.stats.emptyRootBodyFallback++;
    context.contentRoot = document.body;
    context.contentRoots = [document.body];
    context.contentRootBase = document.body;
    const fallbackCandidates = collectCandidatesFromRoots({
      ...collectOptions,
      contentRoot: document.body,
      roots: getQueryRoots(context, document.body, document.body)
    });
    candidates = mergeCandidateCollections(
      adaptiveCandidates,
      supplementalCandidates,
      fallbackCandidates
    );
    return candidates;
  }

  function collectDynamicCandidates(root, scope = 'smart', options = {}) {
    if (!root || ![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType)) return [];
    const context = options.context || createScanContext({ scope });
    resolveSite(context, options);
    discoverOpenShadowRoots(root, context.openShadowRoots, context.budgets.shadowRoots);
    pruneShadowRootRegistry(context.openShadowRoots);
    invalidateScanCache(context, root);
    findAdaptiveUiRoots(
      context,
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root : root
    );
    // Do not trust a caller-provided root here. A replacement can disconnect
    // the previous content root, and reusing it would reject the new subtree.
    let contentRoot = scope === 'full'
      ? document.body
      : findContentRoot(context, document.body, {
        discoverSiteContentRoots: false
      });
    let contentRoots = scope === 'full'
      ? [contentRoot]
      : getContentRoots(context, contentRoot);
    const scopeProbe = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : root;
    const supplementalRoots = scope === 'smart'
      ? findSiteSupplementalRoots(context, scopeProbe)
      : [];
    const nearestAdaptiveRoot = scope === 'smart'
      ? resolveNearestAdapterRoot(context, scopeProbe)
      : null;
    const adaptiveScope = scope === 'smart'
      && (Boolean(nearestAdaptiveRoot)
        || isRelatedToAdaptiveUiScope(scopeProbe, context));
    const nearestSupplementalRoot = scope === 'smart'
      ? resolveNearestSupplementalRoot(context, scopeProbe)
      : null;
    const supplementalScope = scope === 'smart'
      && (Boolean(nearestSupplementalRoot)
        || supplementalRoots.length > 0
        || isRelatedToSupplementalScope(scopeProbe, context));
    const siteContentRoots = scope === 'smart'
      ? findSiteContentRoots(context, scopeProbe)
      : [];
    const nearestSiteContentRoot = scope === 'smart'
      ? siteAdapters.getContentRoot?.(scopeProbe, {
        site: resolveSite(context),
        isVisible: element => isVisible(element, context)
      })
      : null;
    if (nearestSiteContentRoot
        && !siteContentRoots.includes(nearestSiteContentRoot)
        && isVisible(nearestSiteContentRoot, context)) {
      siteContentRoots.push(nearestSiteContentRoot);
    }
    for (const siteContentRoot of siteContentRoots) {
      registerSiteContentRoot(context, contentRoot, siteContentRoot);
    }
    if (siteContentRoots.length > 0) {
      contentRoots = getContentRoots(context, contentRoot);
    }
    let containingContentRoot = contentRoots.find(candidate => (
      composedContains(candidate, scopeProbe)
    ));
    if (scope === 'smart'
        && !containingContentRoot
        && !adaptiveScope
        && !supplementalScope
        && composedClosest(scopeProbe, ROOT_CANDIDATES)) {
      invalidateScanCache(context, contentRoot);
      contentRoot = findContentRoot(context, document.body, { refresh: true });
      contentRoots = getContentRoots(context, contentRoot);
      containingContentRoot = contentRoots.find(candidate => (
        composedContains(candidate, scopeProbe)
      ));
    }
    const hasBoundedSiteContent = siteContentRoots.some(siteContentRoot => (
      siteContentRoot === scopeProbe
      || composedContains(scopeProbe, siteContentRoot)
    ));
    if (!containingContentRoot
        && !adaptiveScope
        && !supplementalScope
        && hasBoundedSiteContent) {
      // React and other SPA runtimes can mount a valid post inside an opaque
      // custom-element or virtualized wrapper. Keep the mutation subtree as the
      // boundary so sibling posts mounted in the same wrapper are all scanned,
      // without expanding the dynamic scan to the rest of the page.
      containingContentRoot = scopeProbe;
    }
    if (scope === 'smart'
        && !containingContentRoot
        && !adaptiveScope
        && !supplementalScope) {
      const parentCandidate = composedClosest(scopeProbe, ROOT_CANDIDATES);
      if (!parentCandidate
          || !contentRoots.some(candidate => (
            composedContains(candidate, parentCandidate)
            || composedContains(parentCandidate, candidate)
          ))) {
        return [];
      }
    }
    const dynamicRoots = [root];
    if (nearestAdaptiveRoot?.isConnected
        && composedContains(nearestAdaptiveRoot, scopeProbe)) {
      dynamicRoots.push(nearestAdaptiveRoot);
    }
    if (nearestSupplementalRoot?.isConnected) {
      dynamicRoots.push(nearestSupplementalRoot);
    }
    for (const supplementalRoot of supplementalRoots) {
      if (supplementalRoot?.isConnected) dynamicRoots.push(supplementalRoot);
    }
    for (const shadowRoot of context.openShadowRoots) {
      if (shadowRoot === root
          || (root.nodeType === Node.ELEMENT_NODE
            && (shadowRoot.host === root || composedContains(root, shadowRoot.host)))
          || (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
            && (shadowRoot.host === root.host || composedContains(root.host, shadowRoot.host)))) {
        dynamicRoots.push(shadowRoot);
      }
    }
    return collectCandidatesFromRoots({
      scope,
      context,
      contentRoot: containingContentRoot || contentRoot,
      roots: dynamicRoots,
      dynamic: true,
      includeContext: options.includeContext !== false,
      semanticOnly: options.semanticOnly === true,
      supplementalDomain: supplementalScope
    });
  }

  function isInViewport(element, margin = { top: 0.15, bottom: 0.8 }) {
    const rect = element.getBoundingClientRect();
    const height = window.innerHeight;
    return rect.width > 0
      && rect.height > 0
      && rect.bottom >= -height * margin.top
      && rect.top <= height * margin.bottom;
  }

  return Object.freeze({
    HARD_SKIP_TAGS,
    HARD_PROTECTED_SELECTOR,
    SMART_UI_SELECTOR,
    ADAPTIVE_UI_ROOT_SELECTOR,
    createScanContext,
    invalidateScanCache,
    discoverOpenShadowRoots,
    refreshOpenShadowRoots,
    pruneShadowRootRegistry,
    getComposedParentElement,
    composedContains,
    composedClosest,
    isOwnedElement,
    isAdaptiveUiLabel,
    isWithinAdaptiveUiScope,
    isRelatedToAdaptiveUiScope,
    isRelatedToSupplementalScope,
    isInsideDirectTextRun(node) {
      return unitizer.isInsideDirectTextRun(node);
    },
    isVisible,
    isInViewport,
    isPlainTextDocument,
    findContentRoot,
    classifyElement,
    collectPageCandidates,
    collectDynamicCandidates,
    unwrapAllDirectTextRuns(root = document) {
      return unitizer.unwrapAll(root);
    },
    buildItemContext,
    getElementText,
    getHeadingTrail,
    normalize
  });
});
