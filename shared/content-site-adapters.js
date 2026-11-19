/**
 * Open Immerse Translate - site profile registry.
 *
 * Site profiles describe domain-specific content meaning and stable adaptive
 * roots. Unknown sites intentionally fall back to generic page heuristics.
 */
(function initContentSiteAdapters(root, factory) {
  const xProfile = root.OITSiteProfileX
    || (typeof require === 'function' ? require('./site-profiles/x.js') : null);
  const api = factory(xProfile);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITSiteAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentSiteAdapters(
  xProfile
) {
  'use strict';

  const GENERIC_SITE = 'generic';
  const EMPTY_TARGETS = Object.freeze([]);

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      throw new TypeError('A site profile must be an object');
    }
    const id = String(profile.id || '').trim().toLowerCase();
    if (!id || id === GENERIC_SITE) {
      throw new TypeError('A site profile requires a non-generic id');
    }
    if (typeof profile.matches !== 'function') {
      throw new TypeError(`Site profile "${id}" requires a matches function`);
    }
    return profile;
  }

  function createSiteAdapterRegistry(initialProfiles = []) {
    const profiles = [];
    const profilesById = new Map();

    function registerSiteProfile(profile) {
      const normalized = normalizeProfile(profile);
      if (profilesById.has(normalized.id)) {
        throw new Error(`Site profile "${normalized.id}" is already registered`);
      }
      profiles.push(normalized);
      profilesById.set(normalized.id, normalized);
      return normalized;
    }

    initialProfiles.filter(Boolean).forEach(registerSiteProfile);

    function getSiteProfile(site) {
      if (!site || site === GENERIC_SITE) return null;
      return profilesById.get(String(site).toLowerCase()) || null;
    }

    function detectSite(documentRef = globalThis.document, locationRef = globalThis.location) {
      for (const profile of profiles) {
        try {
          if (profile.matches(documentRef, locationRef)) return profile.id;
        } catch (error) {
          // A broken optional profile must not disable generic translation.
        }
      }
      return GENERIC_SITE;
    }

    function resolveProfile(site, documentRef, locationRef) {
      const resolvedSite = site || detectSite(documentRef, locationRef);
      return getSiteProfile(resolvedSite);
    }

    function getSemanticTargets(site) {
      const profile = getSiteProfile(site);
      return profile?.semanticTargets || EMPTY_TARGETS;
    }

    function getSemanticContentRole(site, element) {
      const profile = getSiteProfile(site);
      return typeof profile?.getSemanticContentRole === 'function'
        ? profile.getSemanticContentRole(element)
        : null;
    }

    function getElementPolicy(site, element, scope) {
      const profile = getSiteProfile(site);
      return typeof profile?.getElementPolicy === 'function'
        ? profile.getElementPolicy(element, scope)
        : null;
    }

    function findContentRoots(base = globalThis.document?.body, options = {}) {
      const profile = resolveProfile(
        options.site,
        base?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.findContentRoots === 'function'
        ? profile.findContentRoots(base, options)
        : EMPTY_TARGETS;
    }

    function getContentRoot(element, options = {}) {
      const profile = resolveProfile(
        options.site,
        element?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.getContentRoot === 'function'
        ? profile.getContentRoot(element, options)
        : null;
    }

    function findAdaptiveRoots(base = globalThis.document?.body, options = {}) {
      const profile = resolveProfile(
        options.site,
        base?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.findAdaptiveRoots === 'function'
        ? profile.findAdaptiveRoots(base, options)
        : EMPTY_TARGETS;
    }

    function diagnoseAdaptiveRoots(base = globalThis.document?.body, options = {}) {
      const profile = resolveProfile(
        options.site,
        base?.ownerDocument || globalThis.document,
        globalThis.location
      );
      if (typeof profile?.diagnoseAdaptiveRoots === 'function') {
        return profile.diagnoseAdaptiveRoots(base, options);
      }
      if (typeof profile?.findAdaptiveRoots === 'function') {
        return profile.findAdaptiveRoots(base, options)
          .map(root => ({ root, source: `site:${profile.id}` }));
      }
      return EMPTY_TARGETS;
    }

    function getAdaptiveRoot(element, options = {}) {
      const profile = resolveProfile(
        options.site,
        element?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.getAdaptiveRoot === 'function'
        ? profile.getAdaptiveRoot(element, options)
        : null;
    }

    function findSupplementalRoots(base = globalThis.document?.body, options = {}) {
      const profile = resolveProfile(
        options.site,
        base?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.findSupplementalRoots === 'function'
        ? profile.findSupplementalRoots(base, options)
        : EMPTY_TARGETS;
    }

    function getSupplementalRoot(element, options = {}) {
      const profile = resolveProfile(
        options.site,
        element?.ownerDocument || globalThis.document,
        globalThis.location
      );
      return typeof profile?.getSupplementalRoot === 'function'
        ? profile.getSupplementalRoot(element, options)
        : null;
    }

    return Object.freeze({
      registerSiteProfile,
      getSiteProfile,
      getSiteProfileIds() {
        return profiles.map(profile => profile.id);
      },
      detectSite,
      getSemanticTargets,
      getSemanticContentRole,
      getElementPolicy,
      findContentRoots,
      getContentRoot,
      findAdaptiveRoots,
      diagnoseAdaptiveRoots,
      getAdaptiveRoot,
      findSupplementalRoots,
      getSupplementalRoot
    });
  }

  const registry = createSiteAdapterRegistry([xProfile]);

  return Object.freeze({
    ...registry,
    createSiteAdapterRegistry,
    X_POST_TEXT_SELECTOR: xProfile?.POST_TEXT_SELECTOR || '',
    X_SURFACE_SELECTOR: xProfile?.SURFACE_SELECTOR || '',
    X_METADATA_SELECTOR: xProfile?.METADATA_SELECTOR || '',
    X_NAVIGATION_SELECTOR: xProfile?.NAVIGATION_SELECTOR || '',
    X_SUPPLEMENTAL_ROOT_SELECTOR: xProfile?.SUPPLEMENTAL_ROOT_SELECTOR || '',
    isXHost: hostname => Boolean(xProfile?.isXHost?.(hostname)),
    hasXSurface: documentRef => Boolean(xProfile?.hasXSurface?.(documentRef))
  });
});
