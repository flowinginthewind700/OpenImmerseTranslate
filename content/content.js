/**
 * Open Immerse Translate - Content Script
 * 使用 Intersection Observer 实现视口优先 + 渐进式翻译
 * 
 * 算法特点：
 * 1. 优先翻译视口内可见内容
 * 2. 预加载视口下方 1 屏内容
 * 3. 滚动时自动翻译新进入视口的内容
 * 4. 批量翻译减少 API 调用
 * 5. 智能去重避免重复翻译
 */

// ==================== 扩展上下文检查 ====================
/**
 * 检查扩展上下文是否有效
 * 当扩展被重新加载/更新后，旧的 content script 的 chrome API 会失效
 * @returns {boolean} 上下文是否有效
 */
function isExtensionContextValid() {
  try {
    // 尝试访问 chrome.runtime.id，如果上下文失效会抛出异常
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

/**
 * 安全地执行 chrome API 调用
 * @param {Function} fn - 要执行的异步函数
 * @param {*} fallbackValue - 上下文失效时的回退值
 * @returns {Promise<*>}
 */
async function safeChrome(fn, fallbackValue = null) {
  if (!isExtensionContextValid()) {
    console.warn('[OIT] Extension context invalidated, please refresh the page');
    showContextInvalidatedWarning();
    return fallbackValue;
  }
  
  try {
    return await fn();
  } catch (e) {
    if (e.message?.includes('Extension context invalidated')) {
      console.warn('[OIT] Extension context invalidated:', e.message);
      showContextInvalidatedWarning();
      return fallbackValue;
    }
    throw e; // 其他错误继续抛出
  }
}

/**
 * 显示上下文失效警告（只显示一次）
 * 使用纯 DOM 操作，不依赖 chrome API
 */
let contextWarningShown = false;
function showContextInvalidatedWarning() {
  if (contextWarningShown) return;
  contextWarningShown = true;
  
  console.log('[OIT] 扩展已更新，请刷新页面以继续使用翻译功能');
  
  try {
    // 在 FAB tooltip 显示提示
    if (fab) {
      const tooltip = fab.querySelector('.oit-fab-tooltip');
      if (tooltip) {
        tooltip.textContent = '请刷新页面';
        tooltip.style.opacity = '1';
        tooltip.style.background = '#ef4444';
        tooltip.style.color = 'white';
      }
      
      // 禁用 FAB 按钮
      const fabBtn = fab.querySelector('.oit-fab-btn');
      if (fabBtn) {
        fabBtn.style.opacity = '0.5';
        fabBtn.style.pointerEvents = 'none';
        fabBtn.style.cursor = 'not-allowed';
      }
    }
    
    // 创建一个临时的页面提示（纯 DOM，不依赖 chrome API）
    if (!document.querySelector('.oit-context-warning')) {
      const warning = document.createElement('div');
      warning.className = 'oit-context-warning';
      warning.innerHTML = `
        <span>翻译扩展已更新，请</span>
        <button onclick="location.reload()">刷新页面</button>
        <span>继续使用</span>
        <button class="close" onclick="this.parentElement.remove()">×</button>
      `;
      warning.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      
      // 设置按钮样式
      const style = document.createElement('style');
      style.textContent = `
        .oit-context-warning button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        .oit-context-warning button:hover {
          background: #2563eb;
        }
        .oit-context-warning button.close {
          background: transparent;
          padding: 4px 8px;
          font-size: 18px;
          margin-left: 8px;
        }
        .oit-context-warning button.close:hover {
          background: rgba(255,255,255,0.1);
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(warning);
      
      // 10秒后自动隐藏
      setTimeout(() => {
        warning.style.opacity = '0';
        warning.style.transition = 'opacity 0.3s';
        setTimeout(() => warning.remove(), 300);
      }, 10000);
    }
  } catch (e) {
    // 即使 DOM 操作失败也不要崩溃
    console.error('[OIT] Failed to show warning:', e);
  }
}

// ==================== 配置常量 ====================
const CONFIG = {
  // 视口检测
  ROOT_MARGIN: '50% 0px 150% 0px', // 上方50% + 下方150%
  THRESHOLD: 0.01,

  // 🚀 流式翻译配置（核心优化）
  MAX_CONCURRENT: 6, // 默认并发（可被 globalConfig.maxConcurrent 覆盖）
  SINGLE_TRANSLATE: true, // 启用单条翻译模式（流式显示）
  BATCH_SIZE: 4, // 每个批次最多合并的文本块数
  BATCH_MAX_CHARS: 2000, // 一个批次的最大字符数
  BATCH_MAX_DISTANCE: 400, // 批次内元素最大 Y 坐标距离(px)
  SCAN_INTERVAL: 150, // 滚动扫描间隔(ms)
  SCROLL_DEBOUNCE: 100, // 滚动防抖(ms)

  // 动态内容
  MUTATION_DEBOUNCE: 200,

  // 扫描限制
  MAX_VIEWPORT_SCAN: 300,
  MAX_QUEUE_SIZE: 300, // 队列最大长度（大页面需要更大容量）。低于阈值的低优先级项在满时会被静默丢弃，不会触发迁出日志和 pending 标记。

  // 文本过滤
  MIN_TEXT_LENGTH: 2,
  MAX_TEXT_LENGTH: 5000,

  // 跳过的标签
  SKIP_TAGS: new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'AREA',
    'CODE', 'PRE', 'KBD', 'VAR', 'SAMP', 'INPUT', 'TEXTAREA',
    'SELECT', 'IMG', 'BR', 'HR', 'META', 'LINK', 'HEAD', 'TITLE',
    'PICTURE', 'SOURCE', 'TRACK', 'PARAM', 'BASE'
  ]),

  // 跳过的类名
  SKIP_CLASSES: ['oit-wrapper', 'oit-translation', 'oit-original', 'notranslate', 'no-translate'],

  // 容器标签
  CONTAINER_TAGS: new Set([
    'DIV', 'SPAN', 'P', 'A', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
    'LABEL', 'LEGEND', 'FIGCAPTION', 'BLOCKQUOTE', 'CITE', 'Q',
    'STRONG', 'EM', 'B', 'I', 'U', 'SMALL', 'MARK', 'DEL', 'INS', 'SUB', 'SUP',
    'DT', 'DD', 'ADDRESS', 'TIME', 'ABBR', 'DFN', 'SUMMARY', 'DETAILS',
    'BUTTON'
  ])
};

// 🔥 性能优化: 预编译正则表达式,避免运行时重复编译
const REGEX_PATTERNS = {
  // 只包含数字、空白、标点、符号
  ONLY_PUNCTUATION: /^[\d\s\p{P}\p{S}]+$/u,
  // URL或邮箱
  URL_EMAIL: /^(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+)/,
  // 中文字符
  CHINESE: /[\u4e00-\u9fff]/g,
  // 日文字符
  JAPANESE: /[\u3040-\u309f\u30a0-\u30ff]/g,
  // 韩文字符
  KOREAN: /[\uac00-\ud7af]/g,
  // 空白字符
  WHITESPACE: /\s+/g
};

// ==================== 优先级队列 ====================
// 迁出统计（用于限流日志）
let evictionCount = 0;
let lastEvictionLogTime = 0;

/**
 * 按优先级排序的队列（高分在前）
 * 最大长度可控，使用 O(n) 插入换取简单可靠
 */
class PriorityQueue {
  constructor(maxSize = 200) {
    this.items = [];
    this.maxSize = maxSize;
  }

  get length() {
    return this.items.length;
  }

  enqueue(item, priority) {
    const currentLen = this.items.length;
    if (currentLen >= this.maxSize) {
      const lowest = this.items[currentLen - 1];
      if (!lowest || priority <= lowest.priority) {
        // 新项优先级不高于队列中最低项，直接丢弃，避免无效入队+迁出和日志噪音
        return null;
      }
    }

    const entry = { item, priority, enqueueTime: performance.now() };
    // 按优先级降序插入
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (priority > this.items[i].priority) {
        this.items.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.items.push(entry);
    }
    // 超限丢弃最低优先级的，同时清除 pending 标记
    if (this.items.length > this.maxSize) {
      const evicted = this.items.pop();
      if (evicted?.item?.element) {
        removePendingMark(evicted.item.element);
      }
      // 限流日志：避免在动态页面产生海量噪音，每 20 次或 5 秒汇总输出一次
      evictionCount++;
      const now = performance.now();
      if (evictionCount % 20 === 0 || now - lastEvictionLogTime > 5000) {
        console.log(`[OIT] Queue full, evicted ${evictionCount} low-priority blocks so far (latest: ${evicted?.item?.text?.substring(0, 40) || 'n/a'})`);
        lastEvictionLogTime = now;
      }
    }
    return entry;
  }

  dequeue() {
    if (this.items.length === 0) return null;
    return this.items.shift().item;
  }

  peek() {
    return this.items.length > 0 ? this.items[0].item : null;
  }

  remove(predicate) {
    const before = this.items.length;
    // 清理被移除元素的 pending 标记
    for (const { item } of this.items) {
      if (predicate(item) && item?.element) {
        removePendingMark(item.element);
      }
    }
    this.items = this.items.filter(({ item }) => !predicate(item));
    return before - this.items.length;
  }

  toArray() {
    return this.items.map(({ item }) => item);
  }

  reorder(scorer) {
    for (const entry of this.items) {
      entry.priority = scorer(entry.item, entry.enqueueTime);
    }
    this.items.sort((a, b) => b.priority - a.priority);
  }

  clear() {
    // 清除所有元素上的 pending 标记
    for (const { item } of this.items) {
      if (item?.element) removePendingMark(item.element);
    }
    this.items = [];
  }

  some(predicate) {
    return this.items.some(({ item }) => predicate(item));
  }
}

// ==================== 状态管理 ====================
class TranslationState {
  constructor() {
    this.isActive = false;
    this.shouldStop = false;
    this.config = null;
    this.observer = null;
    this.mutationObserver = null;
    this.mutationTimer = null;
    this.scrollHandler = null; // 滚动监听
    this.scrollTimer = null; // 滚动防抖
    this.translatedCount = 0;
    this.completedElements = new WeakSet();
    this.processedTexts = new Set();
    this.blockMap = new Map();

    // 🚀 优先级翻译队列
    this.translationQueue = new PriorityQueue(CONFIG.MAX_QUEUE_SIZE); // 待翻译优先队列
    this.activeTranslations = 0; // 当前并发数
    this.isProcessing = false; // 是否正在处理队列
    this.queueResolvers = []; // 等待并发槽位的 resolve 回调

    // 🔥 性能优化: 维护待翻译元素的引用,避免全局querySelectorAll
    this.pendingElements = new Set(); // 待翻译元素集合
    this.translatingElements = new Set(); // 翻译中元素集合
    this.inflightRequests = new Map(); // element -> { requestId, abort, blocks }
    this.periodicScanTimer = null; // 定期扫描定时器
    this.requestIdCounter = 0; // 请求 ID 生成器
  }

  reset() {
    this.isActive = false;
    this.shouldStop = false;
    this.translatedCount = 0;
    // 🔥 保留 processedTexts 和 completedElements，避免重复翻译已翻译的内容
    // 这样当用户重新开始翻译时，已经翻译过的内容不会再次翻译
    // this.processedTexts.clear(); // 保留已处理的文本记录
    // this.completedElements 也保留，避免重复翻译
    this.blockMap.clear();
    this.translationQueue.clear(); // 🔥 确保队列被清空（同时清理 pending 标记）
    this.activeTranslations = 0;
    this.isProcessing = false;
    // 唤醒所有等待槽位的 Promise（避免死锁）
    while (this.queueResolvers.length > 0) {
      this.queueResolvers.shift()();
    }

    // 🔥 性能优化: 清理待翻译元素集合
    this.pendingElements.clear();
    this.translatingElements.clear();
    this.inflightRequests.clear();

    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.mutationTimer) {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = null;
    }
    if (this.periodicScanTimer) {
      clearTimeout(this.periodicScanTimer);
      this.periodicScanTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }
  
  /**
   * 完全重置（包括清空已翻译记录）
   * 用于"恢复原样"功能
   */
  fullReset() {
    this.reset();
    this.processedTexts.clear();
    // completedElements 是 WeakSet，会自动清理
  }
}

const state = new TranslationState();

// ==================== 初始化 ====================
console.log('[OpenImmerseTranslate] Content script loaded - Viewport-first algorithm');

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OpenImmerseTranslate] Message:', message.action);
  
  switch (message.action) {
    case 'ping':
      // 用于检测内容脚本是否已加载，同时返回当前翻译状态
      sendResponse({ pong: true, isTranslating: state.isActive });
      break;
    case 'translatePage':
      startTranslation(message.config);
      sendResponse({ success: true });
      // 通知状态变化
      broadcastState('translating');
      // 🔥 同步更新 FAB 状态
      setFabToTranslating();
      break;
    case 'stopTranslate':
      stopTranslation();
      sendResponse({ success: true });
      // 通知状态变化
      broadcastState('stopped');
      // 更新悬浮按钮状态
      resetFabToIdle();
      break;
    case 'removeTranslations':
      removeAllTranslations();
      sendResponse({ success: true });
      // 🔥 同步更新 FAB 状态为初始状态
      resetFabToIdle();
      // 通知状态变化
      broadcastState('idle');
      break;
    case 'getTranslationState':
      // 返回当前翻译状态，用于popup同步
      // 检查页面是否有已翻译的内容
      const hasTranslations = document.querySelectorAll('.oit-wrapper').length > 0;
      sendResponse({ 
        isTranslating: state.isActive,
        translatedCount: state.translatedCount,
        hasTranslations: hasTranslations
      });
      break;
    case 'showFab':
      // 显示悬浮按钮
      showFAB();
      sendResponse({ success: true });
      break;
    case 'hideFab':
      // 隐藏悬浮按钮
      hideFAB();
      sendResponse({ success: true });
      break;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
  return true;
});

// 广播翻译状态变化（安全版本）
function broadcastState(status) {
  // 先检查上下文
  if (!isExtensionContextValid()) return;
  
  try {
    // 检查页面是否有已翻译的内容
    const hasTranslations = document.querySelectorAll('.oit-wrapper').length > 0;
    chrome.runtime.sendMessage({
      action: 'translationStateChanged',
      status: status,
      isTranslating: state.isActive,
      hasTranslations: hasTranslations,
      translatedCount: state.translatedCount
    }).catch(() => {
      // popup 可能已关闭或上下文失效，忽略错误
    });
  } catch (e) {
    // 忽略错误
  }
}

// 发送日志到 popup 控制台
function sendLog(text, type = 'info') {
  console.log(`[OpenImmerseTranslate] ${type.toUpperCase()}: ${text}`);
  // 检查上下文
  if (!isExtensionContextValid()) return;
  
  try {
    chrome.runtime.sendMessage({
      action: 'consoleLog',
      text: text,
      type: type
    }).catch(() => {});
  } catch (e) {
    // popup 可能已关闭或上下文失效，忽略
  }
}

// 重置悬浮按钮到空闲状态
function resetFabToIdle() {
  if (!fab) return;
  
  const fabBtn = fab.querySelector('.oit-fab-btn');
  const tooltip = fab.querySelector('.oit-fab-tooltip');
  
  fabBtn.classList.remove('translating', 'completed');
  fabBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
    </svg>
  `;
  tooltip.textContent = '翻译页面';
}

// ==================== 核心翻译逻辑 ====================

function clampMaxConcurrent(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return CONFIG.MAX_CONCURRENT;
  return Math.min(12, Math.max(1, n));
}

function getMaxConcurrent() {
  return clampMaxConcurrent(state.config?.maxConcurrent);
}

/**
 * 计算文本块的翻译优先级
 * 分数越高越优先：靠近视口中心 > 完全可见 > 等待时间
 */
function computeBlockPriority(block, enqueueTime = performance.now()) {
  if (!block || !block.element) return -Infinity;

  const rect = block.element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportCenter = viewportHeight / 2;
  const elementCenter = rect.top + rect.height / 2;
  const distanceFromCenter = Math.abs(elementCenter - viewportCenter);

  let score = 10000 - distanceFromCenter;

  // 可见区域比例加成
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(viewportHeight, rect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const visibleRatio = rect.height > 0 ? visibleHeight / rect.height : 0;
  score += visibleRatio * 5000;

  // 完全在视口外很远的惩罚
  if (rect.bottom < 0) score -= 8000;
  if (rect.top > viewportHeight) score -= 8000;

  // 当前在视口内额外奖励
  if (visibleRatio > 0.5) score += 3000;

  // 等待时间奖励（避免饥饿）
  const waitTime = performance.now() - enqueueTime;
  score += Math.min(waitTime / 10, 1000);

  // 重要标签加权
  const importantTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BLOCKQUOTE', 'FIGCAPTION'];
  if (importantTags.includes(block.element.tagName)) score += 500;

  // 顶部主导航（nav/header 内的链接）给予额外优先，让菜单栏优先翻译
  if (block.element.closest('nav, header')) {
    score += 1500;
  }

  // 🔥 所见所得核心：当前严格在视口内的内容给予压倒性优先级
  // 这样用户滚动看到的内容会迅速跳到队列前面被处理
  const vh = window.innerHeight;
  const r = block.element.getBoundingClientRect();
  const strictlyVisible = r.top >= 0 && r.bottom <= vh;
  if (strictlyVisible) {
    score += 20000; // 远超其他预加载内容
  } else if (r.top > -vh * 0.2 && r.bottom < vh * 1.2) {
    // 接近视口也给较强加成
    score += 6000;
  }

  return score;
}

/**
 * 获取一个并发槽位（事件驱动，避免轮询）
 */
async function acquireSlot() {
  if (state.activeTranslations < getMaxConcurrent()) {
    state.activeTranslations++;
    return;
  }
  return new Promise((resolve) => {
    state.queueResolvers.push(resolve);
  });
}

/**
 * 释放并发槽位，唤醒下一个等待者
 */
function releaseSlot() {
  state.activeTranslations = Math.max(0, state.activeTranslations - 1);
  if (state.queueResolvers.length > 0 && state.activeTranslations < getMaxConcurrent()) {
    const resolve = state.queueResolvers.shift();
    state.activeTranslations++;
    resolve();
  }
}

/**
 * 所见所得辅助：如果有空闲槽位，立即取当前最高优先的（通常是刚进入视口的）并发送
 * 返回是否成功泵送
 */
function tryPumpVisibleNow() {
  if (state.activeTranslations >= getMaxConcurrent()) return false;
  state.activeTranslations++;
  const batch = dequeueBatch();
  if (!batch || batch.length === 0) {
    state.activeTranslations = Math.max(0, state.activeTranslations - 1);
    return false;
  }
  // 直接发送，不走主循环等待
  translateBatch(batch);
  return true;
}

/**
 * 重新计算队列中所有任务的优先级并排序
 * 同时取消已远离视口且低价值的 in-flight 请求
 */
function reorderQueue() {
  state.translationQueue.reorder((block, enqueueTime) => computeBlockPriority(block, enqueueTime));

  // 取消已远离视口的进行中的请求（抢占资源给新视口内容）
  // 所见所得：对已远离当前关注区的 in-flight 更积极地取消，让新可见内容更快获得槽位
  const viewportHeight = window.innerHeight;
  const keepMargin = viewportHeight * 0.8;
  for (const [element, { requestId, blocks }] of state.inflightRequests) {
    if (!element || !element.isConnected) {
      chrome.runtime.sendMessage({ action: 'abortRequest', requestId }).catch(() => {});
      state.inflightRequests.delete(element);
      blocks.forEach(b => removePendingMark(b.element));
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom < -keepMargin || rect.top > viewportHeight + keepMargin) {
      chrome.runtime.sendMessage({ action: 'abortRequest', requestId }).catch(() => {});
      state.inflightRequests.delete(element);
      blocks.forEach(b => removePendingMark(b.element));
    }
  }
}

/**
 * 开始翻译 - 流式翻译策略
 * 🚀 核心优化：单条翻译 + 并发控制 + 即时显示
 */
function startTranslation(config) {
  if (state.isActive) {
    console.log('[OpenImmerseTranslate] Already translating');
    return;
  }
  
  state.reset();
  state.config = config;
  state.isActive = true;
  
  const startTime = performance.now();
  sendLog('🚀 开始扫描页面...', 'info');
  
  // 第一步：扫描视口内容并加入队列
  const viewportBlocks = collectViewportBlocks();
  const scanTime = (performance.now() - startTime).toFixed(0);
  
  if (viewportBlocks.length > 0) {
    sendLog(`⚡ 发现 ${viewportBlocks.length} 个文本块 (${scanTime}ms)`, 'success');
    
    // 加入翻译队列
    viewportBlocks.forEach(block => {
      addToQueue(block);
    });
    
    // 所见所得：初始时优先把当前视口内可见的内容用小批次立刻送出
    for (let i = 0; i < 4; i++) {
      if (!tryPumpVisibleNow()) break;
    }
    // 剩余的（预加载）走正常队列
    processQueue();
  } else {
    sendLog(`⚠️ 视口内未发现可翻译文本`, 'warning');
  }
  
  // 第二步：启动滚动监听（实时检测新内容）
  startScrollListener();
  
  // 第三步：启动 DOM 变化监听（支持 Twitter 无限滚动）
  startMutationObserver();
  
  // 第四步：启动 IntersectionObserver 观察预加载内容
  requestIdleCallback(() => {
    if (!state.isActive || state.shouldStop) return;
    scanAndObserveAll();
  }, { timeout: 200 });
  
  // 第五步：启动定期扫描（补漏）
  startPeriodicScan();
}

/**
 * 添加到翻译队列（按优先级插入）
 */
function addToQueue(block) {
  if (!block || !block.element) return false;
  const el = block.element;
  if (state.completedElements.has(el)) return false;
  if (state.translationQueue.some(b => b.element === el)) return false;
  // 防止重复入队正在翻译中的（已出队但尚未完成 apply）
  if (state.translatingElements.has(el)) return false;
  if (el.classList.contains('oit-pending') || el.classList.contains('oit-translating-text')) return false;

  const priority = computeBlockPriority(block);
  const entry = state.translationQueue.enqueue(block, priority);
  if (entry) {
    markAsPending(el);
    return true;
  }
  return false;
}

/**
 * 从队列取出一个批次（空间邻近的块合并翻译）
 * SINGLE_TRANSLATE 或“当前可见”时使用更小的批次，实现所见所得的快速反馈
 */
function dequeueBatch() {
  if (state.translationQueue.length === 0) return null;

  let first = state.translationQueue.dequeue();
  // 跳过已完成的
  while (first && state.completedElements.has(first.element)) {
    removePendingMark(first.element);
    first = state.translationQueue.dequeue();
  }
  if (!first) return null;

  const batch = [first];
  const firstRect = first.element.getBoundingClientRect();
  const firstCenter = firstRect.top + firstRect.height / 2;
  let totalChars = first.text.length;

  // 决定本次批次上限：可见内容或单条模式用小批次，追求低延迟
  const vh = window.innerHeight;
  const headStrictlyVisible = firstRect.top >= -20 && firstRect.bottom <= vh + 20;
  let maxBatch = CONFIG.SINGLE_TRANSLATE ? 1 : CONFIG.BATCH_SIZE;
  if (headStrictlyVisible && !CONFIG.SINGLE_TRANSLATE) {
    maxBatch = 2; // 可见的优先用 1~2 个，快速显示
  }

  while (batch.length < maxBatch && state.translationQueue.length > 0) {
    const next = state.translationQueue.peek();
    if (!next) break;

    if (state.completedElements.has(next.element)) {
      state.translationQueue.dequeue();
      removePendingMark(next.element);
      continue;
    }

    // 空间邻近：与首个块的 Y 中心距离不超过阈值（可见时收紧）
    const nextRect = next.element.getBoundingClientRect();
    const nextCenter = nextRect.top + nextRect.height / 2;
    const distanceLimit = headStrictlyVisible ? Math.min(200, CONFIG.BATCH_MAX_DISTANCE) : CONFIG.BATCH_MAX_DISTANCE;
    if (Math.abs(nextCenter - firstCenter) > distanceLimit) break;

    // 总长度限制
    if (totalChars + next.text.length > CONFIG.BATCH_MAX_CHARS) break;

    batch.push(state.translationQueue.dequeue());
    totalChars += next.text.length;
  }

  return batch;
}

/**
 * 处理翻译队列（优先级 + 事件驱动 + 批处理）
 */
async function processQueue() {
  if (state.isProcessing) {
    console.log('[OIT] processQueue skipped (busy), queue:', state.translationQueue.length);
    return;
  }
  if (!state.isActive || state.shouldStop) return;

  state.isProcessing = true;
  console.log('[OIT] 🚀 processQueue start, queue:', state.translationQueue.length, 'active:', state.activeTranslations);

  try {
    let iteration = 0;
    while (state.translationQueue.length > 0 && state.isActive && !state.shouldStop) {
      iteration++;
      await acquireSlot();
      if (!state.isActive || state.shouldStop) {
        releaseSlot();
        break;
      }

      const batch = dequeueBatch();
      if (!batch || batch.length === 0) {
        releaseSlot();
        continue;
      }

      console.log(`[OIT] 🔄 batch #${iteration}: ${batch.length} blocks, queue left: ${state.translationQueue.length}, active: ${state.activeTranslations}`);
      translateBatch(batch);
    }
    console.log('[OIT] ✅ processQueue done, iterations:', iteration, 'queue left:', state.translationQueue.length, 'active:', state.activeTranslations);
  } finally {
    state.isProcessing = false;
  }
}

/**
 * 批次翻译（异步，不阻塞）
 */
async function translateBatch(blocks) {
  if (!blocks || blocks.length === 0) return;

  const primaryElement = blocks[0].element;

  // 🔥 检查扩展上下文
  if (!isExtensionContextValid()) {
    releaseSlot();
    showContextInvalidatedWarning();
    stopTranslation();
    return;
  }

  // 🔥 立即检查是否应该停止
  if (!state.isActive || state.shouldStop) {
    releaseSlot();
    blocks.forEach(b => removePendingMark(b.element));
    return;
  }

  // 🔥 关键去重
  const alreadyTranslated = blocks.filter(b => isAlreadyTranslated(b.element));
  const pendingBlocks = blocks.filter(b => !isAlreadyTranslated(b.element));
  alreadyTranslated.forEach(b => removePendingMark(b.element));

  if (pendingBlocks.length === 0) {
    releaseSlot();
    return;
  }

  pendingBlocks.forEach(b => markAsTranslating(b.element));

  const requestId = `req_${++state.requestIdCounter}_${Date.now()}`;
  state.inflightRequests.set(primaryElement, { requestId, blocks: pendingBlocks });

  try {
    console.log(`[OIT] 📤 send translate: ${pendingBlocks.length} texts, requestId: ${requestId}`);
    // 🔥 30s timeout: 防止 API 挂起导致所有槽位永久阻塞
    const response = await Promise.race([
      chrome.runtime.sendMessage({
        action: 'translate',
        requestId,
        texts: pendingBlocks.map(b => b.text),
        config: state.config
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Translation request timeout after 30s')), 30000))
    ]);
    console.log(`[OIT] 📥 response: ${response ? (response.cancelled ? 'cancelled' : (response.translations?.length || 0) + ' translations') : 'null'}`);

    state.inflightRequests.delete(primaryElement);

    if (!response) {
      console.warn('[OIT] No response from background (SW may have terminated)');
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    if (response.cancelled) {
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    if (!state.isActive || state.shouldStop) {
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    if (response.error) {
      console.error('[OIT] Translation error:', response.error);
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    const translations = response.translations || [];
    pendingBlocks.forEach((block, index) => {
      const translation = translations[index];
      if (translation && translation !== block.text && !isSameContent(block.text, translation)) {
        applyTranslation(block, translation);
        state.translatedCount++;
        state.completedElements.add(block.element);
      } else {
        // 翻译缺失或与原文相同：清除标记但不标记为完成，允许后续重试
        removePendingMark(block.element);
        // 不加入 completedElements，允许后续重新收集和翻译
      }
    });

    // 更新进度
    if (state.translatedCount > 0 && state.translatedCount % 5 === 0) {
      notifyProgress(state.translatedCount, state.translatedCount);
    }

  } catch (error) {
    state.inflightRequests.delete(primaryElement);

    if (error.message?.includes('Extension context invalidated')) {
      showContextInvalidatedWarning();
      stopTranslation();
      return;
    }
    if (error.message?.toLowerCase().includes('abort')) {
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    // 🔥 超时或其他错误：取消 service worker 侧的请求
    if (requestId) {
      chrome.runtime.sendMessage({ action: 'abortRequest', requestId }).catch(() => {});
    }
    console.error('[OIT] Translation failed:', error);
    pendingBlocks.forEach(b => removePendingMark(b.element));
  } finally {
    releaseSlot();
  }
}

/**
 * 启动滚动监听
 */
function startScrollListener() {
  if (state.scrollHandler) return;
  
  let lastScrollY = window.scrollY;
  
  state.scrollHandler = () => {
    if (!state.isActive || state.shouldStop) return;
    
    const currentScrollY = window.scrollY;
    const scrollDelta = Math.abs(currentScrollY - lastScrollY);
    lastScrollY = currentScrollY;
    
    // 防抖处理
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
    }
    
    // 滚动距离大时立即扫描，小滚动防抖
    const delay = scrollDelta > 200 ? 50 : CONFIG.SCROLL_DEBOUNCE;
    
    state.scrollTimer = setTimeout(() => {
      scanViewportAndQueue();
    }, delay);
  };
  
  window.addEventListener('scroll', state.scrollHandler, { passive: true });
  
  // 同时监听滚动容器（某些 SPA 页面内部滚动）
  document.querySelectorAll('[style*="overflow"]').forEach(container => {
    if (container.scrollHeight > container.clientHeight) {
      container.addEventListener('scroll', state.scrollHandler, { passive: true });
    }
  });
  
  sendLog('👁️ 已启动滚动监听', 'info');
}

/**
 * 扫描视口并加入队列
 */
function scanViewportAndQueue() {
  if (!state.isActive || state.shouldStop) return;

  const newBlocks = collectViewportBlocks();
  let addedCount = 0;

  newBlocks.forEach(block => {
    if (!block || !block.element) return;
    const el = block.element;
    if (state.completedElements.has(el)) return;
    if (state.translationQueue.some(b => b.element === el)) return;
    if (state.translatingElements.has(el)) return;
    if (el.classList.contains('oit-pending') || el.classList.contains('oit-translating-text')) return;

    if (addToQueue(block)) {
      addedCount++;
    }
  });

  // 🔥 每次扫描后重排队列：新进入视口的块可能优先级更高
  reorderQueue();

  if (addedCount > 0) {
    sendLog(`🔄 发现 ${addedCount} 个新文本`, 'info');
    // 所见所得：优先把刚进入视口的高优先内容立即送出去（如果有空位）
    const pumped = tryPumpVisibleNow();
    if (!pumped) {
      processQueue();
    }
  }
}

/**
 * 定期全面扫描（补漏）
 * 🔥 性能优化: 自适应间隔,根据队列状态动态调整扫描频率
 */
function startPeriodicScan() {
  let scanInterval = 2000; // 初始间隔2秒
  let scanTimer = null;

  const adaptiveScan = () => {
    if (!state.isActive || state.shouldStop) {
      if (scanTimer) clearTimeout(scanTimer);
      return;
    }

    // 🔥 健康检查：队列有积压但 pipeline 已停止 → 重启处理
    if (state.translationQueue.length > 0 && !state.isProcessing && state.activeTranslations === 0) {
      console.warn('[OIT] ⚠️ Health check: queue stalled! queue:', state.translationQueue.length, 'Restarting processQueue...');
      processQueue();
    }

    // 🔥 动态调整间隔: 队列越满,扫描越慢
    if (state.translationQueue.length > 50) {
      scanInterval = 8000; // 队列很满,降低到8秒
    } else if (state.translationQueue.length > 20) {
      scanInterval = 5000; // 队列较满,5秒
    } else if (state.translationQueue.length > 10) {
      scanInterval = 3000; // 队列中等,3秒
    } else {
      scanInterval = 2000; // 队列空闲,2秒
    }

    // 只在队列不是很满时才扫描
    if (state.translationQueue.length < 50) {
      scanViewportAndQueue();
    }

    // 递归调用,使用动态间隔
    scanTimer = setTimeout(adaptiveScan, scanInterval);
  };

  // 启动自适应扫描
  scanTimer = setTimeout(adaptiveScan, scanInterval);

  // 保存定时器引用以便停止时清理
  state.periodicScanTimer = scanTimer;
}

/**
 * 扫描全部并用 Observer 观察
 */
function scanAndObserveAll() {
  if (!state.isActive || state.shouldStop) return;
  
  const allBlocks = collectTextBlocks();
  const newBlocks = allBlocks.filter(b => 
    !state.processedTexts.has(b.text) && 
    !state.completedElements.has(b.element)
  );
  
  if (newBlocks.length > 0) {
    sendLog(`📋 后台发现 ${newBlocks.length} 个文本块`, 'info');
    createObserver(newBlocks);
    newBlocks.forEach(block => {
      state.blockMap.set(block.element, block);
      state.observer?.observe(block.element);
    });
  }
}

/**
 * 睡眠函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 启动 MutationObserver 监听动态内容
 * 用于处理 Twitter、Facebook 等 SPA 应用的无限滚动
 */
function startMutationObserver() {
  if (state.mutationObserver) return;
  
  state.mutationObserver = new MutationObserver((mutations) => {
    if (!state.isActive || state.shouldStop) return;
    
    // 检查是否有新增的元素
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && 
              !node.classList?.contains('oit-wrapper') &&
              !node.closest?.('.oit-wrapper') &&
              !node.classList?.contains('oit-pending') &&
              !node.classList?.contains('oit-translating-text')) {
            hasNewContent = true;
            break;
          }
        }
      }
      if (hasNewContent) break;
    }
    
    if (!hasNewContent) return;
    
    // 防抖处理
    if (state.mutationTimer) {
      clearTimeout(state.mutationTimer);
    }
    
    state.mutationTimer = setTimeout(() => {
      scanViewportAndQueue();
    }, CONFIG.MUTATION_DEBOUNCE);
  });
  
  state.mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * 收集视口内可见的文本块（增强版 - 支持各类 SPA）
 * 🔥 关键：只用 completedElements 去重，不用 processedTexts 提前标记
 * 🔥 性能优化: Read-Write分离,批量获取getBoundingClientRect避免layout thrashing
 */
function collectViewportBlocks() {
  const blocks = [];
  const viewportHeight = window.innerHeight;
  const seenInThisScan = new Set(); // 本次扫描内去重

  // 🔥 性能优化: 阶段1 - 批量收集元素 (Read Phase)
  const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
  const primaryElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, figcaption');
  const secondaryElements = document.querySelectorAll('li, td, th, dt, dd, label, button, a');

  // 🔥 阶段2 - 批量读取所有rect (一次性触发layout计算)
  const rectsCache = new Map();
  const allElements = [...tweetTexts, ...primaryElements, ...secondaryElements];

  for (const el of allElements) {
    if (!state.completedElements.has(el) && !el.closest('.oit-wrapper')) {
      rectsCache.set(el, el.getBoundingClientRect());
    }
  }

  // 🔥 阶段3 - 使用缓存的rect进行处理 (No layout thrashing)
  // 第一步：优先处理 Twitter/X 的推文内容
  for (const el of tweetTexts) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    if (state.completedElements.has(el)) continue;
    if (el.closest('.oit-wrapper') || el.classList.contains('oit-pending') || el.classList.contains('oit-translating-text')) continue;

    // 跳过媒体元素
    if (el.closest('picture, source') || ['PICTURE', 'SOURCE', 'IMG'].includes(el.tagName)) continue;

    const rect = rectsCache.get(el);
    if (!rect) continue;

    // 视口检测：当前视口上下各扩展 50%
    if (rect.bottom < -viewportHeight * 0.1 || rect.top > viewportHeight * 0.8) continue;

    const text = el.textContent?.trim();
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (text.length > CONFIG.MAX_TEXT_LENGTH) continue;
    if (seenInThisScan.has(text)) continue;
    if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text)) continue; // 🔥 使用预编译正则
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;

    seenInThisScan.add(text);
    blocks.push({
      element: el,
      textNode: null,
      text,
      isTwitter: true
    });
  }

  // 第二步：处理标题和段落（优先级高）
  collectElementsWithTextOptimized(primaryElements, blocks, viewportHeight, seenInThisScan, rectsCache);

  // 第三步：处理列表项和其他容器
  collectElementsWithTextOptimized(secondaryElements, blocks, viewportHeight, seenInThisScan, rectsCache);

  // 第四步：处理 span 和 div（只取叶子节点）
  collectLeafTextElements(blocks, viewportHeight, seenInThisScan);

  // 🔥 按Y坐标排序 - 使用缓存的rect
  blocks.sort((a, b) => {
    const aRect = rectsCache.get(a.element) || a.element.getBoundingClientRect();
    const bRect = rectsCache.get(b.element) || b.element.getBoundingClientRect();
    return aRect.top - bRect.top;
  });

  console.log(`[OIT] Viewport scan: found ${blocks.length} blocks`);
  return blocks;
}

/**
 * 🔥 性能优化版: 收集指定元素的文本 (使用预缓存的rect)
 */
function collectElementsWithTextOptimized(elements, blocks, viewportHeight, seenInThisScan, rectsCache) {
  const collectedElements = new WeakSet();

  for (const el of elements) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;

    const rect = rectsCache.get(el);
    if (!rect) continue;

    // 🔥 只检测当前视口附近（上下各50%）
    if (rect.bottom < -viewportHeight * 0.1 || rect.top > viewportHeight * 0.8) continue;
    if (rect.width === 0 || rect.height === 0) continue;

    if (el.closest('.oit-wrapper') || el.classList.contains('oit-pending') || el.classList.contains('oit-translating-text')) continue;
    if (el.closest('.oit-translation')) continue;
    if (state.completedElements.has(el)) continue;

    // 跳过图片/媒体相关元素及其内部（避免把 srcset、source 标签等内容当作可翻译文本）
    if (el.closest('picture, source') || ['PICTURE', 'SOURCE', 'IMG'].includes(el.tagName)) continue;

    // 🔥 检查是否是已收集元素的子元素
    if (isChildOfCollected(el, collectedElements)) continue;

    // 获取元素的完整文本内容（包括嵌套）
    const text = el.textContent?.trim();
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (text.length > CONFIG.MAX_TEXT_LENGTH) continue;
    if (seenInThisScan && seenInThisScan.has(text)) continue;
    if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text)) continue; // 🔥 使用预编译正则
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;

    // 防御：跳过看起来像 HTML 属性或图片 URL 的伪文本（防止源码泄漏到页面）
    if (/srcset|data-src|<\w+\s|https?:\/\/.*\.(jpe?g|png|webp|gif)/i.test(text)) continue;

    // 次要元素短文本过滤：只跳过极短的非核心内容（按钮/链接等）。
    // 放宽到 <5 以便顶部菜单栏的 "Mac"、"Store"、"Support" 等能被翻译。
    const isPrimaryTagHere = /^(H[1-6]|P|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName);
    if (!isPrimaryTagHere && text.length < 5) continue;

    // 🔥 过滤页面壳层（nav/header/footer 等）内的短文本，避免把大量 UI 标签塞进队列
    const boilerplateThreshold = isPrimaryTagHere ? 12 : 25;
    if (isInBoilerplateContainer(el) && text.length < boilerplateThreshold) continue;

    // 检查是否有直接文本内容（不是纯容器）
    const directText = getDirectTextContent(el);
    const hasDirectText = directText && directText.length >= CONFIG.MIN_TEXT_LENGTH;

    // 如果没有直接文本但有嵌套文本，使用整体追加模式
    const useAppendMode = !hasDirectText && text.length >= CONFIG.MIN_TEXT_LENGTH;

    if (hasDirectText) {
      const textNode = findTextNode(el, directText);
      if (textNode) {
        if (seenInThisScan) seenInThisScan.add(text);
        if (seenInThisScan) seenInThisScan.add(directText);
        collectedElements.add(el);
        blocks.push({ element: el, textNode, text: directText });
      }
    } else if (useAppendMode) {
      if (seenInThisScan) seenInThisScan.add(text);
      collectedElements.add(el);
      blocks.push({ element: el, textNode: null, text, isAppend: true });
    }
  }
}

/**
 * 收集指定选择器的文本元素 (旧版本,保留用于后备)
 * 🔥 增强去重：记录已收集元素，防止父子元素重复
 */
function collectElementsWithText(selectors, blocks, viewportHeight, seenInThisScan) {
  const elements = document.querySelectorAll(selectors);
  // 记录本次已收集的元素（用于检查父子关系）
  const collectedElements = new WeakSet();
  
  for (const el of elements) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    
    const rect = el.getBoundingClientRect();
    // 🔥 只检测当前视口附近（上下各50%），不要太远
    if (rect.bottom < -viewportHeight * 0.1 || rect.top > viewportHeight * 0.8) continue;
    if (rect.width === 0 || rect.height === 0) continue;
    
    if (el.closest('.oit-wrapper') || el.classList.contains('oit-pending') || el.classList.contains('oit-translating-text')) continue;
    if (el.closest('.oit-translation')) continue;
    if (state.completedElements.has(el)) continue;

    // 跳过图片/媒体相关元素及其内部
    if (el.closest('picture, source') || ['PICTURE', 'SOURCE', 'IMG'].includes(el.tagName)) continue;
    
    // 🔥 检查是否是已收集元素的子元素
    if (isChildOfCollected(el, collectedElements)) continue;
    
    // 获取元素的完整文本内容（包括嵌套）
    const text = el.textContent?.trim();
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (text.length > CONFIG.MAX_TEXT_LENGTH) continue;
    // 🔥 只用本次扫描的 Set 去重，不用 processedTexts（那个只在翻译完成后才标记）
    if (seenInThisScan && seenInThisScan.has(text)) continue;
    if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text)) continue; // 🔥 使用预编译正则
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;

    // 次要元素短文本过滤（已放宽到 <5，支持菜单短标签翻译）
    const isPrimaryTag = /^(H[1-6]|P|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName);
    if (!isPrimaryTag && text.length < 5) continue;

    // 壳层短文本过滤
    const boilerplateThreshold = isPrimaryTag ? 12 : 25;
    if (isInBoilerplateContainer(el) && text.length < boilerplateThreshold) continue;
    
    // 检查是否有直接文本内容（不是纯容器）
    const directText = getDirectTextContent(el);
    const hasDirectText = directText && directText.length >= CONFIG.MIN_TEXT_LENGTH;
    
    // 如果没有直接文本但有嵌套文本，使用整体追加模式
    const useAppendMode = !hasDirectText && text.length >= CONFIG.MIN_TEXT_LENGTH;
    
    if (hasDirectText) {
      const textNode = findTextNode(el, directText);
      if (textNode) {
        if (seenInThisScan) seenInThisScan.add(text);
        if (seenInThisScan) seenInThisScan.add(directText); // 同时添加直接文本
        collectedElements.add(el);
        blocks.push({ element: el, textNode, text: directText });
      }
    } else if (useAppendMode) {
      if (seenInThisScan) seenInThisScan.add(text);
      collectedElements.add(el);
      blocks.push({ element: el, textNode: null, text, isAppend: true });
    }
  }
}

