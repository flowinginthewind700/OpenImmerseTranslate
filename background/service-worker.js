/**
 * Open Immerse Translate - Service Worker
 * 后台服务脚本 - 带请求限流、重试机制和 Tab 状态管理
 */

import '../shared/prompt-policy.js';
import '../shared/translation-core.js';
import '../shared/model-policy.js';
import '../shared/request-cache.js';
import '../shared/request-timeout.js';
import './rate-limiter.js';
import './provider-transport.js';
import './translation-service.js';

console.log('[OpenImmerseTranslate] Service worker started');

const translationCore = globalThis.OITTranslationCore;
const modelPolicy = globalThis.OITModelPolicy;
const requestCacheModule = globalThis.OITRequestCache;
const requestTimeoutModule = globalThis.OITRequestTimeout;
const rateLimiterModule = globalThis.OITRateLimiter;
const providerTransportModule = globalThis.OITProviderTransport;
const translationServiceModule = globalThis.OITTranslationService;

if (!translationCore
    || !modelPolicy
    || !requestCacheModule
    || !requestTimeoutModule
    || !rateLimiterModule
    || !providerTransportModule
    || !translationServiceModule) {
  throw new Error('Background kernel modules failed to load in the service worker');
}

const rateLimiter = new rateLimiterModule.RateLimiter(6, 300);
const providerTransport = providerTransportModule.createProviderTransport({
  modelPolicy,
  translationCore,
  rateLimiter,
  rateLimiterApi: rateLimiterModule,
  requestTimeoutApi: requestTimeoutModule
});
const translationService = translationServiceModule.createTranslationService({
  translationCore,
  modelPolicy,
  requestCacheModule,
  providerTransport,
  rateLimiter,
  scheduler: rateLimiterModule,
  promptPolicyVersion: globalThis.OITPromptPolicy?.PROMPT_POLICY_VERSION,
  cacheOptions: {
    maxEntries: 500,
    ttlMs: 10 * 60 * 1000
  }
});

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
  translationScope: 'smart',
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
  return rateLimiterModule.clampMaxConcurrent(
    value,
    DEFAULT_GLOBAL_CONFIG.maxConcurrent
  );
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

// ==================== 消息监听 ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log('[OpenImmerseTranslate] Background received:', message.action, 'from tab:', tabId);
  
  (async () => {
    try {
      switch (message.action) {
        case 'translate':
          const translations = await handleTranslate(
            message.texts,
            message.config,
            message.requestId,
            message.context
          );
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

        case 'getTranslationCacheStats':
          sendResponse({ stats: translationService.stats() });
          break;

        case 'clearTranslationCache':
          translationService.clearCache();
          sendResponse({ success: true });
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
async function handleTranslate(texts, config, requestId, context) {
  if (!texts || texts.length === 0) {
    return [];
  }

  const controller = createRequestController(requestId);
  try {
    return await translationService.translate(texts, config, context, {
      signal: controller?.signal
    });
  } finally {
    removeRequestController(requestId);
  }
}

// ==================== 测试 API ====================
async function handleTestApi(config) {
  await rateLimiter.acquire();
  try {
    return await providerTransport.testProvider(config);
  } finally {
    rateLimiter.release();
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
    translationScope: global.translationScope === 'full' ? 'full' : 'smart',
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
