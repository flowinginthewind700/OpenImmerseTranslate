/**
 * Open Immerse Translate - X/Twitter site profile.
 *
 * This profile owns only X-specific content meaning and resilient UI root
 * discovery. Generic filtering, unitization, and translation remain shared.
 */
(function initXSiteProfile(root, factory) {
  const uiPolicy = root.OITContentUiPolicy
    || (typeof require === 'function' ? require('../content-ui-policy.js') : null);
  const api = factory(uiPolicy);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITSiteProfileX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXSiteProfile(
  uiPolicy
) {
  'use strict';

  const X_HOSTS = new Set([
    'x.com',
    'www.x.com',
    'mobile.x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com'
  ]);
  const POST_CONTAINER = ':is(article, [role="article"])';
  const POST_TEXT_SELECTOR = [
    `${POST_CONTAINER} [data-testid="tweetText"]`,
    `${POST_CONTAINER} div[dir="auto"].whitespace-pre-wrap`,
    `${POST_CONTAINER} div[lang][dir]`
  ].join(',');
  const SURFACE_SELECTOR = [
    `${POST_CONTAINER} [data-post-avatar="true"]`,
    `${POST_CONTAINER} [data-engagement-action]`,
    `${POST_CONTAINER} [data-testid="tweetText"]`,
    `${POST_CONTAINER} div[dir="auto"].whitespace-pre-wrap`
  ].join(',');
  const METADATA_SELECTOR = [
    '[data-testid="User-Name"]',
    '[data-testid="UserName"]',
    '[data-testid="socialContext"]',
    '[data-testid="analytics"]',
    '[data-testid="reply"]',
    '[data-testid="retweet"]',
    '[data-testid="like"]',
    '[data-testid="bookmark"]',
    '[data-testid="share"]',
    '[data-engagement-action]',
    'time',
    '[datetime]'
  ].join(',');
  const NAVIGATION_SELECTOR = 'header, nav, [role="navigation"]';
  const SIDENAV_ROOT_SELECTOR = '[data-testid="SideNav"]';
  const SUPPLEMENTAL_ROOT_SELECTOR = [
    '[data-testid="sidebarColumn"]',
    'aside[aria-label*="Timeline: Trending"]',
    'aside[aria-label*="What is happening" i]',
    '[role="complementary"][aria-label*="What is happening" i]'
  ].join(',');
  const SUPPLEMENTAL_CANDIDATE_SELECTOR = 'aside, [role="complementary"]';
  const GENERIC_SUPPLEMENTAL_CANDIDATE_SELECTOR = [
    'aside', '[role="complementary"]', 'section', 'div'
  ].join(',');
  const SUPPLEMENTAL_TREND_SELECTOR = '[data-testid="trend"]';
  const USER_DESCRIPTION_SELECTOR = '[data-testid="UserDescription"]';
  const USER_CELL_SELECTOR = '[data-testid="UserCell"]';
  const SUPPLEMENTAL_RICH_TEXT_SELECTOR = '[lang], [dir], [data-testid="trend"]';
  const SUPPLEMENTAL_EXCLUSION_SELECTOR = [
    METADATA_SELECTOR,
    'button',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    'input',
    'textarea',
    'select'
  ].join(',');
  const SIDENAV_CONTROL_SELECTOR = [
    'a[href][data-testid^="SideNav_"]',
    'button[data-testid^="SideNav_"]',
    '[role="button"][data-testid^="SideNav_"]'
  ].join(',');
  const NAVIGATION_CONTROL_SELECTOR = [
    'a[href]',
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role^="menuitem"]'
  ].join(',');
  const NAVIGATION_STATE_SELECTOR = [
    '[aria-selected="true"]',
    '[aria-selected="false"]',
    '[aria-current]:not([aria-current="false"])'
  ].join(',');
  const EXPLICIT_ADAPTIVE_ROOT_SELECTOR = [
    '[data-testid="AppTabBar"]',
    '[data-testid="Dropdown"]',
    SIDENAV_ROOT_SELECTOR
  ].join(',');
  const NAVIGATION_LINK_PATH_SET = new Set([
    '/home',
    '/explore',
    '/notifications',
    '/messages',
    '/jobs',
    '/bookmarks',
    '/lists',
    '/i/grok',
    '/i/bookmarks',
    '/i/jobs',
    '/i/communities',
    '/i/premium',
    '/i/verified-orgs',
    '/i/lists',
    '/i/connect_people',
    '/i/topics'
  ]);
  const NAVIGATION_EXCLUSION_SELECTOR = [
    POST_CONTAINER,
    'main',
    '[role="main"]',
    'body',
    'html'
  ].join(',');
  const CONTENT_ROOT_LIMIT = 120;
  const SUPPLEMENTAL_ROOT_LIMIT = 12;
  const GENERIC_SUPPLEMENTAL_ANCHOR_LIMIT = 2400;
  const GENERIC_SUPPLEMENTAL_ANCESTOR_DEPTH = 10;
  const GENERIC_SUPPLEMENTAL_MIN_WIDTH = 96;
  const GENERIC_SUPPLEMENTAL_MIN_HEIGHT = 72;
  const GENERIC_SUPPLEMENTAL_MAX_TEXT_LENGTH = 16000;
  const NAVIGATION_CONTROL_LIMIT = 4000;
  const NAVIGATION_ANCESTOR_DEPTH = 20;
  const NAVIGATION_CLUSTER_CONTROL_LIMIT = 120;
  const ADAPTIVE_ROOT_SOURCE_PRIORITY = Object.freeze({
    'x:explicit': 3,
    'x:sidenav-cluster': 2,
    'x:route-cluster': 1
  });

  function normalizeHost(hostname) {
    return String(hostname || '').trim().toLowerCase();
  }

  function isXHost(hostname) {
    return X_HOSTS.has(normalizeHost(hostname));
  }

  function hasXSurface(documentRef) {
    return Boolean(documentRef?.querySelector?.(`main ${SURFACE_SELECTOR}`));
  }

  function matches(documentRef = globalThis.document, locationRef = globalThis.location) {
    return isXHost(locationRef?.hostname) || hasXSurface(documentRef);
  }

  function collectMatches(base, selector) {
    if (!base?.querySelectorAll) return [];
    const matches = base.nodeType === 1 && base.matches?.(selector) ? [base] : [];
    matches.push(...base.querySelectorAll(selector));
    return matches;
  }

  function getElementDepth(element) {
    let depth = 0;
    let current = element;
    while (current?.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  function getRect(element) {
    try {
      return element?.getBoundingClientRect?.()
        || { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
    } catch (error) {
      return { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function getXPath(anchor) {
    const rawHref = anchor?.getAttribute?.('href');
    if (!rawHref) return null;
    try {
      const url = new URL(rawHref, 'https://x.com');
      if (!isXHost(url.hostname)) return null;
      return (url.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    } catch (error) {
      return null;
    }
  }

  function isNavigationLink(anchor) {
    if (!anchor?.matches?.('a[href]')) return false;
    if (anchor.matches('[data-testid^="AppTabBar_"]')) return true;
    if (NAVIGATION_LINK_PATH_SET.has(getXPath(anchor))) return true;
    return anchor.matches(NAVIGATION_STATE_SELECTOR)
      || anchor.matches('[role="tab"], [role^="menuitem"]')
      || Boolean(anchor.closest?.(SIDENAV_ROOT_SELECTOR))
      || Boolean(anchor.matches?.(SIDENAV_CONTROL_SELECTOR));
  }

  function isNavigationControl(control) {
    if (!control?.matches?.(NAVIGATION_CONTROL_SELECTOR)) return false;
    if (control.closest?.(POST_CONTAINER)) return false;
    if (control.matches(
      '[data-testid^="AppTabBar_"], [data-testid^="SideNav_"], '
        + '[role="tab"], [role^="menuitem"], '
        + NAVIGATION_STATE_SELECTOR
    )) {
      return true;
    }
    if (control.closest?.(SIDENAV_ROOT_SELECTOR)
        || control.closest?.(NAVIGATION_SELECTOR)) {
      return true;
    }
    return control.matches('a[href]')
      && NAVIGATION_LINK_PATH_SET.has(getXPath(control));
  }

  function isInternalNavigationAnchor(control) {
    return Boolean(
      control?.matches?.('a[href]')
      && getXPath(control)
      && !control.closest?.(POST_CONTAINER)
    );
  }

  function getAccountHandle(control) {
    const match = String(control?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .match(/(?:^|\s)@([a-z0-9_]{1,15})(?=\s|$)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function isAccountIdentityControl(control) {
    if (!control?.matches?.(NAVIGATION_CONTROL_SELECTOR)
        || control.closest?.(POST_CONTAINER)) {
      return false;
    }
    const handle = getAccountHandle(control);
    if (!handle) return false;
    const label = String(control.textContent || '').replace(/\s+/g, ' ').trim();
    if (label === `@${handle}`) return false;
    const path = getXPath(control);
    return path === `/${handle}` || control.matches('button, [role="button"]');
  }

  function countDistinctNavigationPaths(controls) {
    return new Set(controls.map(getXPath).filter(Boolean)).size;
  }

  function containsReadingRegion(root, options = {}) {
    return Boolean(
      uiPolicy?.containsSubstantialReadingRegion?.(root, options)
    );
  }

  function isEligibleNavigationCluster(root, controls, options = {}) {
    if (containsReadingRegion(root, options)) return false;
    if (controls.length < 2
        || controls.length > NAVIGATION_CLUSTER_CONTROL_LIMIT) {
      return false;
    }
    const navigationControls = controls.filter(isNavigationControl);
    const internalAnchors = controls.filter(isInternalNavigationAnchor);
    const statefulControls = navigationControls.filter(control => (
      control.matches(NAVIGATION_STATE_SELECTOR)
    ));
    const hasRepeatedRoutes = navigationControls.length >= 2
      && (
        countDistinctNavigationPaths(navigationControls) >= 2
        || statefulControls.length === navigationControls.length
      );
    const insideMain = Boolean(root.closest?.('main, [role="main"]'));
    const hasAnchoredRail = !insideMain
      && internalAnchors.length >= 3
      && navigationControls.length >= 1;
    return hasRepeatedRoutes || hasAnchoredRail;
  }

  function findGroupedNavigationRoots(base, options = {}) {
    const controls = collectMatches(base, NAVIGATION_CONTROL_SELECTOR)
      .filter(control => !control.closest?.(POST_CONTAINER))
      .slice(0, NAVIGATION_CONTROL_LIMIT);
    if (controls.length < 2) return [];

    const rootLinks = new Map();
    for (const control of controls) {
      let current = control.parentElement;
      let depth = 0;
      while (current
          && depth++ < NAVIGATION_ANCESTOR_DEPTH
          && !current.matches?.(NAVIGATION_EXCLUSION_SELECTOR)) {
        const containedControls = rootLinks.get(current) || [];
        containedControls.push(control);
        rootLinks.set(current, containedControls);
        current = current.parentElement;
      }
    }

    const eligible = Array.from(rootLinks.entries())
      .filter(([root, containedControls]) => (
        isEligibleNavigationCluster(root, containedControls, options)
      ))
      .map(([root, containedControls]) => ({ root, containedControls }));

    return eligible
      .filter(candidate => !eligible.some(other => (
        other.root !== candidate.root
        && candidate.root.contains(other.root)
        && other.containedControls.length >= candidate.containedControls.length
      )))
      .sort((left, right) => (
        right.containedControls.length - left.containedControls.length
        || getElementDepth(right.root) - getElementDepth(left.root)
      ))
      .map(candidate => candidate.root);
  }

  function findGroupedSideNavRoots(base) {
    const controls = collectMatches(base, SIDENAV_CONTROL_SELECTOR)
      .filter(control => !control.closest?.(POST_CONTAINER));
    if (controls.length < 2) return [];

    const rootControls = new Map();
    for (const control of controls) {
      let current = control.parentElement;
      while (current && !current.matches?.(NAVIGATION_EXCLUSION_SELECTOR)) {
        const containedControls = rootControls.get(current) || [];
        containedControls.push(control);
        rootControls.set(current, containedControls);
        current = current.parentElement;
      }
    }

    const eligible = Array.from(rootControls.entries())
      .filter(([, containedControls]) => containedControls.length >= 2)
      .map(([root, containedControls]) => ({ root, containedControls }));

    return eligible
      .filter(candidate => !eligible.some(other => (
        other.root !== candidate.root
        && candidate.root.contains(other.root)
        && other.containedControls.length >= candidate.containedControls.length
      )))
      .sort((left, right) => (
        right.containedControls.length - left.containedControls.length
        || getElementDepth(right.root) - getElementDepth(left.root)
      ))
      .map(candidate => candidate.root);
  }

  function getAdaptiveRootSourcePriority(source) {
    return ADAPTIVE_ROOT_SOURCE_PRIORITY[source] || 0;
  }

  function normalizeAdaptiveRoots(candidates, options = {}) {
    const sourceByRoot = new Map();
    for (const candidate of candidates) {
      const root = candidate?.root;
      if (root?.nodeType !== 1 || !root.isConnected) continue;
      if (containsReadingRegion(root, options)) continue;
      const existingSource = sourceByRoot.get(root);
      if (!existingSource
          || getAdaptiveRootSourcePriority(candidate.source)
            > getAdaptiveRootSourcePriority(existingSource)) {
        sourceByRoot.set(root, candidate.source);
      }
    }

    const ranked = Array.from(sourceByRoot, ([root, source]) => ({
      root,
      source,
      controls: collectMatches(root, NAVIGATION_CONTROL_SELECTOR)
        .filter(control => !control.closest?.(POST_CONTAINER))
    })).sort((left, right) => (
      getAdaptiveRootSourcePriority(right.source)
        - getAdaptiveRootSourcePriority(left.source)
      || right.controls.length - left.controls.length
      || getElementDepth(right.root) - getElementDepth(left.root)
    ));

    const coveredControls = new Set();
    return ranked.filter(item => {
      const uncovered = item.controls.some(control => !coveredControls.has(control));
      const authoritativeEmptyRoot = item.controls.length === 0
        && getAdaptiveRootSourcePriority(item.source)
          === getAdaptiveRootSourcePriority('x:explicit');
      if (!uncovered && !authoritativeEmptyRoot) return false;
      for (const control of item.controls) coveredControls.add(control);
      return true;
    });
  }

  function normalizeSupplementalRoots(roots) {
    const connected = Array.from(new Set(roots))
      .filter(root => root?.nodeType === 1 && root.isConnected);
    return connected.filter(root => !connected.some(other => (
      other !== root
      && root.contains(other)
      && getElementDepth(other) >= getElementDepth(root)
    )));
  }

  function hasSupplementalContentEvidence(root) {
    if (!root?.querySelectorAll || root.closest?.(POST_CONTAINER)) {
      return false;
    }
    const text = String(root.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return false;
    const label = String(root.getAttribute?.('aria-label') || '').trim();
    const hasHeading = Boolean(root.querySelector(
      'h1, h2, h3, h4, h5, h6, [role="heading"]'
    ));
    const hasRichText = Boolean(root.querySelector(SUPPLEMENTAL_RICH_TEXT_SELECTOR));
    const hasKnownCard = Boolean(root.querySelector([
      SUPPLEMENTAL_TREND_SELECTOR,
      USER_DESCRIPTION_SELECTOR,
      USER_CELL_SELECTOR
    ].join(',')));
    return (Boolean(label) && (hasHeading || hasRichText || hasKnownCard))
      || (hasHeading && (hasRichText || hasKnownCard));
  }

  function isSupplementalRootCandidate(root) {
    if (!root?.matches) return false;
    if (root.matches(SUPPLEMENTAL_ROOT_SELECTOR)) return true;
    if (!root.matches(SUPPLEMENTAL_CANDIDATE_SELECTOR)) return false;
    return hasSupplementalContentEvidence(root);
  }

  function findSupplementalEvidenceRoots(base) {
    return collectMatches(base, SUPPLEMENTAL_CANDIDATE_SELECTOR)
      .filter(isSupplementalRootCandidate);
  }

  function isGenericSupplementalAnchor(anchor, options) {
    if (!anchor?.matches?.(SUPPLEMENTAL_RICH_TEXT_SELECTOR)
        || anchor.closest?.(POST_CONTAINER)
        || anchor.closest?.(SUPPLEMENTAL_EXCLUSION_SELECTOR)) {
      return false;
    }
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : element => Boolean(element?.isConnected);
    if (!isVisible(anchor)) return false;
    const rect = getRect(anchor);
    const viewportWidth = options.viewport?.width
      || globalThis.innerWidth
      || anchor.ownerDocument?.documentElement?.clientWidth
      || 0;
    return rect.width > 0
      && rect.height > 0
      && (!viewportWidth || rect.left >= viewportWidth * 0.5);
  }

  function isGenericSupplementalRootCandidate(root, options) {
    if (!root?.matches?.(GENERIC_SUPPLEMENTAL_CANDIDATE_SELECTOR)
        || root.matches(POST_CONTAINER)
        || root.closest?.(POST_CONTAINER)
        || root.matches('main, [role="main"], nav, header, footer, body, html')
        || root.closest?.('nav, header, footer')) {
      return false;
    }

    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : element => Boolean(element?.isConnected);
    if (!isVisible(root)) return false;

    const rect = getRect(root);
    const viewportWidth = options.viewport?.width
      || globalThis.innerWidth
      || root.ownerDocument?.documentElement?.clientWidth
      || 0;
    if (rect.width < GENERIC_SUPPLEMENTAL_MIN_WIDTH
        || rect.height < GENERIC_SUPPLEMENTAL_MIN_HEIGHT
        || (viewportWidth && (
          rect.left < viewportWidth * 0.5
          || rect.width > viewportWidth * 0.62
        ))) {
      return false;
    }

    const text = String(root.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > GENERIC_SUPPLEMENTAL_MAX_TEXT_LENGTH) {
      return false;
    }

    const richTextAnchors = collectMatches(root, SUPPLEMENTAL_RICH_TEXT_SELECTOR)
      .filter(anchor => !anchor.closest?.(POST_CONTAINER))
      .filter(anchor => !anchor.closest?.(SUPPLEMENTAL_EXCLUSION_SELECTOR))
      .filter(isVisible);
    const hasHeading = Boolean(root.querySelector?.(
      'h1, h2, h3, h4, h5, h6, [role="heading"]'
    ));
    const hasKnownCard = Boolean(root.querySelector?.([
      SUPPLEMENTAL_TREND_SELECTOR,
      USER_DESCRIPTION_SELECTOR,
      USER_CELL_SELECTOR
    ].join(',')));
    return richTextAnchors.length >= 2
      || (hasHeading && richTextAnchors.length >= 1)
      || (hasKnownCard && richTextAnchors.length >= 1);
  }

  function findGenericSupplementalRoots(base, options = {}) {
    if (!base?.querySelectorAll) return [];
    const roots = [];
    const anchors = collectMatches(base, SUPPLEMENTAL_RICH_TEXT_SELECTOR)
      .slice(0, GENERIC_SUPPLEMENTAL_ANCHOR_LIMIT);

    for (const anchor of anchors) {
      if (!isGenericSupplementalAnchor(anchor, options)) continue;
      let current = anchor.parentElement;
      for (let depth = 0;
        current
          && current.nodeType === 1
          && !current.matches(POST_CONTAINER)
          && !current.matches('nav, header, footer, body, html')
          && depth < GENERIC_SUPPLEMENTAL_ANCESTOR_DEPTH;
        depth++, current = current.parentElement
      ) {
        if (isGenericSupplementalRootCandidate(current, options)) {
          roots.push(current);
        }
      }
    }
    return normalizeSupplementalRoots(roots);
  }

  function diagnoseAdaptiveRoots(base = globalThis.document?.body, options = {}) {
    if (!base?.querySelectorAll) return [];
    const candidates = [
      ...collectMatches(base, EXPLICIT_ADAPTIVE_ROOT_SELECTOR)
        .map(root => ({ root, source: 'x:explicit' })),
      ...findGroupedNavigationRoots(base, options)
        .map(root => ({ root, source: 'x:route-cluster' })),
      ...findGroupedSideNavRoots(base)
        .map(root => ({ root, source: 'x:sidenav-cluster' }))
    ];
    return normalizeAdaptiveRoots(candidates, options);
  }

  function findAdaptiveRoots(base = globalThis.document?.body, options = {}) {
    return diagnoseAdaptiveRoots(base, options).map(item => item.root);
  }

  function findContentRoots(base = globalThis.document?.body, options = {}) {
    if (!base?.querySelectorAll) return [];
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : element => Boolean(element?.isConnected);
    const limit = Math.max(1, Number(options.limit) || CONTENT_ROOT_LIMIT);
    const roots = [];
    const seen = new Set();

    for (const postText of collectMatches(base, POST_TEXT_SELECTOR)) {
      if (roots.length >= limit) break;
      if (!isVisible(postText)) continue;
      const root = postText.closest?.(POST_CONTAINER);
      if (!root || seen.has(root) || !isVisible(root)) continue;
      seen.add(root);
      roots.push(root);
    }
    return roots;
  }

  function getContentRoot(element, options = {}) {
    const normalized = element?.nodeType === 1 ? element : element?.parentElement;
    if (!normalized?.matches) return null;

    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : candidate => Boolean(candidate?.isConnected);
    const closestPost = normalized.closest?.(POST_CONTAINER);
    if (closestPost && isVisible(closestPost)) return closestPost;
    if (!normalized.querySelector) return null;

    const nestedPost = Array.from(normalized.querySelectorAll(POST_TEXT_SELECTOR))
      .find(isVisible);
    const nestedRoot = nestedPost?.closest?.(POST_CONTAINER);
    if (!nestedRoot || !isVisible(nestedRoot)) return null;
    if (normalized.matches('main, [role="main"]')) return normalized;
    return nestedRoot;
  }

  function getAdaptiveRoot(element, options = {}) {
    const normalized = element?.nodeType === 1 ? element : element?.parentElement;
    if (!normalized?.matches || normalized.closest?.(POST_CONTAINER)) return null;

    const explicit = normalized.closest?.(EXPLICIT_ADAPTIVE_ROOT_SELECTOR);
    if (explicit) return explicit;
    const semantic = normalized.closest?.(NAVIGATION_SELECTOR);
    if (semantic) return semantic;
    const documentRef = normalized.ownerDocument || globalThis.document;
    const discovered = findAdaptiveRoots(documentRef?.body || documentRef, options)
      .find(root => root === normalized || root.contains(normalized));
    if (discovered) return discovered;

    const link = normalized.closest?.('a[href]');
    const appTab = normalized.closest?.('[data-testid^="AppTabBar_"]');
    if (!appTab && !isNavigationLink(link)) return null;

    return findAdaptiveRoots(documentRef?.body || documentRef, options)
      .find(root => root === normalized || root.contains(normalized)) || null;
  }

  function findSupplementalRoots(base = globalThis.document?.body, options = {}) {
    if (!base?.querySelectorAll) return [];
    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : element => Boolean(element?.isConnected);
    const limit = Math.max(1, Number(options.limit) || SUPPLEMENTAL_ROOT_LIMIT);
    const roots = [
      ...collectMatches(base, SUPPLEMENTAL_ROOT_SELECTOR),
      ...findSupplementalEvidenceRoots(base),
      ...findGenericSupplementalRoots(base, options)
    ]
      .filter(root => isVisible(root))
      .slice(0, limit);
    const containingRoot = getSupplementalRoot(base, options);
    if (containingRoot && isVisible(containingRoot)) roots.push(containingRoot);
    return normalizeSupplementalRoots(roots);
  }

  function getSupplementalRoot(element, options = {}) {
    const normalized = element?.nodeType === 1 ? element : element?.parentElement;
    if (!normalized?.matches || normalized.closest?.(POST_CONTAINER)) return null;

    const sidebar = normalized.closest?.(SUPPLEMENTAL_ROOT_SELECTOR);
    let root = sidebar || null;
    if (!root) {
      let current = normalized;
      while (current && !current.matches?.(POST_CONTAINER)) {
        if (isSupplementalRootCandidate(current)) {
          root = current;
          break;
        }
        current = current.parentElement;
      }
    }
    if (!root && normalized.querySelectorAll) {
      root = [
        ...collectMatches(normalized, SUPPLEMENTAL_ROOT_SELECTOR),
        ...findSupplementalEvidenceRoots(normalized),
        ...findGenericSupplementalRoots(normalized, options)
      ]
        .find(candidate => candidate.isConnected) || null;
    }
    if (!root) {
      root = findGenericSupplementalRoots(normalized, options)
        .find(candidate => candidate === normalized || candidate.contains(normalized))
        || null;
    }
    if (!root) return null;

    const isVisible = typeof options.isVisible === 'function'
      ? options.isVisible
      : candidate => Boolean(candidate?.isConnected);
    return isVisible(root) ? root : null;
  }

  function isInsideSupplementalRoot(element) {
    return Boolean(getSupplementalRoot(element));
  }

  function isMetadataElement(element) {
    const description = element.closest?.(USER_DESCRIPTION_SELECTOR);
    if (description && !isInsideSupplementalRoot(description)) return true;
    return Boolean(element.closest?.(METADATA_SELECTOR));
  }

  function isSupplementalHeading(element) {
    const heading = element.closest?.('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return Boolean(heading && isInsideSupplementalRoot(heading));
  }

  function isSupplementalTrendContent(element) {
    if (!isInsideSupplementalRoot(element)
        || element.closest?.(SUPPLEMENTAL_EXCLUSION_SELECTOR)) {
      return false;
    }
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2
        || /^[\d.,]+\s*[kmb]?(?:\s+posts?)?$/i.test(text)) {
      return false;
    }
    return Boolean(element.closest?.(SUPPLEMENTAL_TREND_SELECTOR))
      || isSupplementalHeading(element)
      || element.matches?.(SUPPLEMENTAL_RICH_TEXT_SELECTOR);
  }

  function isSupplementalUserBio(element) {
    const description = element.closest?.(USER_DESCRIPTION_SELECTOR);
    if (description && isInsideSupplementalRoot(description)) return true;
    if (!element.closest?.(USER_CELL_SELECTOR)
        || !isInsideSupplementalRoot(element)
        || element.closest?.(SUPPLEMENTAL_EXCLUSION_SELECTOR)) {
      return false;
    }
    return Boolean(element.matches?.(SUPPLEMENTAL_RICH_TEXT_SELECTOR));
  }

  function isSupplementalContent(element) {
    if (!element?.matches || element.closest?.(POST_CONTAINER)) return false;
    if (!isInsideSupplementalRoot(element)) return false;
    return isSupplementalHeading(element)
      || isSupplementalTrendContent(element)
      || isSupplementalUserBio(element);
  }

  function getSemanticContentRole(element) {
    if (!element?.matches) return null;
    if (isSupplementalContent(element)) return 'supplemental-content';
    if (isMetadataElement(element)) return 'metadata';
    if (isAccountIdentityControl(element.closest?.(NAVIGATION_CONTROL_SELECTOR))) {
      return 'metadata';
    }
    if (element.matches(POST_TEXT_SELECTOR)) return 'post-body';
    if (element.closest?.(NAVIGATION_SELECTOR)
        || element.closest?.(SIDENAV_ROOT_SELECTOR)
        || element.closest?.(SIDENAV_CONTROL_SELECTOR)) {
      return 'navigation-label';
    }
    return null;
  }

  function getElementPolicy(element, scope) {
    if (!element?.matches) return null;
    if (isMetadataElement(element)
        || isAccountIdentityControl(
          element.closest?.(NAVIGATION_CONTROL_SELECTOR)
        )) {
      return Object.freeze({
        action: scope === 'full' ? 'skip-subtree' : 'skip-self',
        role: 'metadata',
        reason: 'x-metadata'
      });
    }
    if (isSupplementalContent(element)) {
      return Object.freeze({
        action: 'keep',
        role: 'supplemental-content',
        reason: 'x-supplemental-content'
      });
    }
    if (element.matches(POST_TEXT_SELECTOR)) {
      return Object.freeze({
        action: 'keep',
        role: 'post-body',
        reason: 'x-post-body'
      });
    }
    if (element.closest?.(NAVIGATION_SELECTOR)
        || element.closest?.(SIDENAV_ROOT_SELECTOR)
        || element.closest?.(SIDENAV_CONTROL_SELECTOR)) {
      return Object.freeze({
        action: 'keep',
        role: 'navigation-label',
        reason: 'x-navigation-label'
      });
    }
    return null;
  }

  return Object.freeze({
    id: 'x',
    POST_TEXT_SELECTOR,
    SURFACE_SELECTOR,
    METADATA_SELECTOR,
    NAVIGATION_SELECTOR,
    SIDENAV_ROOT_SELECTOR,
    SIDENAV_CONTROL_SELECTOR,
    EXPLICIT_ADAPTIVE_ROOT_SELECTOR,
    SUPPLEMENTAL_ROOT_SELECTOR,
    SUPPLEMENTAL_TREND_SELECTOR,
    USER_DESCRIPTION_SELECTOR,
    semanticTargets: Object.freeze([POST_TEXT_SELECTOR]),
    matches,
    isXHost,
    hasXSurface,
    findContentRoots,
    getContentRoot,
    findAdaptiveRoots,
    diagnoseAdaptiveRoots,
    getAdaptiveRoot,
    findSupplementalRoots,
    getSupplementalRoot,
    getSemanticContentRole,
    getElementPolicy
  });
});