/**
 * 判断元素是否位于页面“壳”容器内（导航、页眉、页脚、侧边栏等）
 * 这类区域的短文本通常是 UI 标签，翻译价值低，容易塞满队列导致高价值内容被迁出
 */
function isInBoilerplateContainer(el) {
  if (!el) return false;
  // 只将 footer、aside、complementary 等“辅助/页脚”区域视为低价值壳层。
  // 顶部 nav / header 中的菜单标签是用户可见的重要内容，应该翻译。
  return !!el.closest('footer, aside, [role="contentinfo"], [role="complementary"]');
}

/**
 * 检查元素是否是已收集元素的子元素
 */
function isChildOfCollected(element, collectedElements) {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (collectedElements.has(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/**
 * 收集叶子文本节点（span/div 中没有更深子元素的）
 * 🔥 增强去重：检查父元素是否已被收集
 */
function collectLeafTextElements(blocks, viewportHeight, seenInThisScan) {
  // 🔥 收集当前 blocks 中的所有元素，用于检查父子关系
  const existingElements = new WeakSet();
  for (const block of blocks) {
    existingElements.add(block.element);
  }
  
  // 使用 TreeWalker 高效遍历文本节点
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent?.trim();
        if (!text || text.length < CONFIG.MIN_TEXT_LENGTH || text.length > CONFIG.MAX_TEXT_LENGTH) {
          return NodeFilter.FILTER_REJECT;
        }
        
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // 跳过已处理
        if (parent.closest('.oit-wrapper') || parent.classList.contains('oit-pending') || parent.classList.contains('oit-translating-text')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (state.completedElements.has(parent)) return NodeFilter.FILTER_REJECT;
        
        // 🔥 检查父元素链是否已在本次扫描中被收集
        let ancestor = parent;
        while (ancestor && ancestor !== document.body) {
          if (existingElements.has(ancestor)) {
            return NodeFilter.FILTER_REJECT; // 父元素已被收集，跳过
          }
          ancestor = ancestor.parentElement;
        }
        
        // 跳过不需要的标签
        if (CONFIG.SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

        // 额外跳过图片媒体子树
        if (parent.closest('picture, source') || ['PICTURE', 'SOURCE', 'IMG'].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 🔥 只检测当前视口附近（上下各50%）
        const rect = parent.getBoundingClientRect();
        if (rect.bottom < -viewportHeight * 0.1 || rect.top > viewportHeight * 0.8) {
          return NodeFilter.FILTER_REJECT;
        }
        if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
        
        // 跳过纯符号
        if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text)) return NodeFilter.FILTER_REJECT; // 🔥 使用预编译正则

        // 防御：跳过像图片源码/属性串的文本
        if (/srcset|data-src|<\w+\s|https?:\/\/.*\.(jpe?g|png|webp|gif)/i.test(text)) return NodeFilter.FILTER_REJECT;

        // 🔥 过滤壳层容器内的短文本（nav / footer 等产生的大量小标签）
        if (isInBoilerplateContainer(parent) && text.length < 25) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let node;
  while ((node = walker.nextNode()) && blocks.length < CONFIG.MAX_VIEWPORT_SCAN) {
    const text = node.textContent.trim();
    const parent = node.parentElement;
    
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;
    // 🔥 只用本次扫描 Set 去重
    if (seenInThisScan && seenInThisScan.has(text)) continue;

    if (parent.classList.contains('oit-pending') || parent.classList.contains('oit-translating-text')) continue;

    // 防御：跳过源码/属性串
    if (/srcset|data-src|<\w+\s|https?:\/\/.*\.(jpe?g|png|webp|gif)/i.test(text)) continue;

    // 防御性过滤：媒体/图片相关
    if (parent.closest('picture, source') || ['PICTURE', 'SOURCE', 'IMG'].includes(parent.tagName)) continue;

    // 防御性过滤：壳层短文本
    if (isInBoilerplateContainer(parent) && text.length < 25) continue;
    
    // 🔥 再次检查父元素是否已被收集（动态更新的 blocks）
    let shouldSkip = false;
    for (const block of blocks) {
      if (parent === block.element || parent.contains(block.element) || block.element.contains(parent)) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    
    if (seenInThisScan) seenInThisScan.add(text);
    blocks.push({ element: parent, textNode: node, text });
  }
}

// 🔥 性能优化: 使用WeakMap缓存翻译检查结果
const translatedCheckCache = new WeakMap();
let cacheHits = 0;
let cacheMisses = 0;

/**
 * 🔥 检查元素是否已被翻译（防止重复翻译）
 * 🔥 性能优化: 使用WeakMap缓存结果,避免重复检查
 * 检查：1. 元素本身 2. 父元素 3. 子元素
 */
function isAlreadyTranslated(element) {
  if (!element) return true;

  // 🔥 快速缓存检查 - 大幅减少DOM操作
  if (translatedCheckCache.has(element)) {
    cacheHits++;
    return translatedCheckCache.get(element);
  }

  cacheMisses++;

  // 🔥 最快的检查放前面 - 短路优化
  // 1. 检查 completedElements (O(1) 操作)
  if (state.completedElements.has(element)) {
    translatedCheckCache.set(element, true);
    return true;
  }

  // 2. 组合DOM检查 - 减少函数调用
  const hasWrapper = element.classList?.contains('oit-wrapper') ||
                     element.closest?.('.oit-wrapper') !== null ||
                     element.querySelector?.('.oit-translation') !== null;

  if (hasWrapper) {
    translatedCheckCache.set(element, true);
    return true;
  }

  // 3. 检查父元素链 (最慢的操作,放最后)
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (state.completedElements.has(parent) ||
        parent.classList?.contains('oit-wrapper')) {
      translatedCheckCache.set(element, true);
      return true;
    }
    parent = parent.parentElement;
  }

  // 缓存负面结果
  translatedCheckCache.set(element, false);
  return false;
}

/**
 * 标记元素为待翻译状态
 */
function markAsPending(element) {
  if (!element || element.classList.contains('oit-pending')) return;

  element.classList.add('oit-pending');

  // 🔥 性能优化: 记录待翻译元素,避免后续全局查询
  state.pendingElements.add(element);

  // 检测深色背景
  if (isDarkBackground(element) || isDarkMode()) {
    element.classList.add('oit-pending-dark');
  }
}

/**
 * 移除待翻译标记
 */
function removePendingMark(element) {
  if (!element) return;
  element.classList.remove('oit-pending', 'oit-pending-dark', 'oit-translating-text');

  // 🔥 性能优化: 从待翻译集合中移除
  state.pendingElements.delete(element);
  state.translatingElements.delete(element);
}

/**
 * 标记元素为翻译中状态
 */
function markAsTranslating(element) {
  if (!element) return;
  element.classList.remove('oit-pending', 'oit-pending-dark');
  element.classList.add('oit-translating-text');

  // 🔥 性能优化: 从待翻译移到翻译中集合
  state.pendingElements.delete(element);
  state.translatingElements.add(element);
}

/**
 * 检测是否深色模式
 */
function isDarkMode() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ||
         document.documentElement.classList.contains('dark') ||
         document.body.style.backgroundColor?.includes('rgb(0') ||
         document.body.style.backgroundColor?.includes('#0');
}

/**
 * 查找元素内第一个有效的文本节点
 */
function findFirstTextNode(element) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent.trim();
        if (text.length >= CONFIG.MIN_TEXT_LENGTH && 
            !node.parentElement?.closest('.oit-wrapper')) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );
  return walker.nextNode();
}

/**
 * 停止翻译
 */
function stopTranslation() {
  state.shouldStop = true;
  state.isActive = false;

  // 🔥 取消所有进行中的请求
  cancelAllInflightRequests('user stopped');

  // 🔥 立即清空翻译队列，防止继续处理旧任务
  state.translationQueue.clear();
  state.isProcessing = false;

  // 🔥 唤醒所有等待槽位的 Promise，避免死锁
  while (state.queueResolvers.length > 0) {
    state.queueResolvers.shift()();
  }

  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }

  if (state.mutationObserver) {
    state.mutationObserver.disconnect();
    state.mutationObserver = null;
  }

  if (state.scrollHandler) {
    window.removeEventListener('scroll', state.scrollHandler);
    state.scrollHandler = null;
  }

  // 🔥 性能优化: 使用维护的Set集合而非全局querySelectorAll
  // 移除所有待翻译和翻译中的标记
  state.pendingElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove('oit-pending', 'oit-pending-dark');
    }
  });
  state.translatingElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove('oit-translating-text');
    }
  });

  // 调用reset清理状态
  state.reset();
  console.log('[OpenImmerseTranslate] Translation stopped, queue cleared');
}

