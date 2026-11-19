/**
 * Content-script bundle resolution and reinjection.
 *
 * Manifest-declared content scripts are not present in tabs that were already
 * open before an extension update. Reinjecting only the entry script leaves its
 * shared kernels unavailable, so the fallback bundle is resolved from the
 * manifest and injected in the declared order.
 */
(function initContentScriptInjection(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITContentScriptInjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const ENTRY_SCRIPT = 'content/content.js';

  function resolveContentScriptAssets(manifest, entryScript = ENTRY_SCRIPT) {
    const definitions = Array.isArray(manifest?.content_scripts)
      ? manifest.content_scripts
      : [];
    const definition = definitions.find(candidate =>
      Array.isArray(candidate?.js) && candidate.js.includes(entryScript)
    );

    if (!definition) {
      throw new Error(
        `Page translation content script is missing from manifest: ${entryScript}`
      );
    }

    return Object.freeze({
      scripts: Object.freeze([...definition.js]),
      css: Object.freeze(
        Array.isArray(definition.css) ? [...definition.css] : []
      )
    });
  }

  async function injectContentScriptAssets(api, tabId, options = {}) {
    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new TypeError('A valid tab id is required for content-script injection');
    }
    if (!api?.scripting) {
      throw new TypeError('chrome.scripting is required for content-script injection');
    }

    const assets = resolveContentScriptAssets(
      api.runtime?.getManifest?.(),
      options.entryScript || ENTRY_SCRIPT
    );
    const target = { tabId };

    if (assets.css.length > 0) {
      try {
        await api.scripting.insertCSS({ target, files: [...assets.css] });
      } catch (error) {
        if (typeof options.onCssError === 'function') {
          options.onCssError(error);
        }
      }
    }

    await api.scripting.executeScript({
      target,
      files: [...assets.scripts]
    });

    return assets;
  }

  return Object.freeze({
    ENTRY_SCRIPT,
    injectContentScriptAssets,
    resolveContentScriptAssets
  });
});
