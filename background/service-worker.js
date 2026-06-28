/**
 * Open Immerse Translate - Service Worker
 * 后台服务脚本 - 带请求限流、重试机制和 Tab 状态管理
 */

console.log('[OpenImmerseTranslate] Service worker started');

// ==================== Shared translation helpers (inlined for MV3 module worker) ====================
const TRANSLATION_SEPARATOR = '\n<<<OIT_SEP>>>\n';

function parseTranslations(content) {
  if (!content || typeof content !== 'string') return [];

  const trimmed = content.trim();

  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map(p => String(p).trim()).filter(p => p.length > 0);
      }
    } catch (e) {
      // fall through
    }
  }

  if (content.includes('<<<OIT_SEP>>>')) {
    const parts = content.split(/\s*<<<OIT_SEP>>>\s*/);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
  }

  const parts = content.split(/\s*\[SEP\]\s*/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// ==================== Tab 状态管理 ====================
// 使用 Map 存储每个 tab 的翻译状态
const tabStates = new Map();

// Tab 状态结构
function createTabState() {
  return {
    isTranslating: false,
    translatedCount: 0,
    hasTranslations: false,
    lastUpdated: Date.now()
  };
}

// 获取 Tab 状态
function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, createTabState());
  }
  return tabStates.get(tabId);
}

// 更新 Tab 状态
function updateTabState(tabId, updates) {
  const state = getTabState(tabId);
  Object.assign(state, updates, { lastUpdated: Date.now() });
  tabStates.set(tabId, state);
  console.log(`[OIT] Tab ${tabId} state updated:`, state);
}

// 清理 Tab 状态
function clearTabState(tabId) {
  tabStates.delete(tabId);
  console.log(`[OIT] Tab ${tabId} state cleared`);
}

// 监听 Tab 关闭事件，清理状态
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

// 监听 Tab 更新事件（页面导航）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当页面开始加载新 URL 时，重置状态
  if (changeInfo.status === 'loading' && changeInfo.url) {
    clearTabState(tabId);
  }
});

// ==================== 配置常量（兼容新的 modular storage）====================
const DEFAULT_GLOBAL_CONFIG = {
  provider: 'google',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  translationStyle: 'accurate',
  showOriginal: true,
  autoDetect: true,
  customPrompt: '',
  maxTokens: 2048,
  temperature: 0.3,
  maxConcurrent: 6
};

const PROVIDER_DEFAULTS_SW = {
  google:   { endpoint: '', model: '', needsApiKey: false },
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', needsApiKey: true },
  openai:   { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', needsApiKey: true },
  anthropic:{ endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-haiku-20240307', needsApiKey: true },
  moonshot: { endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k', needsApiKey: true },
  zhipu:    { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', needsApiKey: true },
  ollama:   { endpoint: 'http://localhost:11434/api/chat', model: 'qwen3', needsApiKey: false },
  custom:   { endpoint: '', model: '', needsApiKey: true }
};

function clampMaxConcurrentFromConfig(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_GLOBAL_CONFIG.maxConcurrent;
  return Math.min(12, Math.max(1, n));
}

// ==================== 请求限流器 ====================
class RateLimiter {
  constructor(maxConcurrent = 2, minInterval = 1000) {
    this.maxConcurrent = maxConcurrent;  // 最大并发数
    this.minInterval = minInterval;       // 最小请求间隔(ms)
    this.activeRequests = 0;
    this.lastRequestTime = 0;
    // Event-driven: queue of resolve callbacks instead of polling
    this.waitQueue = [];
  }
  
  async acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (this.activeRequests >= this.maxConcurrent) {
          // 并发槽位满：排队等待 release() 唤醒
          this.waitQueue.push(() => tryAcquire());
        } else if (timeSinceLastRequest < this.minInterval) {
          // 间隔不足：setTimeout 自唤醒，不依赖 release()
          setTimeout(tryAcquire, this.minInterval - timeSinceLastRequest + 10);
        } else {
          this.activeRequests++;
          this.lastRequestTime = now;
          resolve();
        }
      };
      tryAcquire();
    });
  }
  
  release() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    // Wake up next waiter if any
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      // Schedule on next microtask to avoid stack overflow
      Promise.resolve().then(next);
    }
  }

  /** 与页面配置同步并发上限（每次 translate 前调用） */
  applyConfig(config) {
    const max = clampMaxConcurrentFromConfig(config?.maxConcurrent);
    this.maxConcurrent = max;
  }
}

const rateLimiter = new RateLimiter(6, 300);