/**
 * 取消所有进行中的翻译请求
 */
function cancelAllInflightRequests(reason = 'cancelled') {
  for (const [element, { requestId }] of state.inflightRequests) {
    chrome.runtime.sendMessage({ action: 'abortRequest', requestId }).catch(() => {});
  }
  state.inflightRequests.clear();
}

/**
 * 收集页面中所有可翻译的文本块（优化版）
 * 使用更高效的DOM遍历策略
 */
function collectTextBlocks() {
  const blocks = [];
  const processedNodes = new WeakSet();
  
  // 使用已有的 processedTexts 避免重复
  const processedTexts = state.processedTexts;
  
  // 单次高效遍历
  collectTextNodes(document.body, blocks, processedNodes, processedTexts);
  
  // Shadow DOM 仅在必要时扫描
  if (document.querySelectorAll('*').length < 5000) {
    collectShadowDOMTexts(document.body, blocks, processedNodes, processedTexts);
  }
  
  return blocks;
}

/**
 * 遍历文本节点
 */
function collectTextNodes(root, blocks, processedNodes, processedTexts) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // 跳过已处理的节点
        if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
        
        // 跳过不可见元素
        if (!isElementVisible(parent)) return NodeFilter.FILTER_REJECT;
        
        // 跳过特定标签
        if (CONFIG.SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        
        // 跳过特定类名
        if (CONFIG.SKIP_CLASSES.some(cls => parent.classList.contains(cls))) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 跳过已翻译
        if (parent.closest('.oit-wrapper')) return NodeFilter.FILTER_REJECT;
        
        // 检查文本
        const text = node.textContent.trim();
        if (text.length < CONFIG.MIN_TEXT_LENGTH || text.length > CONFIG.MAX_TEXT_LENGTH) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 跳过纯数字/标点/空白
        if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text)) return NodeFilter.FILTER_REJECT; // 🔥 使用预编译正则

        // 跳过纯URL或邮箱
        if (REGEX_PATTERNS.URL_EMAIL.test(text)) return NodeFilter.FILTER_REJECT; // 🔥 使用预编译正则
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.textContent.trim();
    
    // 跳过重复文本
    if (processedTexts.has(text)) continue;
    
    // 检查是否已是目标语言
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;
    
    processedNodes.add(node);
    processedTexts.add(text);
    
    blocks.push({
      element: parent,
      textNode: node,
      text: text
    });
  }
}

