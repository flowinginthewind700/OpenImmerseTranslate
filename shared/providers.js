/**
 * Open Immerse Translate - Shared Provider Configuration
 * 
 * 所有 provider 默认配置的单一数据源。
 * 在 background、content script 和 popup 中共用。
 */

const PROVIDER_DEFAULTS = {
  google: {
    id: 'google',
    endpoint: '',
    model: '',
    apiKey: '',
    hintKey: 'hintGoogle',
    needsApiKey: false,
    displayName: 'Google 翻译'
  },
  deepseek: {
    id: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    apiKey: '',
    hintKey: 'hintDeepSeek',
    needsApiKey: true,
    displayName: 'DeepSeek'
  },
  openai: {
    id: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKey: '',
    hintKey: 'hintOpenAI',
    needsApiKey: true,
    displayName: 'OpenAI'
  },
  anthropic: {
    id: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-haiku-20240307',
    apiKey: '',
    hintKey: 'hintAnthropic',
    needsApiKey: true,
    displayName: 'Claude'
  },
  moonshot: {
    id: 'moonshot',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    apiKey: '',
    hintKey: 'hintMoonshot',
    needsApiKey: true,
    displayName: 'Moonshot'
  },
  zhipu: {
    id: 'zhipu',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    apiKey: '',
    hintKey: 'hintZhipu',
    needsApiKey: true,
    displayName: '智谱 GLM'
  },
  ollama: {
    id: 'ollama',
    endpoint: 'http://localhost:11434/api/chat',
    model: 'qwen3',
    apiKey: '',
    hintKey: 'hintOllama',
    needsApiKey: false,
    displayName: 'Ollama'
  },
  custom: {
    id: 'custom',
    endpoint: '',
    model: '',
    apiKey: '',
    hintKey: 'hintCustom',
    needsApiKey: true,
    displayName: '自定义 API'
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.OITProviders = Object.freeze({
    PROVIDER_DEFAULTS
  });
}

function getDefaultEndpoint(providerId) {
  return PROVIDER_DEFAULTS[providerId]?.endpoint ?? '';
}

function getDefaultModel(providerId) {
  return PROVIDER_DEFAULTS[providerId]?.model ?? '';
}

function checkNeedsApiKey(providerId) {
  const def = PROVIDER_DEFAULTS[providerId];
  return def ? def.needsApiKey !== false : true;
}

// ==================== Shared Translation Parsing ====================

/**
 * Translation separator protocol.
 * 
 * We use a multi-character delimiter that's highly unlikely to appear in
 * natural text, and we also support JSON array parsing as a fallback.
 */
const providerTranslationCore = globalThis.OITTranslationCore;

if (!providerTranslationCore) {
  throw new Error('OIT translation core must be loaded before shared/providers.js');
}

/**
 * Build the user prompt that tells the LLM to use our separator.
 * @param {string[]} texts - Original texts to translate
 * @param {string} targetLang - Target language name
 * @returns {string}
 */
function buildTranslationPrompt(texts, targetLang) {
  return providerTranslationCore.buildUserPrompt(texts, { targetLang }, {});
}

/**
 * Parse LLM translation response into individual translations.
 * 
 * Strategy (tried in order):
 * 1. JSON array (robust): if the response starts with '[', try JSON.parse
 * 2. OIT_SEP delimiter: split on our custom separator
 * 3. Legacy [SEP] fallback: for backward compatibility
 * 
 * @param {string} content - Raw LLM response
 * @returns {string[]} Array of individual translations
 */
function parseTranslations(content, expectedCount) {
  if (!content || typeof content !== 'string') return [];

  if (Number.isInteger(expectedCount) && expectedCount > 0) {
    return providerTranslationCore.parseBatchTranslations(content, expectedCount);
  }

  // Legacy responses are tolerated only when the caller did not request a
  // strict array. The strict path above never filters or reorders items.
  if (content.includes('<<<OIT_SEP>>>')) {
    const parts = content.split(/\s*<<<OIT_SEP>>>\s*/);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
  }

  const parts = content.split(/\s*\[SEP\]\s*/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// ==================== Shared Error Handling ====================

/**
 * Parse a raw error object/string into a user-facing error key.
 * Used by both content script and popup.
 * 
 * @param {Error|object|string} error - Raw error from API call
 * @returns {{ key: string, message: string }}
 */
function parseTranslationError(error) {
  const msg = (error?.message || error?.toString?.() || '').toLowerCase();

  // API Key issues
  if (msg.includes('invalid api key') || msg.includes('incorrect api key') ||
      msg.includes('authentication') || msg.includes('unauthorized') ||
      msg.includes('401')) {
    return { key: 'errorApiKeyInvalid', message: 'API 密钥无效，请检查' };
  }
  if (msg.includes('api key') || msg.includes('apikey')) {
    return { key: 'errorApiKeyMissing', message: '请配置 API 密钥' };
  }

  // Rate limiting
  if (msg.includes('429') || msg.includes('rate limit') ||
      msg.includes('too many requests') || msg.includes('concurrency')) {
    return { key: 'errorRateLimit', message: '请求过于频繁' };
  }

  // Quota / balance
  if (msg.includes('quota') || msg.includes('exceeded')) {
    return { key: 'errorQuotaExceeded', message: 'API 配额已用尽' };
  }
  if (msg.includes('balance') || msg.includes('insufficient') ||
      msg.includes('suspended') || msg.includes('billing')) {
    return { key: 'errorInsufficientBalance', message: '账户余额不足' };
  }

  // Network
  if (msg.includes('network') || msg.includes('failed to fetch') ||
      msg.includes('connection') || msg.includes('econnrefused')) {
    return { key: 'errorNetworkFailed', message: '网络连接失败' };
  }
  if (msg.includes('timeout')) {
    return { key: 'errorTimeout', message: '请求超时' };
  }

  // Server errors
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') ||
      msg.includes('server error')) {
    return { key: 'errorServerError', message: '服务器暂时不可用' };
  }

  // Model
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist'))) {
    return { key: 'errorModelNotFound', message: '模型未找到' };
  }

  // Permission
  if (msg.includes('permission') || msg.includes('403')) {
    return { key: 'errorPermissionDenied', message: '权限不足' };
  }

  // Unknown
  return { key: 'errorUnknown', message: msg.substring(0, 100) || '未知错误' };
}