// ==================== 重试机制 ====================
async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 用户主动取消，不重试
      if (isAbortError(error)) {
        throw error;
      }

      // 检查是否是限流错误
      const isRateLimitError = error.message && (
        error.message.includes('concurrency') ||
        error.message.includes('rate limit') ||
        error.message.includes('too many requests') ||
        error.message.includes('429')
      );

      if (isRateLimitError && attempt < maxRetries - 1) {
        // 指数退避
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[OpenImmerseTranslate] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      // 其他错误直接抛出
      if (!isRateLimitError) {
        throw error;
      }
    }
  }
  
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== In-flight 请求取消管理 ====================
const inflightControllers = new Map();

function createRequestController(requestId) {
  if (!requestId) return null;
  const controller = new AbortController();
  inflightControllers.set(requestId, controller);
  return controller;
}

function removeRequestController(requestId) {
  if (requestId) inflightControllers.delete(requestId);
}

function abortRequest(requestId) {
  const controller = inflightControllers.get(requestId);
  if (controller) {
    controller.abort();
    inflightControllers.delete(requestId);
    console.log(`[OpenImmerseTranslate] Aborted request ${requestId}`);
    return true;
  }
  return false;
}

function isAbortError(error) {
  return error && (error.name === 'AbortError' ||
    (error.message && error.message.toLowerCase().includes('abort')));
}

// ==================== 消息监听 ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log('[OpenImmerseTranslate] Background received:', message.action, 'from tab:', tabId);
  
  (async () => {
    try {
      switch (message.action) {
        case 'translate':
          const translations = await handleTranslate(message.texts, message.config, message.requestId);
          sendResponse(translations === null ? { cancelled: true } : { translations });
          break;

        case 'abortRequest':
          const aborted = abortRequest(message.requestId);
          sendResponse({ success: aborted });
          break;

        case 'testApi':
          const testResult = await handleTestApi(message.config);
          sendResponse(testResult);
          break;
        
        // Tab 状态管理
        case 'updateTabState':
          if (tabId) {
            updateTabState(tabId, message.state);
          }
          sendResponse({ success: true });
          break;
          
        case 'getTabState':
          if (tabId) {
            sendResponse(getTabState(tabId));
          } else {
            sendResponse(createTabState());
          }
          break;
          
        case 'clearTabState':
          if (tabId) {
            clearTabState(tabId);
          }
          sendResponse({ success: true });
          break;
          
        // 转发翻译状态变化到所有监听者（popup）
        case 'translationStateChanged':
          if (tabId) {
            updateTabState(tabId, {
              isTranslating: message.isTranslating,
              translatedCount: message.translatedCount,
              hasTranslations: message.hasTranslations
            });
          }
          // 继续广播消息（popup 会收到）
          sendResponse({ success: true });
          break;
          
        case 'translationComplete':
          if (tabId) {
            updateTabState(tabId, {
              isTranslating: false,
              translatedCount: message.count,
              hasTranslations: true
            });
          }
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[OpenImmerseTranslate] Error:', error);
      sendResponse({ error: error.message });
    }
  })();
  
  return true;
});

// ==================== 翻译处理 ====================
async function handleTranslate(texts, config, requestId) {
  if (!texts || texts.length === 0) {
    return [];
  }

  rateLimiter.applyConfig(config);
  const controller = createRequestController(requestId);
  const signal = controller?.signal;

  // Google 翻译使用单独的处理流程
  if (config.provider === 'google') {
    try {
      return await handleGoogleTranslate(texts, config, signal);
    } finally {
      removeRequestController(requestId);
    }
  }

  // 使用限流器
  await rateLimiter.acquire();

  try {
    // 带重试的翻译请求
    return await withRetry(async () => {
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }
      const systemPrompt = buildSystemPrompt(config);
      const userPrompt = buildUserPrompt(texts);

      switch (config.provider) {
        case 'anthropic':
          return await callAnthropicApi(systemPrompt, userPrompt, config, signal);
        case 'ollama':
          return await callOllamaApi(systemPrompt, userPrompt, config, signal);
        default:
          return await callOpenAICompatibleApi(systemPrompt, userPrompt, config, signal);
      }
    });
  } catch (error) {
    if (isAbortError(error)) {
      return null; // 取消标记
    }
    throw error;
  } finally {
    removeRequestController(requestId);
    rateLimiter.release();
  }
}