/**
 * 扫描元素的直接文本内容（处理某些特殊情况）
 */
function collectElementTexts(root, blocks, processedNodes, processedTexts) {
  // 扫描可能被遗漏的元素
  const selectors = [
    // 常见文本容器
    'p', 'span', 'div', 'a', 'li', 'td', 'th', 'label',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // 特殊元素
    '[data-text]', '[aria-label]', '[title]',
    // 按钮和链接
    'button', 'a[href]',
    // 列表项
    'dt', 'dd',
    // 引用
    'blockquote', 'q', 'cite'
  ].join(',');
  
  const elements = root.querySelectorAll(selectors);
  
  elements.forEach(el => {
    if (processedNodes.has(el)) return;
    if (!isElementVisible(el)) return;
    if (CONFIG.SKIP_TAGS.has(el.tagName)) return;
    if (CONFIG.SKIP_CLASSES.some(cls => el.classList.contains(cls))) return;
    if (el.closest('.oit-wrapper')) return;
    
    // 获取元素的直接文本内容（排除子元素的文本）
    const directText = getDirectTextContent(el);
    if (!directText || directText.length < CONFIG.MIN_TEXT_LENGTH) return;
    if (processedTexts.has(directText)) return;
    
    // 跳过纯数字/标点
    if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(directText)) return; // 🔥 使用预编译正则
    
    // 检查是否已是目标语言
    if (state.config?.autoDetect && isTargetLanguage(directText)) return;
    
    // 找到对应的文本节点
    const textNode = findTextNode(el, directText);
    if (textNode && !processedNodes.has(textNode)) {
      processedNodes.add(textNode);
      processedTexts.add(directText);
      
      blocks.push({
        element: el,
        textNode: textNode,
        text: directText
      });
    }
  });
  
  // 额外处理带有 title 和 aria-label 属性的元素（这些通常是悬浮提示）
  // 这里我们跳过，因为修改这些属性会比较复杂
}

