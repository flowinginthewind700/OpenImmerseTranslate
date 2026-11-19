/**
 * Open Immerse Translate - extension configuration normalization.
 *
 * Resolves the global setting document and the selected provider document into
 * the runtime request config used by background translation services.
 */
(function initExtensionConfig(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITExtensionConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExtensionConfigApi() {
  'use strict';

  const STORAGE_KEY_GLOBAL = 'globalConfig';
  const STORAGE_KEY_PROVIDERS = 'providerConfigs';
  const DEFAULT_GLOBAL_CONFIG = Object.freeze({
    provider: 'google',
    sourceLang: 'auto',
    targetLang: 'zh-CN',
    translationStyle: 'accurate',
    translationScope: 'smart',
    showOriginal: true,
    autoDetect: true,
    showFab: true,
    customPrompt: '',
    maxTokens: 2048,
    temperature: 0.3,
    maxConcurrent: 6,
    uiLanguage: '',
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function clampNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function resolveDefaults(providerDefaults, provider) {
    const defaults = providerDefaults?.[provider]
      || providerDefaults?.custom
      || {};
    return isRecord(defaults) ? defaults : {};
  }

  function buildRuntimeConfig(options = {}) {
    const providerDefaults = isRecord(options.providerDefaults)
      ? options.providerDefaults
      : globalThis.OITProviders?.PROVIDER_DEFAULTS || {};
    const savedGlobal = isRecord(options.globalConfig) ? options.globalConfig : {};
    const savedProviders = isRecord(options.providerConfigs)
      ? options.providerConfigs
      : {};
    const overrides = isRecord(options.overrides) ? options.overrides : {};
    const globalConfig = { ...DEFAULT_GLOBAL_CONFIG, ...savedGlobal };
    const requestedProvider = String(globalConfig.provider || 'google');
    const provider = providerDefaults[requestedProvider] ? requestedProvider : 'google';
    const providerDefaultsForSelection = resolveDefaults(providerDefaults, provider);
    const providerConfig = isRecord(savedProviders[provider])
      ? savedProviders[provider]
      : {};

    return {
      provider,
      apiEndpoint: providerConfig.endpoint
        || providerDefaultsForSelection.endpoint
        || '',
      apiKey: providerConfig.apiKey || '',
      modelName: providerConfig.model
        || providerDefaultsForSelection.model
        || '',
      sourceLang: overrides.sourceLang || globalConfig.sourceLang || 'auto',
      targetLang: overrides.targetLang || globalConfig.targetLang || 'zh-CN',
      translationStyle: overrides.translationStyle
        || globalConfig.translationStyle
        || 'accurate',
      translationScope: overrides.translationScope
        || (globalConfig.translationScope === 'full' ? 'full' : 'smart'),
      showOriginal: overrides.showOriginal ?? (globalConfig.showOriginal !== false),
      autoDetect: overrides.autoDetect ?? (globalConfig.autoDetect !== false),
      showFab: overrides.showFab ?? (globalConfig.showFab !== false),
      customPrompt: overrides.customPrompt ?? globalConfig.customPrompt ?? '',
      maxTokens: clampInteger(
        overrides.maxTokens ?? globalConfig.maxTokens,
        DEFAULT_GLOBAL_CONFIG.maxTokens,
        256,
        8192,
      ),
      temperature: clampNumber(
        overrides.temperature ?? globalConfig.temperature,
        DEFAULT_GLOBAL_CONFIG.temperature,
        0,
        1,
      ),
      maxConcurrent: clampInteger(
        overrides.maxConcurrent ?? globalConfig.maxConcurrent,
        DEFAULT_GLOBAL_CONFIG.maxConcurrent,
        1,
        12,
      ),
      uiLanguage: overrides.uiLanguage ?? globalConfig.uiLanguage ?? '',
    };
  }

  async function loadRuntimeConfig(storageArea, options = {}) {
    if (!storageArea || typeof storageArea.get !== 'function') {
      throw new Error('Extension config requires a storage area');
    }

    const stored = await storageArea.get([
      STORAGE_KEY_GLOBAL,
      STORAGE_KEY_PROVIDERS,
    ]);
    return buildRuntimeConfig({
      providerDefaults: options.providerDefaults,
      globalConfig: stored?.[STORAGE_KEY_GLOBAL],
      providerConfigs: stored?.[STORAGE_KEY_PROVIDERS],
      overrides: options.overrides,
    });
  }

  function isProviderConfigured(config, providerDefaults = globalThis.OITProviders?.PROVIDER_DEFAULTS) {
    const provider = config?.provider || 'google';
    const defaults = resolveDefaults(providerDefaults, provider);
    if (defaults.needsApiKey === false) return true;
    return Boolean(String(config?.apiKey || '').trim());
  }

  function getProviderDisplayName(provider, providerDefaults = globalThis.OITProviders?.PROVIDER_DEFAULTS) {
    return resolveDefaults(providerDefaults, provider).displayName || provider || 'Google';
  }

  return Object.freeze({
    STORAGE_KEY_GLOBAL,
    STORAGE_KEY_PROVIDERS,
    DEFAULT_GLOBAL_CONFIG,
    buildRuntimeConfig,
    loadRuntimeConfig,
    isProviderConfigured,
    getProviderDisplayName,
  });
});