// ==================== Google 翻译 ====================
async function handleGoogleTranslate(texts, config, signal) {
  const results = [];
  const sourceLang = config.sourceLang || 'auto';
  const targetLang = convertToGoogleLangCode(config.targetLang);

  for (const text of texts) {
    if (signal?.aborted) break;
    await rateLimiter.acquire();
    try {
      const translation = await callGoogleTranslateApi(text, sourceLang, targetLang, signal);
      results.push(translation);
    } catch (error) {
      if (isAbortError(error)) break;
      console.error('[OpenImmerseTranslate] Google translate error:', error);
      results.push(text); // 失败时返回原文
    } finally {
      rateLimiter.release();
    }
  }

  return results;
}

// 转换语言代码为 Google 格式
/**
 * Convert internal language codes to Google Translate API codes.
 * 
 * Google Translate uses BCP-47 / ISO 639-1 codes.
 * Our internal codes already match Google's for all supported languages,
 * but we keep an explicit mapping for clarity and future-proofing.
 * 
 * Ref: https://cloud.google.com/translate/docs/languages
 */
function convertToGoogleLangCode(langCode) {
  // All supported languages and their Google Translate codes
  const mapping = {
    'auto':   'auto',    // Auto-detect
    'zh-CN':  'zh-CN',   // Chinese (Simplified)
    'zh-TW':  'zh-TW',   // Chinese (Traditional)
    'en':     'en',      // English
    'ja':     'ja',      // Japanese
    'ko':     'ko',      // Korean
    'fr':     'fr',      // French
    'de':     'de',      // German
    'es':     'es',      // Spanish
    'ru':     'ru',      // Russian
    'ar':     'ar',      // Arabic
    'pt':     'pt',      // Portuguese
    'it':     'it',      // Italian
    'vi':     'vi',      // Vietnamese
    'th':     'th',      // Thai
  };
  return mapping[langCode] || langCode;
}

// 调用 Google 翻译 API（免费版）
async function callGoogleTranslateApi(text, sourceLang, targetLang, signal) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Google Translate API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 解析 Google 翻译返回的数据格式
  // 格式: [[["翻译结果","原文",null,null,1]],null,"en"]
  if (data && data[0]) {
    let translation = '';
    for (const part of data[0]) {
      if (part[0]) {
        translation += part[0];
      }
    }
    return translation || text;
  }
  
  return text;
}

// ==================== 提示词构建 ====================
function buildSystemPrompt(config) {
  const langNames = {
    'auto': '自动检测',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский',
    'ar': 'العربية',
    'pt': 'Português',
    'it': 'Italiano',
    'vi': 'Tiếng Việt',
    'th': 'ไทย'
  };
  
  const styleGuides = {
    'accurate': '准确翻译，忠实于原文的语义和结构',
    'fluent': '流畅翻译，使译文自然通顺，符合目标语言的表达习惯',
    'creative': '意译，在保持原意的基础上，使用更生动地道的表达'
  };
  
  const targetLang = langNames[config.targetLang] || config.targetLang;
  const sourceLang = config.sourceLang && config.sourceLang !== 'auto' 
    ? langNames[config.sourceLang] || config.sourceLang 
    : null;
  const styleGuide = styleGuides[config.translationStyle] || styleGuides.accurate;
  
  if (config.customPrompt && config.customPrompt.trim()) {
    return config.customPrompt
      .replace('{targetLang}', targetLang)
      .replace('{sourceLang}', sourceLang || '自动检测');
  }
  
  const sourceInstruction = sourceLang 
    ? `源语言是${sourceLang}` 
    : '自动识别源语言';
  
  return `你是一个专业的翻译助手。将文本翻译成${targetLang}。

要求：
1. ${sourceInstruction}
2. 翻译风格：${styleGuide}
3. 如果已是${targetLang}，返回原文
4. 只返回翻译结果，不加解释

格式：多段用 "${TRANSLATION_SEPARATOR}" 分隔，输出对应分隔`;
}

/**
 * 构建用户提示词
 * Delegates to shared/providers.js (but we inline separator joining for speed)
 */
function buildUserPrompt(texts) {
  // This is effectively what buildTranslationPrompt() does minus the surrounding instructions
  // We keep the fast-path logic for single/batch texts
  if (texts.length === 1) return texts[0];
  if (texts.length === 0) return '';
  const parts = new Array(texts.length * 2 - 1);
  for (let i = 0; i < texts.length; i++) {
    parts[i * 2] = texts[i];
    if (i < texts.length - 1) {
      parts[i * 2 + 1] = TRANSLATION_SEPARATOR;
    }
  }
  return parts.join('');
}

// ==================== API 调用 ====================
async function callOpenAICompatibleApi(systemPrompt, userPrompt, config, signal) {
  const headers = { 'Content-Type': 'application/json' };

  if (config.apiKey && config.apiKey.trim()) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature || 0.3
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || errorData.message || `API错误: ${response.status}`;
    throw new Error(errorMsg);
  }
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  return parseTranslations(content);
}