/**
 * 扫描 Shadow DOM
 */
function collectShadowDOMTexts(root, blocks, processedNodes, processedTexts) {
  const elements = root.querySelectorAll('*');
  
  elements.forEach(el => {
    if (el.shadowRoot) {
      collectTextNodes(el.shadowRoot, blocks, processedNodes, processedTexts);
      collectElementTexts(el.shadowRoot, blocks, processedNodes, processedTexts);
    }
  });
}

/**
 * 获取元素的直接文本内容（不包含子元素）
 */
function getDirectTextContent(element) {
  let text = '';
  
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    }
  }
  
  return text.trim();
}

/**
 * 在元素中找到包含指定文本的文本节点
 */
function findTextNode(element, targetText) {
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent.trim() === targetText || 
          child.textContent.includes(targetText.substring(0, 20))) {
        return child;
      }
    }
  }
  return null;
}

/**
 * 创建 Intersection Observer
 * 当元素进入视口时触发翻译
 */
function createObserver(textBlocks) {
  if (state.observer) {
    state.observer.disconnect();
  }
  
  // 创建元素到文本块的映射
  textBlocks.forEach(block => {
    state.blockMap.set(block.element, block);
  });
  
  state.observer = new IntersectionObserver((entries) => {
    if (!state.isActive || state.shouldStop) return;
    
    let addedCount = 0;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const block = state.blockMap.get(entry.target);
        if (block && !state.completedElements.has(block.element)) {
          if (addToQueue(block)) {
            addedCount++;
          }
          // 停止观察已加入队列的元素
          state.observer?.unobserve(entry.target);
        }
      }
    });
    
    // 如果有新内容加入队列，重排并触发处理
    // 所见所得：新进入视口的优先立即泵送
    if (addedCount > 0) {
      reorderQueue();
      if (!tryPumpVisibleNow()) {
        processQueue();
      }
    }
  }, {
    rootMargin: CONFIG.ROOT_MARGIN,
    threshold: CONFIG.THRESHOLD
  });
}

