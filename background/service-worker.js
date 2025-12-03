/**
 * Open Immerse Translate - Service Worker
 * 后台服务脚本 - 带请求限流和重试机制
 */

console.log('[OpenImmerseTranslate] Service worker started');

// ==================== 请求限流器 ====================
class RateLimiter {
  constructor(maxConcurrent = 2, minInterval = 1000) {
    this.maxConcurrent = maxConcurrent;  // 最大并发数
    this.minInterval = minInterval;       // 最小请求间隔(ms)
    this.activeRequests = 0;
    this.lastRequestTime = 0;
    this.queue = [];
  }
  
  async acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (this.activeRequests < this.maxConcurrent && timeSinceLastRequest >= this.minInterval) {
          this.activeRequests++;
          this.lastRequestTime = now;
          resolve();
        } else {
          // 计算需要等待的时间
          const waitTime = Math.max(
            this.minInterval - timeSinceLastRequest,
            this.activeRequests >= this.maxConcurrent ? 500 : 0
          );
          setTimeout(tryAcquire, Math.max(waitTime, 100));
        }
      };
      tryAcquire();
    });
  }
  
  release() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }
}

const rateLimiter = new RateLimiter(3, 300); // 最多3并发，间隔300ms（极速模式）

// ==================== 重试机制 ====================
async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
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

// ==================== 消息监听 ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OpenImmerseTranslate] Background received:', message.action);
  
  (async () => {
    try {
      switch (message.action) {
        case 'translate':
          const translations = await handleTranslate(message.texts, message.config);
          sendResponse({ translations });
          break;
          
        case 'testApi':
          const testResult = await handleTestApi(message.config);
          sendResponse(testResult);
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
async function handleTranslate(texts, config) {
  if (!texts || texts.length === 0) {
    return [];
  }
  
  // 使用限流器
  await rateLimiter.acquire();
  
  try {
    // 带重试的翻译请求
    return await withRetry(async () => {
      const systemPrompt = buildSystemPrompt(config);
      const userPrompt = buildUserPrompt(texts, config);
      
      switch (config.provider) {
        case 'anthropic':
          return await callAnthropicApi(systemPrompt, userPrompt, config);
        default:
          return await callOpenAICompatibleApi(systemPrompt, userPrompt, config);
      }
    });
  } finally {
    rateLimiter.release();
  }
}

// ==================== 提示词构建 ====================
function buildSystemPrompt(config) {
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский',
    'ar': 'العربية'
  };
  
  const styleGuides = {
    'accurate': '准确翻译，忠实于原文的语义和结构',
    'fluent': '流畅翻译，使译文自然通顺，符合目标语言的表达习惯',
    'creative': '意译，在保持原意的基础上，使用更生动地道的表达'
  };
  
  const targetLang = langNames[config.targetLang] || config.targetLang;
  const styleGuide = styleGuides[config.translationStyle] || styleGuides.accurate;
  
  if (config.customPrompt && config.customPrompt.trim()) {
    return config.customPrompt.replace('{targetLang}', targetLang);
  }
  
  return `你是一个专业的翻译助手。将文本翻译成${targetLang}。

要求：
1. 自动识别源语言
2. 翻译风格：${styleGuide}
3. 如果已是${targetLang}，返回原文
4. 只返回翻译结果，不加解释

格式：多段用 [SEP] 分隔，输出对应分隔`;
}

function buildUserPrompt(texts, config) {
  return texts.join(' [SEP] ');
}

// ==================== API 调用 ====================
async function callOpenAICompatibleApi(systemPrompt, userPrompt, config) {
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
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

async function callAnthropicApi(systemPrompt, userPrompt, config) {
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
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

function parseTranslations(content) {
  const parts = content.split(/\s*\[SEP\]\s*/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// ==================== 测试 API ====================
async function handleTestApi(config) {
  const testPrompt = 'Hello';
  
  try {
    const langNames = { 'zh-CN': '简体中文', 'en': 'English' };
    const targetLang = langNames[config.targetLang] || '简体中文';
    
    await rateLimiter.acquire();
    
    try {
      switch (config.provider) {
        case 'anthropic':
          await callAnthropicApi(`翻译成${targetLang}`, testPrompt, config);
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
    case 'translatePage':
      const result = await chrome.storage.sync.get('config');
      const config = result.config || {};
      
      if (!config.apiKey) {
        chrome.action.openPopup();
        return;
      }
      
      chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        config: config
      });
      break;
      
    case 'removeTranslations':
      chrome.tabs.sendMessage(tab.id, { action: 'removeTranslations' });
      break;
  }
});