// Ollama 原生 API 调用
async function callOllamaApi(systemPrompt, userPrompt, config, signal) {
  let endpoint = config.apiEndpoint;

  if (endpoint.includes('/v1/chat/completions')) {
    endpoint = endpoint.replace('/v1/chat/completions', '/api/chat');
  } else if (!endpoint.includes('/api/')) {
    endpoint = endpoint.replace(/\/$/, '') + '/api/chat';
  }

  console.log('[OpenImmerseTranslate] Ollama endpoint:', endpoint);

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: {
        temperature: config.temperature || 0.3
      }
    })
  });
  
  console.log('[OpenImmerseTranslate] Ollama response status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[OpenImmerseTranslate] Ollama error:', response.status, errorText);
    
    if (response.status === 403) {
      // 提供更友好的错误信息和解决方案
      throw new Error('Ollama 连接被拒绝。请在终端运行: OLLAMA_ORIGINS=* ollama serve');
    }
    if (response.status === 404) {
      throw new Error(`模型 "${config.modelName}" 未找到，请先运行: ollama pull ${config.modelName}`);
    }
    
    throw new Error(`Ollama 错误: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  const content = data.message?.content || '';
  
  console.log('[OpenImmerseTranslate] Ollama response content:', content.substring(0, 100));
  
  return parseTranslations(content);
}

async function callAnthropicApi(systemPrompt, userPrompt, config, signal) {
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.modelName,
      max_tokens: config.maxTokens || 2048,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `API错误: ${response.status}`;
    throw new Error(errorMsg);
  }
  
  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  
  return parseTranslations(content);
}

// parseTranslations() and buildTranslationPrompt() are now in shared/providers.js

// ==================== 测试 API ====================
async function handleTestApi(config) {
  const testPrompt = 'Hello';
  
  try {
    const langNames = { 'zh-CN': '简体中文', 'en': 'English' };
    const targetLang = langNames[config.targetLang] || '简体中文';
    
    await rateLimiter.acquire();
    
    try {
      switch (config.provider) {
        case 'google':
          // Google 翻译测试
          await callGoogleTranslateApi(testPrompt, 'en', convertToGoogleLangCode(config.targetLang));
          break;
        case 'anthropic':
          await callAnthropicApi(`翻译成${targetLang}`, testPrompt, config);
          break;
        case 'ollama':
          await callOllamaApi(`翻译成${targetLang}`, testPrompt, config);
          break;
        default:
          await callOpenAICompatibleApi(`翻译成${targetLang}`, testPrompt, config);
      }
    } finally {
      rateLimiter.release();
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 配置组装（兼容新的 modular storage）====================
async function getFullConfigForContextMenu() {
  const result = await chrome.storage.sync.get(['globalConfig', 'providerConfigs']);
  const global = { ...DEFAULT_GLOBAL_CONFIG, ...(result.globalConfig || {}) };
  const providerId = global.provider || 'google';
  const providerSaved = (result.providerConfigs || {})[providerId] || {};
  const providerDefaults = PROVIDER_DEFAULTS_SW[providerId] || PROVIDER_DEFAULTS_SW.custom;

  return {
    provider: providerId,
    apiEndpoint: providerSaved.endpoint || providerDefaults.endpoint,
    apiKey: providerSaved.apiKey || '',
    modelName: providerSaved.model || providerDefaults.model,
    sourceLang: global.sourceLang || 'auto',
    targetLang: global.targetLang || 'zh-CN',
    translationStyle: global.translationStyle || 'accurate',
    showOriginal: global.showOriginal !== false,
    autoDetect: global.autoDetect !== false,
    customPrompt: global.customPrompt || '',
    maxTokens: global.maxTokens || 2048,
    temperature: global.temperature || 0.3,
    maxConcurrent: clampMaxConcurrentFromConfig(global.maxConcurrent)
  };
}

// ==================== 右键菜单 ====================
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translatePage',
    title: '翻译整个页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'removeTranslations',
    title: '移除翻译',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'translatePage': {
      const config = await getFullConfigForContextMenu();

      // 检查是否需要 API Key
      const providerDefaults = PROVIDER_DEFAULTS_SW[config.provider] || PROVIDER_DEFAULTS_SW.custom;
      if (providerDefaults.needsApiKey && !config.apiKey) {
        chrome.action.openPopup();
        return;
      }

      chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        config
      });
      break;
    }

    case 'removeTranslations':
      chrome.tabs.sendMessage(tab.id, { action: 'removeTranslations' });
      break;
  }
});