/**
 * 将文本块加入翻译队列（极速版）
 */
/**
 * 解析友好的错误信息
 * Delegates to shared/providers.js parseTranslationError()
 */
function parseFriendlyError(errorMsg) {
  const result = parseTranslationError(errorMsg || '');
  // Map key to emoji-prefixed Chinese message (content script has no i18n)
  const EMOJI_MAP = {
    errorApiKeyInvalid: '🔑 API密钥无效，请检查设置',
    errorApiKeyMissing: '🔑 请先配置 API 密钥',
    errorRateLimit: '⏳ API请求过于频繁，正在自动重试...',
    errorQuotaExceeded: '📊 API配额已用尽，请检查账户额度',
    errorInsufficientBalance: '⚠️ 账户余额不足或已暂停，请充值后重试',
    errorNetworkFailed: '🌐 网络连接失败，请检查网络',
    errorTimeout: '⏱️ 请求超时，网络可能不稳定',
    errorServerError: '🔧 AI服务暂时不可用，请稍后重试',
    errorModelNotFound: '🤖 模型不存在，请检查模型名称',
    errorPermissionDenied: '🚫 没有权限访问此API',
    errorUnknown: '❓ 未知错误'
  };
  return EMOJI_MAP[result.key] || result.message;
}

/**
 * 应用翻译到 DOM
 */
function applyTranslation(block, translation) {
  const { element, textNode, text, isTwitter, isAppend } = block;
  
  // 移除待翻译标记
  removePendingMark(element);
  
  // 🔥 关键去重检查（防止重复翻译）
  if (isAlreadyTranslated(element)) {
    console.log('[OIT] Skipping duplicate translation for:', text?.substring(0, 30));
    return;
  }
  
  // 追加模式：在元素后追加翻译（Twitter/嵌套文本等）
  if (isTwitter || isAppend || !textNode) {
    // 检查是否已经翻译过（更严格的检查）
    if (element.querySelector(':scope > .oit-translation')) return;
    if (element.querySelector('.oit-translation')) return; // 检查任意后代
    
    // 根据父元素决定使用块级还是行内翻译元素，避免破坏布局
    const isBlockContainer = /^(DIV|SECTION|ARTICLE|P|UL|OL|LI|BLOCKQUOTE|FIGCAPTION|HEADER|FOOTER|MAIN|ASIDE)$/.test(element.tagName);
    const translationEl = document.createElement(isBlockContainer ? 'div' : 'span');
    translationEl.className = 'oit-translation';
    
    // 检测深色背景并设置颜色
    const isDark = isDarkBackground(element) || isDarkMode();
    if (isDark) {
      translationEl.style.color = '#9ca3af';
    } else {
      translationEl.style.color = '#666666';
    }
    
    translationEl.textContent = translation;
    if (isBlockContainer) {
      translationEl.style.marginTop = '4px';
      translationEl.style.display = 'block';
    } else {
      translationEl.style.marginLeft = '4px';
    }
    translationEl.style.fontSize = '0.92em';
    translationEl.style.lineHeight = '1.4';
    
    element.appendChild(translationEl);
    element.classList.add('oit-wrapper');
    return;
  }
  
  // 常规文本节点替换处理
  const parent = textNode.parentElement;
  if (!parent) return;
  
  // 检查父元素是否已有翻译
  if (parent.classList.contains('oit-wrapper') || parent.querySelector('.oit-translation')) {
    return;
  }
  
  const wrapper = document.createElement('span');
  wrapper.className = 'oit-wrapper';
  
  // 检测深色背景
  if (isDarkBackground(parent) || isDarkMode()) {
    wrapper.classList.add('oit-dark');
  }
  
  if (state.config.showOriginal) {
    wrapper.innerHTML = `<span class="oit-original">${escapeHtml(text)}</span><span class="oit-translation">${escapeHtml(translation)}</span>`;
  } else {
    wrapper.innerHTML = `<span class="oit-translation oit-only">${escapeHtml(translation)}</span>`;
  }
  
  try {
    textNode.parentNode.replaceChild(wrapper, textNode);
  } catch (e) {
    // 如果替换失败，使用追加模式
    console.warn('[OIT] Replace failed, using append mode');
    const translationEl = document.createElement('span');
    translationEl.className = 'oit-translation';
    translationEl.textContent = ` ${translation}`;
    translationEl.style.color = '#666666';
    parent.appendChild(translationEl);
    parent.classList.add('oit-wrapper');
  }
}

// ==================== 工具函数 ====================

/**
 * 检查元素是否可见
 */
function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 检查是否已是目标语言
 * 🔥 性能优化: 使用预编译正则表达式
 */
function isTargetLanguage(text) {
  const targetLang = state.config?.targetLang || 'zh-CN';
  const textWithoutSpace = text.replace(REGEX_PATTERNS.WHITESPACE, ''); // 🔥 使用预编译正则

  if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
    const matches = text.match(REGEX_PATTERNS.CHINESE); // 🔥 使用预编译正则
    const ratio = (matches || []).length / textWithoutSpace.length;
    return ratio > 0.5;
  }
  if (targetLang === 'ja') {
    const matches = text.match(REGEX_PATTERNS.JAPANESE); // 🔥 使用预编译正则
    const ratio = (matches || []).length / textWithoutSpace.length;
    return ratio > 0.3;
  }
  if (targetLang === 'ko') {
    const matches = text.match(REGEX_PATTERNS.KOREAN); // 🔥 使用预编译正则
    const ratio = (matches || []).length / textWithoutSpace.length;
    return ratio > 0.3;
  }

  return false;
}

/**
 * 检查内容是否相同
 * 🔥 性能优化: 使用预编译正则表达式
 */
function isSameContent(original, translation) {
  return original.replace(REGEX_PATTERNS.WHITESPACE, ' ').trim().toLowerCase() ===
         translation.replace(REGEX_PATTERNS.WHITESPACE, ' ').trim().toLowerCase();
}

/**
 * 检查是否深色背景
 */
function isDarkBackground(element) {
  const bgColor = window.getComputedStyle(element).backgroundColor;
  if (!bgColor || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
    return false;
  }
  const rgb = bgColor.match(/\d+/g);
  if (rgb && rgb.length >= 3) {
    const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
    return brightness < 128;
  }
  return false;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 移除所有翻译
 */
function removeAllTranslations() {
  stopTranslation();

  // 🔥 性能优化: 使用维护的Set集合而非全局querySelectorAll
  // 移除所有待翻译和翻译中的标记
  state.pendingElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove('oit-pending', 'oit-pending-dark');
    }
  });
  state.translatingElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove('oit-translating-text');
    }
  });
  
  // 处理 Twitter 等追加翻译的情况
  document.querySelectorAll('.oit-wrapper').forEach(wrapper => {
    // 如果是 Twitter 类型（翻译追加在后面）
    const appendedTranslation = wrapper.querySelector(':scope > .oit-translation:last-child');
    if (appendedTranslation && !wrapper.querySelector('.oit-original')) {
      appendedTranslation.remove();
      wrapper.classList.remove('oit-wrapper', 'oit-dark');
      return;
    }
    
    // 常规包装器处理
    const original = wrapper.querySelector('.oit-original');
    if (original) {
      const textNode = document.createTextNode(original.textContent);
      wrapper.parentNode?.replaceChild(textNode, wrapper);
    } else {
      // 仅翻译模式或其他情况
      wrapper.remove();
    }
  });
  
  console.log('[OpenImmerseTranslate] Translations removed');
}

// ==================== 通知函数 ====================

function notifyComplete() {
  const hasTranslations = document.querySelectorAll('.oit-wrapper').length > 0;
  state.isActive = false;
  
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('completed');
  }
  
  // 安全发送消息
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      action: 'translationComplete',
      count: state.translatedCount,
      hasTranslations: hasTranslations
    }).catch(() => {});
  }
}

function notifyError(error) {
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('error');
  }
  
  // 安全发送消息
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      action: 'translationError',
      error: error
    }).catch(() => {});
  }
}

function notifyProgress(current, total) {
  // 安全发送消息
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      action: 'translationProgress',
      current: current,
      total: total
    }).catch(() => {});
  }
}

// ==================== 选中文本翻译 ====================

let floatingBtn = null;
let floatingPanel = null;
let mouseupHandler = null; // 🔥 性能优化: 保存事件处理器引用用于清理

// 🔥 性能优化: 使用命名函数便于清理
mouseupHandler = (e) => {
  // 🔥 关键修复：如果点击的是悬浮按钮或面板，不处理
  const target = e.target;
  
  // 检查是否点击了按钮（包括按钮内的 SVG 元素）
  if (floatingBtn) {
    if (floatingBtn === target || floatingBtn.contains(target)) {
      return; // 点击按钮本身，不处理
    }
  }
  
  // 检查是否点击了面板
  if (floatingPanel) {
    if (floatingPanel === target || floatingPanel.contains(target)) {
      return; // 点击面板，不处理
    }
  }

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText.length < CONFIG.MIN_TEXT_LENGTH) {
    hideFloating();
    return;
  }

  showFloatingButton(e.clientX, e.clientY, selectedText);
};

document.addEventListener('mouseup', mouseupHandler);

function showFloatingButton(x, y, text) {
  hideFloating();

  // 计算按钮位置，确保完全在视口内
  const btnWidth = 36;
  const btnHeight = 36;
  const padding = 10;

  let btnX = x + 10;
  let btnY = y - 40;

  // 边界检查 - 确保按钮不会超出屏幕
  if (btnX + btnWidth > window.innerWidth) {
    btnX = x - btnWidth - 10;
  }
  if (btnY < padding) {
    btnY = y + 10;
  }
  if (btnY + btnHeight > window.innerHeight) {
    btnY = window.innerHeight - btnHeight - padding;
  }

  floatingBtn = document.createElement('button');
  floatingBtn.className = 'oit-floating-btn';
  floatingBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/></svg>`;
  floatingBtn.style.cssText = `position:fixed;left:${btnX}px;top:${btnY}px;z-index:2147483647;pointer-events:auto;`;

  // 保存位置和文本信息，用于后续面板定位
  floatingBtn.dataset.posX = btnX;
  floatingBtn.dataset.posY = btnY;
  floatingBtn.dataset.text = text;

  document.body.appendChild(floatingBtn);

  // 🔥 关键修复：在按钮上处理所有鼠标事件，彻底阻止事件传播
  // 1. mouseup 事件 - 必须阻止，否则会触发 mouseupHandler 重新创建按钮
  floatingBtn.addEventListener('mouseup', (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true); // 捕获阶段，优先处理

  // 2. mousedown 事件 - 阻止 hideOnClickOutside
  floatingBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true); // 捕获阶段，优先处理

  // 3. click 事件 - 处理实际点击
  floatingBtn.addEventListener('click', async (e) => {
    // 阻止所有事件传播
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();

    // 保存信息（在移除按钮之前）
    const btn = floatingBtn;
    const posX = parseInt(btn.dataset.posX);
    const posY = parseInt(btn.dataset.posY);
    const selectedText = btn.dataset.text || text;

    // 立即移除按钮（在显示面板之前）
    if (btn && btn.parentNode) {
      btn.remove();
    }
    floatingBtn = null;

    // 移除外部点击监听器
    document.removeEventListener('mousedown', hideOnClickOutside, true);

    // 显示翻译面板
    await showTranslationPanel(selectedText, posX, posY);
  }, true); // 捕获阶段，优先处理

  // 延迟添加外部点击监听，避免立即触发
  setTimeout(() => {
    if (floatingBtn) {
      document.addEventListener('mousedown', hideOnClickOutside, true);
    }
  }, 100);
}

function hideOnClickOutside(e) {
  // 🔥 专业方案：严格检查点击目标
  if (!floatingBtn) return;
  
  const target = e.target;
  
  // 检查点击是否在按钮内部（包括 SVG 元素）
  if (floatingBtn === target || floatingBtn.contains(target)) {
    return; // 点击在按钮上，不隐藏
  }
  
  // 检查点击是否在面板内部
  if (floatingPanel && (floatingPanel === target || floatingPanel.contains(target))) {
    return; // 点击在面板上，不隐藏
  }
  
  // 点击在外部，隐藏按钮和面板
  hideFloating();
}

function hideFloating() {
  if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
  if (floatingPanel) { floatingPanel.remove(); floatingPanel = null; }
  // 🔥 移除事件监听器时也要指定 capture 参数，与添加时保持一致
  document.removeEventListener('mousedown', hideOnClickOutside, true);
}

/**
 * 显示翻译面板（不清理按钮，因为按钮已经被移除）
 */
async function showTranslationPanel(text, x, y) {
  // 🔥 检查扩展上下文
  if (!isExtensionContextValid()) {
    showContextInvalidatedWarning();
    return;
  }

  // 清理可能存在的旧面板
  if (floatingPanel) {
    floatingPanel.remove();
    floatingPanel = null;
  }

  // 计算面板位置，确保完全在视口内
  const panelWidth = 400;
  const panelMinHeight = 180;
  const padding = 20;

  let panelX = x + 46; // 按钮右侧
  let panelY = y;

  // 边界检查 - 水平方向
  if (panelX + panelWidth > window.innerWidth - padding) {
    panelX = x - panelWidth - 10; // 按钮左侧
    if (panelX < padding) {
      panelX = padding; // 贴左边
    }
  }

  // 边界检查 - 垂直方向
  if (panelY + panelMinHeight > window.innerHeight - padding) {
    panelY = window.innerHeight - panelMinHeight - padding;
  }
  if (panelY < padding) {
    panelY = padding;
  }

  floatingPanel = document.createElement('div');
  floatingPanel.className = 'oit-floating-panel';
  floatingPanel.innerHTML = `<div class="oit-panel-loading"><div class="oit-spinner"></div><span>翻译中...</span></div>`;
  floatingPanel.style.cssText = `position:fixed;left:${panelX}px;top:${panelY}px;z-index:2147483647;`;

  document.body.appendChild(floatingPanel);

  try {
    // 🔥 使用新配置系统
    const config = await loadFullConfig();

    // 检查是否需要 API Key
    const needsApiKey = checkNeedsApiKey(config.provider);
    if (needsApiKey && !config.apiKey) {
      floatingPanel.innerHTML = `<div class="oit-panel-error">请先在插件设置中配置 API 密钥</div>`;
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      texts: [text],
      config: config
    });

    if (response.error) throw new Error(response.error);

    const translation = response.translations[0];

    floatingPanel.innerHTML = `
      <div class="oit-panel-content">
        <div class="oit-panel-header">
          <span class="oit-panel-title">翻译结果</span>
          <button class="oit-close-btn" title="关闭">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="oit-panel-body">
          <div class="oit-panel-section">
            <div class="oit-panel-label">原文</div>
            <div class="oit-panel-original">${escapeHtml(text)}</div>
          </div>
          <div class="oit-panel-divider"></div>
          <div class="oit-panel-section">
            <div class="oit-panel-label">译文</div>
            <div class="oit-panel-translation">${escapeHtml(translation)}</div>
          </div>
        </div>
        <div class="oit-panel-footer">
          <button class="oit-copy-btn" title="复制译文">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/>
            </svg>
            <span>复制</span>
          </button>
        </div>
      </div>`;

    floatingPanel.querySelector('.oit-copy-btn').onclick = () => {
      navigator.clipboard.writeText(translation);
      const btn = floatingPanel.querySelector('.oit-copy-btn');
      const originalContent = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" style="color:#34C759">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
        </svg>
        <span style="color:#34C759">已复制</span>`;
      setTimeout(() => {
        if (floatingPanel) btn.innerHTML = originalContent;
      }, 2000);
    };
    floatingPanel.querySelector('.oit-close-btn').onclick = hideFloating;

  } catch (error) {
    // 🔥 检查上下文失效错误
    if (error.message?.includes('Extension context invalidated')) {
      showContextInvalidatedWarning();
      if (floatingPanel) {
        floatingPanel.innerHTML = `<div class="oit-panel-error">请刷新页面后重试</div>`;
      }
    } else {
      floatingPanel.innerHTML = `<div class="oit-panel-error">${escapeHtml(error.message)}</div>`;
    }
  }
}

// ==================== 悬浮翻译按钮 (FAB) ====================

let fab = null;
let fabState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  startLeft: 0,
  startTop: 0,
  hasMoved: false
};

// 初始化悬浮按钮
function initFAB() {
  // 避免重复创建
  if (document.querySelector('.oit-fab')) return;
  
  // 检查上下文
  if (!isExtensionContextValid()) {
    console.log('[OIT] Context invalid, skipping FAB init');
    return;
  }
  
  // 从存储中获取位置（安全版本）
  safeChrome(
    () => chrome.storage.local.get('fabPosition'),
    { fabPosition: null }
  ).then(result => {
    const position = result?.fabPosition || { right: 20, top: '50%' };
    createFAB(position);
  });
}

// 创建悬浮按钮
function createFAB(position) {
  fab = document.createElement('div');
  fab.className = 'oit-fab';
  fab.innerHTML = `
    <div class="oit-fab-tooltip">翻译页面</div>
    <button class="oit-fab-btn" id="oitFabBtn">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
      </svg>
    </button>
    <button class="oit-fab-close" title="隐藏按钮">×</button>
  `;
  
  // 设置位置
  if (position.right !== undefined) {
    fab.style.right = position.right + 'px';
    fab.style.left = 'auto';
  } else if (position.left !== undefined) {
    fab.style.left = position.left + 'px';
    fab.style.right = 'auto';
    fab.classList.add('left');
  }
  
  if (position.top) {
    fab.style.top = typeof position.top === 'number' ? position.top + 'px' : position.top;
    fab.style.transform = position.top === '50%' ? 'translateY(-50%)' : 'none';
  }
  
  document.body.appendChild(fab);
  
  // 绑定事件
  const fabBtn = fab.querySelector('.oit-fab-btn');
  const closeBtn = fab.querySelector('.oit-fab-close');
  
  // 🔥 包装函数：在执行前检查上下文
  const safeHandler = (fn) => {
    return (e) => {
      // 检查上下文是否有效
      if (!isExtensionContextValid()) {
        cleanupInvalidContext();
        return;
      }
      fn(e);
    };
  };
  
  // 点击翻译
  fabBtn.addEventListener('click', safeHandler((e) => {
    if (!fabState.hasMoved) {
      handleFabClick();
    }
    fabState.hasMoved = false;
  }));
  
  // 拖拽功能 - 不需要 chrome API，但为了一致性也添加检查
  fabBtn.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
  
  // 触摸支持
  fabBtn.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('touchmove', onDrag, { passive: false });
  document.addEventListener('touchend', endDrag);
  
  // 关闭按钮 - 🔥 使用 closeFabByUser 保存用户偏好
  closeBtn.addEventListener('click', safeHandler((e) => {
    e.stopPropagation();
    closeFabByUser(); // 会同步保存配置
  }));
  
  // 3秒后变成迷你模式
  setTimeout(() => {
    if (fab && !fabState.isDragging) {
      fab.classList.add('mini');
    }
  }, 3000);
  
  // 鼠标进入时取消迷你模式
  fab.addEventListener('mouseenter', () => {
    if (fab) fab.classList.remove('mini');
  });
  
  // 鼠标离开后恢复迷你模式
  fab.addEventListener('mouseleave', () => {
    if (!state.isActive) {
      setTimeout(() => {
        if (fab && !fabState.isDragging) {
          fab.classList.add('mini');
        }
      }, 2000);
    }
  });
}

/**
 * 清理失效上下文 - 移除 FAB 并提示用户
 */
function cleanupInvalidContext() {
  console.log('[OIT] Cleaning up invalid context...');
  
  // 显示警告
  showContextInvalidatedWarning();
  
  // 停止任何正在进行的翻译
  if (state.isActive) {
    state.isActive = false;
    state.shouldStop = true;
  }
}

// 开始拖拽
function startDrag(e) {
  if (e.target.classList.contains('oit-fab-close')) return;
  
  fabState.isDragging = true;
  fabState.hasMoved = false;
  
  const touch = e.touches ? e.touches[0] : e;
  fabState.startX = touch.clientX;
  fabState.startY = touch.clientY;
  
  const rect = fab.getBoundingClientRect();
  fabState.startLeft = rect.left;
  fabState.startTop = rect.top;
  
  fab.classList.add('dragging');
  fab.classList.remove('mini');
  
  e.preventDefault();
}

// 拖拽中
function onDrag(e) {
  if (!fabState.isDragging) return;
  
  const touch = e.touches ? e.touches[0] : e;
  const deltaX = touch.clientX - fabState.startX;
  const deltaY = touch.clientY - fabState.startY;
  
  // 判断是否真的移动了
  if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
    fabState.hasMoved = true;
  }
  
  let newLeft = fabState.startLeft + deltaX;
  let newTop = fabState.startTop + deltaY;
  
  // 边界限制
  const fabWidth = fab.offsetWidth;
  const fabHeight = fab.offsetHeight;
  
  newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - fabWidth));
  newTop = Math.max(0, Math.min(newTop, window.innerHeight - fabHeight));
  
  fab.style.left = newLeft + 'px';
  fab.style.top = newTop + 'px';
  fab.style.right = 'auto';
  fab.style.transform = 'none';
  
  // 判断靠左还是靠右
  if (newLeft < window.innerWidth / 2) {
    fab.classList.add('left');
  } else {
    fab.classList.remove('left');
  }
  
  e.preventDefault();
}

// 结束拖拽
function endDrag(e) {
  if (!fabState.isDragging) return;
  
  fabState.isDragging = false;
  fab.classList.remove('dragging');
  
  // 自动吸附到边缘
  const rect = fab.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  
  let position = {};
  
  if (centerX < window.innerWidth / 2) {
    // 吸附到左边
    fab.style.left = '20px';
    fab.style.right = 'auto';
    fab.classList.add('left');
    position.left = 20;
  } else {
    // 吸附到右边
    fab.style.right = '20px';
    fab.style.left = 'auto';
    fab.classList.remove('left');
    position.right = 20;
  }
  
  position.top = rect.top;
  
  // 保存位置（安全版本）
  safeChrome(() => chrome.storage.local.set({ fabPosition: position }));
}

// 点击悬浮按钮
async function handleFabClick() {
  // 🔥 首先检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    showContextInvalidatedWarning();
    return;
  }
  
  const fabBtn = fab?.querySelector('.oit-fab-btn');
  const tooltip = fab?.querySelector('.oit-fab-tooltip');
  
  if (!fabBtn || !tooltip) return;
  
  // 如果正在翻译，停止
  if (state.isActive) {
    stopTranslation();
    resetFabToIdle();
    // 通知 popup 状态变化
    broadcastState('stopped');
    return;
  }
  
  try {
    // 🔥 使用新的配置系统加载配置（与 popup 保持一致）
    const config = await loadFullConfig();
    
    // 再次检查上下文（loadFullConfig 可能因上下文失效返回默认配置）
    if (!isExtensionContextValid()) {
      showContextInvalidatedWarning();
      return;
    }
    
    // 🔥 检查是否需要 API Key（Google 和 Ollama 不需要）
    const needsApiKey = checkNeedsApiKey(config.provider);
    
    if (needsApiKey && !config.apiKey) {
      // 显示提示
      tooltip.textContent = '请先配置 API';
      tooltip.style.opacity = '1';
      setTimeout(() => {
        if (fab) {
          tooltip.style.opacity = '';
          tooltip.textContent = '翻译页面';
        }
      }, 2000);
      return;
    }
    
    // 开始翻译
    setFabToTranslating();
    
    startTranslation(config);
    
    // 通知 popup 状态变化
    broadcastState('translating');
    
  } catch (e) {
    console.error('[OIT] FAB click error:', e);
    
    // 检查是否是上下文失效错误
    if (e.message?.includes('Extension context invalidated')) {
      showContextInvalidatedWarning();
    } else {
      // 其他错误显示在 tooltip
      tooltip.textContent = '出错了';
      tooltip.style.opacity = '1';
      setTimeout(() => {
        if (fab) {
          tooltip.style.opacity = '';
          tooltip.textContent = '翻译页面';
        }
      }, 2000);
    }
  }
}

/**
 * 加载完整配置（与 popup 中的 ConfigManager.getCurrentFullConfig 保持一致）
 * 使用 safeChrome 包装器确保健壮性
 */
async function loadFullConfig() {
  const result = await safeChrome(
    () => chrome.storage.sync.get(['globalConfig', 'providerConfigs']),
    {} // 回退空对象
  );
  
  if (!result) {
    // 上下文失效，返回默认 Google 配置
    return getDefaultConfig();
  }
  
  const globalConfig = result.globalConfig || {};
  const providerConfigs = result.providerConfigs || {};
  
  const provider = globalConfig.provider || 'google';
  const providerConfig = providerConfigs[provider] || {};
  
  // 返回与 popup 一致的配置格式
  return {
    provider: provider,
    apiEndpoint: providerConfig.endpoint || getDefaultEndpoint(provider),
    apiKey: providerConfig.apiKey || '',
    modelName: providerConfig.model || getDefaultModel(provider),
    sourceLang: globalConfig.sourceLang || 'auto',
    targetLang: globalConfig.targetLang || 'zh-CN',
    translationStyle: globalConfig.translationStyle || 'accurate',
    showOriginal: globalConfig.showOriginal !== false,
    autoDetect: globalConfig.autoDetect !== false,
    customPrompt: globalConfig.customPrompt || '',
    maxTokens: globalConfig.maxTokens || 2048,
    temperature: globalConfig.temperature || 0.3,
    maxConcurrent: clampMaxConcurrent(globalConfig.maxConcurrent)
  };
}

/**
 * 获取默认配置（当无法读取存储时使用）
 */
function getDefaultConfig() {
  return {
    provider: 'google',
    apiEndpoint: '',
    apiKey: '',
    modelName: '',
    sourceLang: 'auto',
    targetLang: 'zh-CN',
    translationStyle: 'accurate',
    showOriginal: true,
    autoDetect: true,
    customPrompt: '',
    maxTokens: 2048,
    temperature: 0.3,
    maxConcurrent: CONFIG.MAX_CONCURRENT
  };
}

// getDefaultEndpoint, getDefaultModel, checkNeedsApiKey are now in shared/providers.js

// 设置悬浮按钮为翻译中状态
function setFabToTranslating() {
  if (!fab) return;
  
  const fabBtn = fab.querySelector('.oit-fab-btn');
  const tooltip = fab.querySelector('.oit-fab-tooltip');
  
  fabBtn.classList.add('translating');
  fabBtn.classList.remove('completed');
  tooltip.textContent = '点击停止';
  fab.classList.remove('mini');
  
  // 更新按钮图标为加载状态
  fabBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" fill="currentColor"/>
    </svg>
  `;
}

// 隐藏悬浮按钮
function hideFAB() {
  if (fab) {
    fab.remove();
    fab = null;
  }
  console.log('[OIT] FAB hidden');
}

/**
 * 🔥 用户主动关闭 FAB（通过 FAB 上的关闭按钮）
 * 这会同步保存配置，使所有页面都不显示 FAB
 */
async function closeFabByUser() {
  console.log('[OIT] User closed FAB, saving preference');
  
  // 1. 移除当前 FAB
  hideFAB();
  
  // 2. 保存配置到存储（所有页面生效）
  if (isExtensionContextValid()) {
    try {
      // 读取现有配置
      const result = await chrome.storage.sync.get('globalConfig');
      const globalConfig = result.globalConfig || {};
      
      // 更新 showFab 配置
      globalConfig.showFab = false;
      
      // 保存
      await chrome.storage.sync.set({ globalConfig });
      console.log('[OIT] FAB preference saved: hidden');
      
      // 3. 通知 popup 更新 UI（如果打开的话）
      chrome.runtime.sendMessage({
        action: 'fabStateChanged',
        showFab: false
      }).catch(() => {});
    } catch (e) {
      console.error('[OIT] Failed to save FAB preference:', e);
    }
  }
}

// 显示悬浮按钮
function showFAB() {
  if (!fab) {
    initFAB();
    console.log('[OIT] FAB shown');
  }
}

// 更新悬浮按钮状态
function updateFabStatus(status) {
  if (!fab) return;
  
  const fabBtn = fab.querySelector('.oit-fab-btn');
  const tooltip = fab.querySelector('.oit-fab-tooltip');
  
  switch (status) {
    case 'translating':
      fabBtn.classList.add('translating');
      fabBtn.classList.remove('completed');
      tooltip.textContent = '翻译中...';
      break;
      
    case 'completed':
      fabBtn.classList.remove('translating');
      fabBtn.classList.add('completed');
      fabBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
        </svg>
      `;
      tooltip.textContent = '翻译完成';
      
      // 3秒后恢复
      setTimeout(() => {
        if (fab) {
          fabBtn.classList.remove('completed');
          fabBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
            </svg>
          `;
          tooltip.textContent = '翻译页面';
          fab.classList.add('mini');
        }
      }, 3000);
      break;
      
    case 'error':
      fabBtn.classList.remove('translating');
      fabBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
        </svg>
      `;
      tooltip.textContent = '翻译出错';
      break;
      
    default:
      fabBtn.classList.remove('translating', 'completed');
      tooltip.textContent = '翻译页面';
  }
}

// 检查是否应该显示 FAB（使用新配置系统）
async function shouldShowFab() {
  // 先检查上下文
  if (!isExtensionContextValid()) {
    console.log('[OIT] Extension context invalid, not showing FAB');
    return false;
  }
  
  try {
    const result = await chrome.storage.sync.get(['globalConfig', 'config']);
    
    // 新配置系统
    if (result.globalConfig && typeof result.globalConfig.showFab === 'boolean') {
      console.log('[OIT] FAB config from globalConfig:', result.globalConfig.showFab);
      return result.globalConfig.showFab;
    }
    
    // 兼容旧配置
    if (result.config && typeof result.config.showFab === 'boolean') {
      console.log('[OIT] FAB config from old config:', result.config.showFab);
      return result.config.showFab;
    }
    
    // 🔥 默认显示（新安装或未设置时）
    console.log('[OIT] FAB config not found, defaulting to true');
    return true;
  } catch (e) {
    console.log('[OIT] Error reading FAB config:', e);
    // 出错时也默认显示
    return true;
  }
}

// 初始化 FAB（带重试机制）
async function initFabOnLoad() {
  // 等待 DOM 和 body 完全可用
  let retries = 0;
  while (!document.body && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retries++;
  }
  
  if (!document.body) {
    console.error('[OIT] document.body not available');
    return;
  }
  
  // 检查是否应该显示
  const shouldShow = await shouldShowFab();
  console.log('[OIT] Should show FAB:', shouldShow);
  
  if (shouldShow) {
    initFAB();
    console.log('[OIT] FAB initialized');
  }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFabOnLoad);
} else {
  // DOM 已加载，直接初始化
  initFabOnLoad();
}

// 🔥 性能优化: 页面卸载时清理所有事件监听器和资源
window.addEventListener('beforeunload', () => {
  console.log('[OIT] Page unloading, cleaning up...');

  // 清理选中文本翻译的事件监听器
  if (mouseupHandler) {
    document.removeEventListener('mouseup', mouseupHandler);
    mouseupHandler = null;
  }

  // 停止翻译并清理所有状态
  if (state.isActive) {
    stopTranslation();
  }

  // 完全重置状态
  state.fullReset();

  // 清理浮动元素
  hideFloating();
  hideFAB();

  // 🔥 性能调试: 打印缓存命中率
  const totalChecks = cacheHits + cacheMisses;
  if (totalChecks > 0) {
    const hitRate = ((cacheHits / totalChecks) * 100).toFixed(1);
    console.log(`[OIT] Translation check cache: ${cacheHits} hits / ${cacheMisses} misses (${hitRate}% hit rate)`);
  }

  console.log('[OIT] Cleanup completed');
});
