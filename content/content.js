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

const translationCore = globalThis.OITTranslationCore;
const pageScanner = globalThis.OITPageScanner;
const TranslationSourceState = globalThis.OITTranslationSourceState;
const TranslationSession = globalThis.OITTranslationSession;
const TranslationScheduler = globalThis.OITTranslationScheduler;
const requestTimeout = globalThis.OITRequestTimeout;

if (!translationCore) {
  throw new Error('Translation core must be loaded before content/content.js');
}
if (!pageScanner) {
  throw new Error('Page scanner must be loaded before content/content.js');
}
if (!TranslationSourceState) {
  throw new Error('Translation source state must be loaded before content/content.js');
}
if (!TranslationSession) {
  throw new Error('Translation session must be loaded before content/content.js');
}
if (!TranslationScheduler) {
  throw new Error('Translation scheduler must be loaded before content/content.js');
}
if (!requestTimeout) {
  throw new Error('Request timeout module must be loaded before content/content.js');
}

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

function getRuntimeRequestTimeout() {
  const value = Number(CONFIG.RUNTIME_REQUEST_TIMEOUT);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function getLoadedExtensionVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || null;
  } catch (error) {
    return null;
  }
}

function abortRuntimeRequest(requestId) {
  if (!requestId || !isExtensionContextValid()) return;
  try {
    const result = chrome.runtime.sendMessage({
      action: 'abortRequest',
      requestId
    });
    result?.catch?.(() => {});
  } catch (error) {
    // The extension context can disappear while a page request is settling.
  }
}

function sendTimedRuntimeMessage(message, label, signal = null) {
  return requestTimeout.withTimeout(
    () => chrome.runtime.sendMessage(message),
    {
      timeoutMs: getRuntimeRequestTimeout(),
      signal,
      message: label
    }
  );
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
  SINGLE_TRANSLATE: false, // 小批量请求，校验失败时由后台自动降级为单条
  BATCH_SIZE: 5, // 每个批次最多合并的文本块数
  BATCH_MAX_CHARS: 3200, // 一个批次的最大字符数
  BATCH_MAX_DISTANCE: 400, // 批次内元素最大 Y 坐标距离(px)
  SCAN_INTERVAL: 150, // 滚动扫描间隔(ms)
  SCROLL_DEBOUNCE: 100, // 滚动防抖(ms)
  RUNTIME_REQUEST_TIMEOUT: 30000,

  // 动态内容
  MUTATION_DEBOUNCE: 200,
  COMPLETION_IDLE: 400,
  MUTATION_ATTRIBUTES: [
    'class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'open',
    'role', 'translate', 'contenteditable'
  ],

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
  SKIP_CLASSES: [
    'oit-wrapper', 'oit-translated-host', 'oit-translation', 'oit-original',
    'notranslate', 'no-translate'
  ],

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

const DYNAMIC_STRUCTURE_ATTRIBUTES = new Set([
  'hidden',
  'aria-hidden',
  'aria-expanded',
  'open',
  'role'
]);

const HIDDEN_CLASS_TOKENS = new Set([
  'hidden',
  'is-hidden',
  'u-hidden',
  'invisible',
  'is-invisible',
  'collapsed',
  'is-collapsed',
  'closed',
  'is-closed',
  'd-none',
  'display-none'
]);

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

  dequeue(predicate = null) {
    if (this.items.length === 0) return null;
    if (typeof predicate !== 'function') return this.items.shift().item;
    const index = this.items.findIndex(({ item }) => predicate(item));
    if (index < 0) return null;
    return this.items.splice(index, 1)[0].item;
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
    this.lifecycle = new TranslationSession();
    this.config = null;
    this.observer = null;
    this.mutationObserver = null;
    this.shadowObservers = new Map();
    this.shadowRoots = new Set();
    this.pendingDynamicRoots = new Set();
    this.dynamicDiagnostics = {
      mutationBatches: 0,
      roots: 0,
      scanRuns: 0,
      candidates: 0,
      blocks: 0,
      rootSamples: [],
      ignoredMutations: 0,
      suppressedMutations: 0,
      mutationSamples: []
    };
    this.mutationTimer = null;
    this.mutationHandler = null;
    this.scrollHandler = null; // 滚动监听
    this.scrollTargets = new Map();
    this.scrollTimer = null; // 滚动防抖
    this.translatedCount = 0;
    this.bodyTranslatedCount = 0;
    this.failedRequestCount = 0;
    this.lastFailureReason = null;
    this.failureCooldownDeferred = 0;
    this.retryPolicy = new OITTranslationRetryPolicy({
      maxAttempts: 2,
      cooldownMs: 30000,
      maxCooldownMs: 120000
    });
    this.completedElements = new WeakSet();
    this.processedElements = new WeakSet();
    this.blockMap = new Map();

    // 🚀 优先级翻译队列
    this.translationQueue = new PriorityQueue(CONFIG.MAX_QUEUE_SIZE); // 待翻译优先队列
    this.activeTranslations = 0; // 当前并发数
    this.activeBodyTranslations = 0;
    this.activeAdaptiveTranslations = 0;
    this.activeSupplementalTranslations = 0;
    this.requestScheduler = new TranslationScheduler({
      maxConcurrent: CONFIG.MAX_CONCURRENT,
      adaptiveReserve: 1,
      supplementalReserve: 1
    });
    this.isProcessing = false; // 是否正在处理队列
    this.translationTasks = new Set(); // 已启动但尚未完成的正文请求
    this.completionTimer = null;
    this.pipelineSettled = false;

    // 🔥 性能优化: 维护待翻译元素的引用,避免全局querySelectorAll
    this.pendingElements = new Set(); // 待翻译元素集合
    this.translatingElements = new Set(); // 翻译中元素集合
    this.inflightRequests = new Map(); // element -> { requestId, abort, blocks }
    this.periodicScanTimer = null; // 定期扫描定时器
    this.requestIdCounter = 0; // 请求 ID 生成器
    this.scanContext = null;
    this.contentRoot = null;
    this.scope = 'smart';
  }

  reset() {
    this.isActive = false;
    this.shouldStop = false;
    this.lifecycle.reset();
    this.translatedCount = 0;
    this.bodyTranslatedCount = 0;
    this.failedRequestCount = 0;
    this.lastFailureReason = null;
    this.failureCooldownDeferred = 0;
    this.retryPolicy.clear();
    // 🔥 保留 processedElements 和 completedElements，避免重复翻译已翻译的内容
    // 这样当用户重新开始翻译时，已经翻译过的内容不会再次翻译
    // this.processedElements 是 WeakSet，会随节点自动清理
    // this.completedElements 也保留，避免重复翻译
    this.blockMap.clear();
    this.translationQueue.clear(); // 🔥 确保队列被清空（同时清理 pending 标记）
    this.activeTranslations = 0;
    this.activeBodyTranslations = 0;
    this.activeAdaptiveTranslations = 0;
    this.activeSupplementalTranslations = 0;
    this.requestScheduler.reset();
    this.isProcessing = false;
    this.translationTasks.clear();
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    this.pipelineSettled = false;
    // 🔥 性能优化: 清理待翻译元素集合
    this.pendingElements.clear();
    this.translatingElements.clear();
    this.inflightRequests.clear();
    this.pendingDynamicRoots.clear();
    this.dynamicDiagnostics = {
      mutationBatches: 0,
      roots: 0,
      scanRuns: 0,
      candidates: 0,
      blocks: 0,
      rootSamples: [],
      ignoredMutations: 0,
      mutationSamples: []
    };

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
    this.mutationHandler = null;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    for (const observer of this.shadowObservers.values()) observer.disconnect();
    this.shadowObservers.clear();
    this.shadowRoots.clear();
    this.detachScrollListeners();
    this.scanContext = null;
    this.contentRoot = null;
  }

  detachScrollListeners() {
    if (this.scrollHandler) {
      for (const [target, options] of this.scrollTargets) {
        target.removeEventListener('scroll', this.scrollHandler, options);
      }
    }
    this.scrollTargets.clear();
    this.scrollHandler = null;
  }
  
  /**
   * 完全重置（包括清空已翻译记录）
   * 用于"恢复原样"功能
   */
  fullReset() {
    this.reset();
    this.processedElements = new WeakSet();
    this.completedElements = new WeakSet();
    this.blockMap.clear();
    translatedCheckCache = new WeakMap();
  }
}

const state = new TranslationState();
const translationRecords = new Map();
const translationSourceState = TranslationSourceState.createSourceStateStore();
let titleRecord = null;
let titleRequestToken = 0;
let titleInflightRequestId = null;
let titleRequestController = null;
let selectionRequestToken = 0;
let selectionInflightRequest = null;
let translatedCheckCache = new WeakMap();
const OWNED_TRANSLATION_SELECTOR = '.oit-wrapper, .oit-translated-host, .oit-translation, .oit-original';
const TRANSLATION_OUTPUT_SELECTOR = '.oit-translation';
const SOURCE_LAYOUT_SELECTOR = '.oit-original, .oit-original-flow, .oit-wrapper, .oit-direct-text-run';
const OWNED_MUTATION_NODE_SELECTOR = '.oit-translation, .oit-original, .oit-original-flow, .oit-wrapper, .oit-direct-text-run';
const OWNED_HOST_CLASS_TOKENS = new Set([
  'oit-translated-host',
  'oit-pending',
  'oit-pending-dark',
  'oit-translating-text',
  'oit-dark'
]);

function isInsideOwnedTranslation(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.(OWNED_TRANSLATION_SELECTOR));
}

function hasOwnedTranslations() {
  return translationRecords.size > 0
    || Boolean(titleRecord)
    || Boolean(document.querySelector('.oit-translated-host, .oit-wrapper'));
}

function getTranslationStateSnapshot() {
  const lifecycle = state.lifecycle.snapshot();
  const pipelineBusy = isTranslationPipelineBusy();
  const scanStats = state.scanContext?.stats || {};
  return {
    isTranslating: pipelineBusy,
    sessionActive: state.isActive,
    pipelineBusy,
    extensionVersion: getLoadedExtensionVersion(),
    phase: lifecycle.phase,
    lastError: lifecycle.lastError,
    lastActivityAt: lifecycle.lastActivityAt,
    translatedCount: state.translatedCount,
    hasTranslations: hasOwnedTranslations(),
    diagnostics: {
      bodyTranslatedCount: state.bodyTranslatedCount,
      failedRequestCount: state.failedRequestCount,
      lastFailureReason: state.lastFailureReason,
      failureCooldownDeferred: state.failureCooldownDeferred,
      queueLength: state.translationQueue.length,
      activeTranslations: state.activeTranslations,
      activeBodyTranslations: state.activeBodyTranslations,
      activeAdaptiveTranslations: state.activeAdaptiveTranslations,
      activeSupplementalTranslations: state.activeSupplementalTranslations,
      scheduler: state.requestScheduler.snapshot(),
      pendingCount: state.pendingElements.size,
      translatingCount: state.translatingElements.size,
      inflightCount: state.inflightRequests.size,
      taskCount: state.translationTasks.size,
      recordCount: translationRecords.size,
      isProcessing: state.isProcessing,
      isStopped: state.shouldStop,
      pendingDynamicRoots: state.pendingDynamicRoots.size,
      mutationTimerPending: state.mutationTimer !== null,
      pipelineBusy,
      pipelineSettled: state.pipelineSettled,
      dynamicMutationBatches: state.dynamicDiagnostics.mutationBatches,
      dynamicRoots: state.dynamicDiagnostics.roots,
      dynamicScanRuns: state.dynamicDiagnostics.scanRuns,
      dynamicCandidates: state.dynamicDiagnostics.candidates,
      dynamicBlocks: state.dynamicDiagnostics.blocks,
      dynamicRootSamples: state.dynamicDiagnostics.rootSamples,
      dynamicIgnoredMutations: state.dynamicDiagnostics.ignoredMutations,
      dynamicSuppressedMutations: state.dynamicDiagnostics.suppressedMutations,
      dynamicMutationSamples: state.dynamicDiagnostics.mutationSamples,
      adaptiveUiRootsFound: scanStats.adaptiveUiRootsFound || 0,
      adaptiveUiRootsAccepted: scanStats.adaptiveUiRootsAccepted || 0,
      adaptiveUiRootsRejected: scanStats.adaptiveUiRootsRejected || 0,
      adaptiveUiRootSources: {
        ...(scanStats.adaptiveUiRootSources || {})
      },
      adaptiveUiRootSamples: Array.isArray(scanStats.adaptiveUiRootSamples)
        ? scanStats.adaptiveUiRootSamples.slice(0, 40)
        : [],
      supplementalContentRootsFound:
        scanStats.supplementalRootsFound || 0,
      supplementalContentRootsAccepted:
        scanStats.supplementalRootsAccepted || 0,
      supplementalContentRootsRejected:
        scanStats.supplementalRootsRejected || 0,
      supplementalContentRootSamples:
        Array.isArray(scanStats.supplementalRootSamples)
          ? scanStats.supplementalRootSamples.slice(0, 20)
          : []
    }
  };
}

// ==================== 初始化 ====================
console.log('[OpenImmerseTranslate] Content script loaded - Viewport-first algorithm');

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OpenImmerseTranslate] Message:', message.action);
  
  switch (message.action) {
    case 'ping':
      // 用于检测内容脚本是否已加载，同时返回当前翻译状态
      sendResponse({
        pong: true,
        version: getLoadedExtensionVersion(),
        isTranslating: isTranslationPipelineBusy(),
        sessionActive: state.isActive,
        phase: state.lifecycle.snapshot().phase
      });
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
      sendResponse(getTranslationStateSnapshot());
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
    const lifecycle = state.lifecycle.snapshot();
    chrome.runtime.sendMessage({
      action: 'translationStateChanged',
      status: status,
      isTranslating: isTranslationPipelineBusy(),
      pipelineBusy: isTranslationPipelineBusy(),
      sessionActive: state.isActive,
      phase: lifecycle.phase,
      lastError: lifecycle.lastError,
      hasTranslations: hasOwnedTranslations(),
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
  if (fabStatusTimer) {
    clearTimeout(fabStatusTimer);
    fabStatusTimer = null;
  }
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

function configureTranslationScheduler() {
  return state.requestScheduler.configure({
    maxConcurrent: getMaxConcurrent(),
    adaptiveReserve: 1,
    supplementalReserve: 1
  });
}

function isAdaptiveTranslationBlock(block) {
  if (!block?.element) return false;
  return block.siteRole === 'navigation-label'
    || block.kind === 'ui'
    || block.role === 'control'
    || Boolean(block.element.closest?.(
      'nav, [role="navigation"], [role="menu"], [role="menubar"], '
        + '[role="tablist"], [role="toolbar"]'
    ));
}

function isSupplementalTranslationBlock(block) {
  return block?.siteRole === 'supplemental-content';
}

function getTranslationLaneForBlock(block) {
  if (isAdaptiveTranslationBlock(block)) {
    return TranslationScheduler.LANES.ADAPTIVE;
  }
  if (isSupplementalTranslationBlock(block)) {
    return TranslationScheduler.LANES.SUPPLEMENTAL;
  }
  return TranslationScheduler.LANES.BODY;
}

function syncTranslationSchedulerState() {
  const snapshot = state.requestScheduler.snapshot();
  state.activeTranslations = snapshot.active.total;
  state.activeBodyTranslations = snapshot.active.body;
  state.activeAdaptiveTranslations = snapshot.active.adaptive;
  state.activeSupplementalTranslations = snapshot.active.supplemental;
  return snapshot;
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

  // 可见导航与交互标签先于正文，避免页面正文长期占满并发槽位。
  if (isAdaptiveTranslationBlock(block)) {
    score += 30000;
  }
  if (isSupplementalTranslationBlock(block)) {
    score += 26000;
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
 * 获取一个带通道优先级的并发槽位。
 *
 * state.activeTranslations remains the effective total for compatibility with
 * diagnostics and existing tests, while the scheduler enforces the adaptive
 * reserve. A direct test override of activeTranslations therefore still blocks
 * queue pumping.
 */
function acquireSlot(lane = TranslationScheduler.LANES.BODY) {
  configureTranslationScheduler();
  if (state.activeTranslations >= getMaxConcurrent()) return false;
  if (!state.requestScheduler.acquire(lane)) return false;
  syncTranslationSchedulerState();
  return true;
}

/**
 * 释放并发槽位；若仍有工作，立即用事件驱动方式泵送队列。
 */
function releaseSlot(lane = TranslationScheduler.LANES.BODY) {
  if (state.requestScheduler.release(lane)) {
    syncTranslationSchedulerState();
  } else if (state.activeTranslations > 0) {
    // Direct translateBatch calls in tests do not own a scheduler slot.
    state.activeTranslations = Math.max(0, state.activeTranslations - 1);
  }
  scheduleTranslationCompletionCheck();
  if (state.isActive && !state.shouldStop) pumpTranslationQueue();
}

function isTranslationPipelineIdle() {
  return state.translationQueue.length === 0
    && state.activeTranslations === 0
    && state.translationTasks.size === 0
    && state.inflightRequests.size === 0
    && titleInflightRequestId === null
    && !state.isProcessing;
}

function isTranslationPipelineBusy() {
  return state.isActive && (!state.pipelineSettled || !isTranslationPipelineIdle());
}

function markTranslationActivity() {
  if (!state.isActive || state.shouldStop) return;
  const wasSettled = state.pipelineSettled;
  state.pipelineSettled = false;
  state.lifecycle.markActivity();
  if (!wasSettled) return;

  if (typeof updateFabStatus === 'function') {
    updateFabStatus('translating');
  }
  broadcastState('translating');
}

function settleTranslationPipeline() {
  if (!state.isActive || state.shouldStop || !isTranslationPipelineIdle()) {
    return false;
  }
  if (state.pipelineSettled) return true;
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
  state.pipelineSettled = true;

  const lifecycle = state.lifecycle.settle({
    translatedCount: state.bodyTranslatedCount,
    failedRequestCount: state.failedRequestCount,
    error: state.lastFailureReason || undefined
  });

  if (lifecycle.phase === 'completed') {
    notifyComplete();
  } else {
    notifyError(lifecycle.lastError || 'Page translation failed');
  }
  return true;
}

function scheduleTranslationCompletionCheck(delay = CONFIG.COMPLETION_IDLE) {
  if (!state.isActive || state.shouldStop) return;
  if (state.completionTimer) clearTimeout(state.completionTimer);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (!settleTranslationPipeline()
        && state.isActive
        && state.translationQueue.length > 0
        && !state.isProcessing
        && state.activeTranslations === 0) {
      processQueue();
    }
  }, delay);
}

function launchTranslationBatch(blocks, lane = TranslationScheduler.LANES.BODY) {
  let task;
  task = Promise.resolve()
    .then(() => translateBatch(blocks, lane, true))
    .catch(error => {
      recordTranslationFailure(error);
      console.error('[OIT] Translation task failed before cleanup:', error);
    })
    .finally(() => {
      state.translationTasks.delete(task);
      scheduleTranslationCompletionCheck();
    });
  state.translationTasks.add(task);
  return task;
}

/**
 * Synchronously drain every currently admissible batch.
 *
 * This function intentionally does not await provider work. That lets a
 * newly-discovered navigation label claim the reserved lane while body
 * requests are still in flight.
 */
function pumpTranslationQueue() {
  if (!state.isActive || state.shouldStop) return 0;

  configureTranslationScheduler();
  let launched = 0;
  while (state.translationQueue.length > 0
      && state.activeTranslations < getMaxConcurrent()) {
    const next = state.translationQueue.toArray().find(block => (
      state.requestScheduler.canAcquire(getTranslationLaneForBlock(block))
    ));
    if (!next) break;

    const lane = getTranslationLaneForBlock(next);
    if (!acquireSlot(lane)) break;

    const batch = dequeueBatch(next);
    if (!batch || batch.length === 0) {
      releaseSlot(lane);
      break;
    }

    const batchLane = getTranslationLaneForBlock(batch[0]);
    console.log(
      `[OIT] 🔄 batch: ${batch.length} blocks, lane: ${batchLane}, `
        + `queue left: ${state.translationQueue.length}, active: ${state.activeTranslations}`
    );
    launchTranslationBatch(batch, batchLane);
    launched++;
  }
  return launched;
}

/**
 * 所见所得辅助：如果有可执行槽位，立即取当前最高优先的批次并发送。
 */
function tryPumpVisibleNow() {
  return pumpTranslationQueue() > 0;
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
  for (const [element, { requestId, controller, blocks }] of state.inflightRequests) {
    if (!element || !element.isConnected) {
      controller?.abort();
      abortRuntimeRequest(requestId);
      state.inflightRequests.delete(element);
      blocks.forEach(b => removePendingMark(b.element));
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom < -keepMargin || rect.top > viewportHeight + keepMargin) {
      controller?.abort();
      abortRuntimeRequest(requestId);
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
    if (!state.pipelineSettled) {
      console.log('[OpenImmerseTranslate] Already translating');
      return false;
    }
    console.log('[OpenImmerseTranslate] Restarting settled translation session');
  }
  
  state.reset();
  state.config = config || {};
  configureTranslationScheduler();
  state.isActive = true;
  state.lifecycle.start();
  setFabToTranslating();
  state.scope = state.config.translationScope === 'full' ? 'full' : 'smart';
  state.scanContext = pageScanner.createScanContext({ scope: state.scope });
  state.contentRoot = null;
  pageScanner.refreshOpenShadowRoots(
    document.body,
    state.scanContext,
    { force: true }
  );
  
  const startTime = performance.now();
  sendLog('🚀 开始扫描页面...', 'info');
  
  // 第一步：扫描视口内容并加入队列
  const viewportBlocks = collectViewportBlocks();
  const scanTime = (performance.now() - startTime).toFixed(0);
  
  if (viewportBlocks.length > 0) {
    sendLog(
      `⚡ ${state.scope === 'full' ? '全页' : '智能'}范围发现 ${viewportBlocks.length} 个文本块 (${scanTime}ms)`,
      'success'
    );
    
    // 加入翻译队列
    viewportBlocks.forEach(block => {
      addToQueue(block);
    });
    
    // 所见所得：导航优先，正文最多占满除预留通道外的并发槽位。
    tryPumpVisibleNow();
    // 剩余的（预加载）走正常队列
    processQueue();
  } else {
    sendLog(`⚠️ 视口内未发现可翻译文本`, 'warning');
  }
  
  // 第二步：启动滚动监听（实时检测新内容）
  startScrollListener();
  
  // 第三步：启动 DOM 变化监听（支持 Twitter 无限滚动）
  startMutationObserver();

  // 标题是独立任务，避免混入正文批次或破坏改写逻辑。
  translateDocumentTitle().catch(error => {
    console.warn('[OIT] Document title translation failed:', error.message);
  }).finally(() => {
    scheduleTranslationCompletionCheck();
  });
  
  // 第四步：启动 IntersectionObserver 观察预加载内容
  requestIdleCallback(() => {
    if (!state.isActive || state.shouldStop) return;
    scanAndObserveAll();
  }, { timeout: 200 });
  
  // 第五步：启动定期扫描（补漏）
  startPeriodicScan();
  scheduleTranslationCompletionCheck();
  return true;
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
  const retryStatus = state.retryPolicy.getStatus(el, getBlockRetryFingerprint(block));
  if (!retryStatus.allowed) {
    state.failureCooldownDeferred++;
    return false;
  }

  const priority = computeBlockPriority(block);
  const entry = state.translationQueue.enqueue(block, priority);
  if (entry) {
    markTranslationActivity();
    markAsPending(el);
    return true;
  }
  return false;
}

/**
 * 从队列取出一个批次（空间邻近的块合并翻译）
 * SINGLE_TRANSLATE 或“当前可见”时使用更小的批次，实现所见所得的快速反馈
 */
function getBlockContainer(block) {
  return block?.container || block?.element?.parentElement || null;
}

function sameHeadingTrail(a, b) {
  const left = a?.headingTrail || [];
  const right = b?.headingTrail || [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function areReadingNeighbors(a, b) {
  const left = a?.element;
  const right = b?.element;
  if (!left || !right) return false;
  const parent = pageScanner.getComposedParentElement(left);
  if (!parent || parent !== pageScanner.getComposedParentElement(right)) return false;
  let sibling = left.nextElementSibling;
  while (sibling) {
    if (sibling === right) return true;
    if (sibling.matches?.('.oit-translation, .oit-original')) {
      sibling = sibling.nextElementSibling;
      continue;
    }
    return false;
  }
  return false;
}

function areSemanticallyRelated(first, next) {
  if (!first || !next) return false;

  // Controls are independent actions. Even a shared tab bar or toolbar should
  // not make unrelated labels part of the same semantic translation unit.
  if (first.role === 'control' || next.role === 'control') return false;
  if (first.role === 'title' || next.role === 'title') return false;
  if (!sameHeadingTrail(first, next)) return false;

  const firstContainer = getBlockContainer(first);
  const nextContainer = getBlockContainer(next);
  const sameContainer = firstContainer && nextContainer
    && (firstContainer === nextContainer
      || pageScanner.composedContains(firstContainer, nextContainer)
      || pageScanner.composedContains(nextContainer, firstContainer));

  if (!sameContainer) return false;
  if (areReadingNeighbors(first, next)) return true;
  if ((first.headingTrail || []).length > 0) return true;
  return first.parent === next.parent
    && Number.isInteger(first.order)
    && Number.isInteger(next.order)
    && Math.abs(first.order - next.order) <= 2;
}

function dequeueBatch(selectedHead = null) {
  if (state.translationQueue.length === 0) return null;

  const first = selectedHead
    ? state.translationQueue.dequeue(block => block === selectedHead)
    : state.translationQueue.dequeue();
  if (!first || state.completedElements.has(first.element)) {
    if (first) removePendingMark(first.element);
    return null;
  }

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

    if (getTranslationLaneForBlock(first) !== getTranslationLaneForBlock(next)) break;
    if (!areSemanticallyRelated(first, next)) break;

    // 空间邻近只是第二层保护，避免把同一内容区内相隔很远的重复块合并。
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
    let pass = 0;
    do {
      pumpTranslationQueue();
      const tasks = Array.from(state.translationTasks);
      if (tasks.length === 0) break;
      await Promise.allSettled(tasks);
      pass++;
    } while (state.isActive && !state.shouldStop);
    console.log(
      `[OIT] ✅ processQueue done, passes: ${pass}, `
        + `queue left: ${state.translationQueue.length}, active: ${state.activeTranslations}`
    );
  } finally {
    state.isProcessing = false;
    scheduleTranslationCompletionCheck();
  }
}

/**
 * 批次翻译（异步，不阻塞）
 */
async function translateDocumentTitle() {
  const sourceTitle = translationCore.normalizeWhitespace(document.title);
  if (!sourceTitle || titleRecord?.appliedTitle === document.title) return;
  if (state.config?.autoDetect && isTargetLanguage(sourceTitle)) return;
  if (REGEX_PATTERNS.URL_EMAIL.test(sourceTitle)) return;

  cancelDocumentTitleRequest();
  const token = titleRequestToken;
  const requestId = `title_${token}_${Date.now()}`;
  const controller = new AbortController();
  titleInflightRequestId = requestId;
  titleRequestController = controller;

  try {
    const response = await sendTimedRuntimeMessage({
      action: 'translate',
      requestId,
      texts: [sourceTitle],
      config: state.config,
      context: { scene: 'title' }
    }, 'Document title translation timed out', controller.signal);

    if (token !== titleRequestToken || !state.isActive || state.shouldStop) return;
    if (!response || response.error || response.cancelled) return;
    const translatedTitle = translationCore.normalizeWhitespace(response.translations?.[0]);
    if (!translatedTitle
        || isSameContent(sourceTitle, translatedTitle)
        || document.title !== sourceTitle) {
      return;
    }

    document.title = translatedTitle;
    titleRecord = {
      sourceTitle,
      appliedTitle: document.title
    };
    state.translatedCount++;
  } catch (error) {
    if (error.name === 'TimeoutError') {
      abortRuntimeRequest(requestId);
    }
    throw error;
  } finally {
    if (titleInflightRequestId === requestId) {
      titleInflightRequestId = null;
      titleRequestController = null;
    }
  }
}

function cancelDocumentTitleRequest() {
  titleRequestToken++;
  const requestId = titleInflightRequestId;
  titleInflightRequestId = null;
  if (titleRequestController) {
    titleRequestController.abort();
    titleRequestController = null;
  }
  abortRuntimeRequest(requestId);
}

function restoreDocumentTitle() {
  if (!titleRecord) return false;
  const record = titleRecord;
  titleRecord = null;
  titleRequestToken++;
  if (document.title !== record.appliedTitle) return false;
  document.title = record.sourceTitle;
  return true;
}

function buildTranslationContext(blocks) {
  const itemContexts = blocks.map(block => {
    if (block.itemContext) {
      return translationCore.normalizeWhitespace(block.itemContext).slice(0, 700);
    }
    if (block.element) {
      return pageScanner.buildItemContext(block.element, {
        contentRoot: block.container || state.contentRoot || document.body,
        context: state.scanContext
      }).slice(0, 700);
    }
    const parts = [];
    let parent = block.element?.parentElement;
    for (let depth = 0; parent && depth < 2; depth++, parent = parent.parentElement) {
      const text = translationCore.normalizeWhitespace(parent.textContent);
      if (text) parts.push(text);
    }
    return translationCore.normalizeWhitespace(parts.join(' ')).slice(0, 320);
  });

  return {
    scene: 'page',
    title: translationCore.normalizeWhitespace(
      titleRecord?.sourceTitle || document.title
    ).slice(0, 180),
    surroundingText: translationCore.normalizeWhitespace(
      itemContexts.join(' ')
    ).slice(0, 900),
    itemContexts
  };
}

function refreshTranslationBlock(block) {
  if (!block?.element?.isConnected) return false;
  const current = prepareTranslationBlock(block.element, {
    isTwitter: block.isTwitter,
    site: block.site,
    siteRole: block.siteRole,
    isAppend: false,
    kind: block.kind,
    role: block.role,
    reason: block.reason,
    container: block.container,
    parent: block.parent,
    order: block.order,
    headingTrail: block.headingTrail,
    nearbyText: block.nearbyText,
    tableContext: block.tableContext,
    itemContext: block.itemContext
  }, { allowQueued: true });
  if (!current) return false;
  block.text = current.text;
  block.template = current.template;
  block.inlineTemplate = current.inlineTemplate;
  block.inPlaceTemplate = current.inPlaceTemplate;
  block.sourceSnapshot = current.sourceSnapshot;
  block.textNode = null;
  return true;
}

function getBlockSourceFingerprint(block) {
  if (!block?.element?.isConnected) return '';
  if (block.kind === 'plain-text') {
    return translationCore.normalizeWhitespace(block.element.textContent);
  }
  const currentTemplate = translationCore.buildInlineTemplate(block.element);
  return currentTemplate ? getTemplateVisibleText(currentTemplate) : '';
}

function isBlockSourceCurrent(block) {
  return Boolean(block?.sourceSnapshot)
    && translationSourceState.isCurrent(
      block.sourceSnapshot,
      getBlockSourceFingerprint(block)
    );
}

function getBlockRetryFingerprint(block) {
  return translationCore.normalizeWhitespace(
    String(block?.text || '').replace(PROTECTED_TOKEN_FILTER, ' ')
  );
}

function recordBlockTranslationFailure(block) {
  if (!block?.element) return null;
  return state.retryPolicy.recordFailure(
    block.element,
    getBlockRetryFingerprint(block)
  );
}

function recordPendingBlockFailures(blocks) {
  for (const block of blocks) recordBlockTranslationFailure(block);
}

function recordTranslationFailure(error) {
  state.failedRequestCount++;
  const message = error instanceof Error ? error.message : String(error || '');
  state.lastFailureReason = message.trim().slice(0, 500) || 'Page translation failed';
}

async function translateBatch(
  blocks,
  lane = TranslationScheduler.LANES.BODY,
  ownsSlot = false
) {
  try {
    return await executeTranslationBatch(blocks);
  } finally {
    if (ownsSlot) releaseSlot(lane);
  }
}

async function executeTranslationBatch(blocks) {
  if (!blocks || blocks.length === 0) return;

  const primaryElement = blocks[0].element;

  // 🔥 检查扩展上下文
  if (!isExtensionContextValid()) {
    showContextInvalidatedWarning();
    stopTranslation();
    return;
  }

  // 🔥 立即检查是否应该停止
  if (!state.isActive || state.shouldStop) {
    blocks.forEach(b => removePendingMark(b.element));
    return;
  }

  // 🔥 关键去重
  const pendingBlocks = [];
  for (const block of blocks) {
    if (isAlreadyTranslated(block.element)) {
      removePendingMark(block.element);
    } else if (!state.retryPolicy.getStatus(
      block.element,
      getBlockRetryFingerprint(block)
    ).allowed) {
      state.failureCooldownDeferred++;
      removePendingMark(block.element);
    } else if (refreshTranslationBlock(block)) {
      pendingBlocks.push(block);
    } else {
      removePendingMark(block.element);
    }
  }

  if (pendingBlocks.length === 0) {
    return;
  }

  pendingBlocks.forEach(b => markAsTranslating(b.element));

  const requestId = `req_${++state.requestIdCounter}_${Date.now()}`;
  const requestController = new AbortController();
  state.inflightRequests.set(primaryElement, {
    requestId,
    controller: requestController,
    blocks: pendingBlocks
  });

  try {
    console.log(`[OIT] 📤 send translate: ${pendingBlocks.length} texts, requestId: ${requestId}`);
    const response = await sendTimedRuntimeMessage({
        action: 'translate',
        requestId,
        texts: pendingBlocks.map(b => b.text),
        config: state.config,
        context: buildTranslationContext(pendingBlocks)
      }, 'Page translation request timed out', requestController.signal);
    console.log(`[OIT] 📥 response: ${response ? (response.cancelled ? 'cancelled' : (response.translations?.length || 0) + ' translations') : 'null'}`);

    state.inflightRequests.delete(primaryElement);

    if (!response) {
      console.warn('[OIT] No response from background (SW may have terminated)');
      recordTranslationFailure('Background translation service returned no response');
      recordPendingBlockFailures(pendingBlocks);
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
      recordTranslationFailure(response.error);
      recordPendingBlockFailures(pendingBlocks);
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    const translations = response.translations || [];
    let appliedCount = 0;
    pendingBlocks.forEach((block, index) => {
      const translation = translations[index];
      if (!isBlockSourceCurrent(block)) {
        removePendingMark(block.element);
      } else if (typeof translation === 'string'
          && translation.trim()
          && !isSameContent(block.text, translation)
          && applyTranslation(block, translation)) {
        state.translatedCount++;
        state.bodyTranslatedCount++;
        appliedCount++;
        state.completedElements.add(block.element);
        state.retryPolicy.recordSuccess(block.element);
      } else {
        recordBlockTranslationFailure(block);
        // 失败内容在策略窗口内不会随扫描再次提交。
        removePendingMark(block.element);
      }
    });
    if (appliedCount === 0) {
      recordTranslationFailure('Provider returned no usable translations');
    }

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
    if (error.name === 'AbortError'
        || error.message?.toLowerCase().includes('abort')) {
      pendingBlocks.forEach(b => removePendingMark(b.element));
      return;
    }

    // Runtime messaging has no abort signal, so explicitly cancel the worker.
    if (requestId) {
      abortRuntimeRequest(requestId);
    }
    console.error('[OIT] Translation failed:', error);
    recordTranslationFailure(error);
    recordPendingBlockFailures(pendingBlocks);
    pendingBlocks.forEach(b => removePendingMark(b.element));
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
  
  const listen = (target, capture = false) => {
    const options = { passive: true, capture };
    target.addEventListener('scroll', state.scrollHandler, options);
    state.scrollTargets.set(target, options);
  };

  // Capture scroll events from window-level and class-driven nested scrollers
  // without enumerating containers that may be created later by an SPA.
  listen(document, true);
  listen(window);
  
  sendLog('👁️ 已启动滚动监听', 'info');
}

/**
 * 扫描视口并加入队列
 */
function scanViewportAndQueue() {
  if (!state.isActive || state.shouldStop) return;

  const newBlocks = collectViewportBlocks();
  syncShadowObservers();
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
    !state.processedElements.has(b.element) &&
    !state.completedElements.has(b.element)
  );
  
  if (newBlocks.length > 0) {
    sendLog(`📋 后台发现 ${newBlocks.length} 个文本块`, 'info');
    observeBlocks(newBlocks);
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
function getMutationElement(node) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
  return node.host || null;
}

function getTranslationRecordHost(node) {
  const element = getMutationElement(node);
  if (!element) return null;

  let current = element;
  while (current) {
    if (translationRecords.has(current)) return current;
    current = pageScanner.getComposedParentElement(current);
  }
  return pageScanner.composedClosest(
    element,
    '.oit-translated-host, .oit-pending, .oit-translating-text'
  );
}

function isInsideTranslationOutput(node) {
  const element = getMutationElement(node);
  return Boolean(pageScanner.composedClosest(element, TRANSLATION_OUTPUT_SELECTOR));
}

function isOwnedMutationNode(node) {
  if (node?.nodeType === Node.TEXT_NODE) return !/\S/.test(node.nodeValue || '');
  if (node?.nodeType !== Node.ELEMENT_NODE) return true;
  return node.matches(OWNED_MUTATION_NODE_SELECTOR);
}

function classTokensWithoutExtensionState(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(token => token && !OWNED_HOST_CLASS_TOKENS.has(token))
    .sort()
    .join(' ');
}

function isOwnedClassMutation(mutation) {
  if (mutation.attributeName !== 'class' || typeof mutation.oldValue !== 'string') {
    return false;
  }
  const current = mutation.target.getAttribute?.('class') || '';
  return classTokensWithoutExtensionState(mutation.oldValue)
    === classTokensWithoutExtensionState(current);
}

function isOwnedTextApplicationMutation(mutation, record) {
  if (!record) return false;
  if (mutation.type === 'characterData' && record.kind === 'in-place') {
    const text = mutation.target;
    return (record.texts || []).some(part => (
      part.node === text && text.data === part.translated
    ));
  }
  if (mutation.type !== 'childList' || record.kind !== 'plain-text-in-place') {
    return false;
  }
  if (mutation.target !== record.host || mutation.addedNodes.length !== 1) return false;
  const node = mutation.addedNodes[0];
  return node.nodeType === Node.TEXT_NODE && node.nodeValue === record.appliedText;
}

function isInternalSourceLayoutMutation(mutation, record) {
  const layout = pageScanner.composedClosest(
    getMutationElement(mutation.target),
    SOURCE_LAYOUT_SELECTOR
  );
  if (!layout) return false;
  if (layout.classList.contains('oit-direct-text-run') && !record) return true;
  if (!record || typeof record.sourceHtml !== 'string') return true;
  return layout.innerHTML === record.sourceHtml;
}

function hasMeaningfulAddedNode(mutation) {
  return Array.from(mutation.addedNodes || []).some(node => (
    !isOwnedMutationNode(node)
  ));
}

function invalidateTranslationSource(host) {
  if (!host?.isConnected) return false;
  translationSourceState.invalidate(host);

  const record = translationRecords.get(host);
  if (record) {
    try {
      if (record.kind === 'plain-text-bilingual' || record.kind === 'plain-text-in-place') {
        restorePlainTextTranslation(record);
      } else {
        translationCore.restoreTranslationView(record);
      }
    } catch (error) {
      console.warn('[OIT] Failed to restore stale translation:', error.message);
    }
  }

  translationRecords.delete(host);
  translatedCheckCache.delete(host);
  state.completedElements.delete(host);
  state.processedElements.delete(host);
  state.blockMap.delete(host);
  state.retryPolicy.recordSuccess(host);
  state.translationQueue.remove(block => block.element === host);
  removePendingMark(host);
  pageScanner.invalidateScanCache(state.scanContext, host);
  return Boolean(record);
}

function hasHiddenClass(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .some(token => HIDDEN_CLASS_TOKENS.has(token.toLowerCase()));
}

function hasHiddenInlineStyle(value) {
  const style = String(value || '');
  return /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i.test(style)
    || /(?:^|;)\s*visibility\s*:\s*hidden\s*(?:!important\s*)?(?:;|$)/i.test(style)
    || /(?:^|;)\s*content-visibility\s*:\s*hidden\s*(?:!important\s*)?(?:;|$)/i.test(style);
}

function attributeMutationRevealsContent(mutation) {
  const attribute = mutation.attributeName;
  if (DYNAMIC_STRUCTURE_ATTRIBUTES.has(attribute)) return true;
  if (!['class', 'style'].includes(attribute)) return false;
  if (typeof mutation.oldValue !== 'string') return false;

  const currentValue = mutation.target.getAttribute?.(attribute) || '';
  if (attribute === 'class') {
    return hasHiddenClass(mutation.oldValue) && !hasHiddenClass(currentValue);
  }
  return hasHiddenInlineStyle(mutation.oldValue)
    && !hasHiddenInlineStyle(currentValue);
}

function handleDynamicMutations(mutations) {
  if (!state.isActive || state.shouldStop) return;
  let hasNewContent = false;

  for (const mutation of mutations) {
    const target = getMutationElement(mutation.target);
    const translationHost = getTranslationRecordHost(target);
    const record = translationHost ? translationRecords.get(translationHost) : null;
    let ignored = false;

    if (mutation.type === 'characterData') {
      ignored = isInsideTranslationOutput(mutation.target)
        || isOwnedTextApplicationMutation(mutation, record);
      const hasText = /\S/.test(mutation.target.nodeValue || '');
      if (target && !ignored && hasText) {
        const root = translationHost || target;
        if (translationHost) invalidateTranslationSource(translationHost);
        state.pendingDynamicRoots.add(root);
        hasNewContent = true;
      }
    } else if (mutation.type === 'attributes') {
      ignored = isInsideTranslationOutput(target) || isOwnedClassMutation(mutation);
      if (target && !ignored && attributeMutationRevealsContent(mutation)) {
        state.pendingDynamicRoots.add(target);
        hasNewContent = true;
      }
    } else if (mutation.type === 'childList'
        && mutation.addedNodes.length > 0
        && !isInsideTranslationOutput(mutation.target)) {
      const announcedNodes = Array.from(mutation.addedNodes)
        .filter(node => !isOwnedMutationNode(node));
      ignored = announcedNodes.length === 0
        || isInternalSourceLayoutMutation(mutation, record);
      if (!ignored && announcedNodes.length > 0) {
        if (translationHost) {
          invalidateTranslationSource(translationHost);
          state.pendingDynamicRoots.add(translationHost);
          hasNewContent = true;
        } else {
          for (const node of announcedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              state.pendingDynamicRoots.add(node);
              hasNewContent = true;
            } else if (node.nodeType === Node.TEXT_NODE
                && /\S/.test(node.nodeValue || '')
                && target) {
              state.pendingDynamicRoots.add(target);
              hasNewContent = true;
            }
          }
        }
      }
    } else {
      ignored = isInsideTranslationOutput(mutation.target);
    }

    const sample = {
      type: mutation.type,
      attribute: mutation.attributeName || null,
      tag: target?.tagName || null,
      id: target?.id || null,
      className: target?.className || null,
      ignored
    };
    const shouldSample = !ignored
      || ['hidden', 'aria-hidden', 'aria-expanded', 'open'].includes(sample.attribute);
    if (shouldSample && state.dynamicDiagnostics.mutationSamples.length < 30) {
      state.dynamicDiagnostics.mutationSamples.push(sample);
    }
    if (ignored) {
      state.dynamicDiagnostics.ignoredMutations++;
    } else if (!hasNewContent) {
      state.dynamicDiagnostics.suppressedMutations++;
    }
  }

  if (!hasNewContent) return;
  state.dynamicDiagnostics.mutationBatches++;
  if (!state.mutationTimer) {
    state.mutationTimer = setTimeout(processDynamicRoots, CONFIG.MUTATION_DEBOUNCE);
  }
}

function startMutationObserver() {
  if (state.mutationObserver) return;
  ensureScanContext();

  state.mutationHandler = handleDynamicMutations;
  state.mutationObserver = new MutationObserver(state.mutationHandler);
  state.mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: CONFIG.MUTATION_ATTRIBUTES
  });
  syncShadowObservers();
}

function syncShadowObservers(options = {}) {
  if (!state.scanContext) return;
  pageScanner.refreshOpenShadowRoots(
    document.body,
    state.scanContext,
    { force: options.force === true }
  );

  for (const shadowRoot of Array.from(state.scanContext.openShadowRoots)) {
    if (!shadowRoot.host?.isConnected) {
      state.scanContext.openShadowRoots.delete(shadowRoot);
      state.shadowObservers.get(shadowRoot)?.disconnect();
      state.shadowObservers.delete(shadowRoot);
      state.shadowRoots.delete(shadowRoot);
      continue;
    }
    if (state.shadowObservers.has(shadowRoot)) continue;
    const observer = new MutationObserver(state.mutationHandler || handleDynamicMutations);
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: CONFIG.MUTATION_ATTRIBUTES
    });
    state.shadowObservers.set(shadowRoot, observer);
    state.shadowRoots.add(shadowRoot);
  }
}

function getTopLevelDynamicRoots(roots) {
  const list = Array.from(roots).filter(root => root?.isConnected);
  return list.filter((root, index) => !list.some((other, otherIndex) => {
    return otherIndex !== index && pageScanner.composedContains(other, root);
  }));
}

function processDynamicRoots() {
  state.mutationTimer = null;
  if (!state.isActive || state.shouldStop) return;
  ensureScanContext();

  const roots = getTopLevelDynamicRoots(state.pendingDynamicRoots);
  state.pendingDynamicRoots.clear();
  state.dynamicDiagnostics.roots += roots.length;
  for (const root of roots) {
    if (state.dynamicDiagnostics.rootSamples.length >= 20) break;
    state.dynamicDiagnostics.rootSamples.push({
      type: root.nodeType,
      tag: root.tagName || null,
      id: root.id || null,
      role: root.getAttribute?.('role') || null,
      className: root.className || null,
      hidden: root.hidden === true
    });
  }
  const blocks = [];
  const seen = new Set();

  for (const root of roots) {
    state.dynamicDiagnostics.scanRuns++;
    const candidates = pageScanner.collectDynamicCandidates(root, state.scope, {
      context: state.scanContext,
      contentRoot: state.contentRoot
    });
    state.dynamicDiagnostics.candidates += candidates.length;
    for (const candidate of candidates) {
      if (!candidate.element || seen.has(candidate.element)) continue;
      seen.add(candidate.element);
      const block = createBlockFromCandidate(candidate);
      if (block) blocks.push(block);
    }
  }
  state.dynamicDiagnostics.blocks += blocks.length;

  state.contentRoot = state.scanContext.contentRoot || document.body;
  syncShadowObservers();

  let added = 0;
  const deferred = [];
  for (const block of blocks) {
    const rect = block.element.getBoundingClientRect();
    if (rect.bottom >= -window.innerHeight * 0.15
        && rect.top <= window.innerHeight * 1.5) {
      if (addToQueue(block)) added++;
    } else {
      deferred.push(block);
    }
  }

  if (deferred.length) observeBlocks(deferred);
  if (added > 0) {
    reorderQueue();
    if (!tryPumpVisibleNow()) processQueue();
  }
  scheduleTranslationCompletionCheck();
}

const PROTECTED_TOKEN_FILTER = /\[\[OIT-[A-Z0-9]+:(?:OPEN|CLOSE|ATOM):\d+\]\]/g;

function getTemplateVisibleText(template) {
  return translationCore.normalizeWhitespace(
    String(template?.text || '').replace(PROTECTED_TOKEN_FILTER, ' ')
  );
}

function prepareTranslationBlock(element, extras = {}, options = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  if (!element.isConnected || state.completedElements.has(element)) return null;
  if (isInsideOwnedTranslation(element)) return null;
  const plainText = extras.kind === 'plain-text';
  if (!plainText && CONFIG.SKIP_TAGS.has(element.tagName)) return null;
  if (CONFIG.SKIP_CLASSES.some(className => element.classList.contains(className))) return null;
  if (!options.allowQueued
      && (element.classList.contains('oit-pending')
        || element.classList.contains('oit-translating-text'))) {
    return null;
  }
  if (element.closest('picture, source')) return null;

  if (plainText) {
    const text = translationCore.normalizeWhitespace(element.textContent);
    if (text.length < CONFIG.MIN_TEXT_LENGTH || text.length > CONFIG.MAX_TEXT_LENGTH) return null;
    if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(text) || REGEX_PATTERNS.URL_EMAIL.test(text)) return null;
    if (state.config?.autoDetect && isTargetLanguage(text)) return null;
    return {
      element,
      textNode: null,
      text,
      template: null,
      inlineTemplate: null,
      inPlaceTemplate: null,
      sourceSnapshot: translationSourceState.capture(element, text),
      ...extras
    };
  }

  const inlineTemplate = translationCore.buildInlineTemplate(element);
  if (!inlineTemplate) return null;
  const inPlaceTemplate = state.config?.showOriginal === false
    ? translationCore.buildTextFlowTemplate(element)
    : null;
  const template = inPlaceTemplate || inlineTemplate;

  const visibleText = getTemplateVisibleText(template);
  if (visibleText.length < CONFIG.MIN_TEXT_LENGTH || visibleText.length > CONFIG.MAX_TEXT_LENGTH) return null;
  if (REGEX_PATTERNS.ONLY_PUNCTUATION.test(visibleText)) return null;
  if (REGEX_PATTERNS.URL_EMAIL.test(visibleText)) return null;
  if (!/\p{L}/u.test(visibleText)) return null;
  if (state.config?.autoDetect && isTargetLanguage(visibleText)) return null;
  if (/srcset|data-src|<\w+\s|https?:\/\/.*\.(jpe?g|png|webp|gif)/i.test(visibleText)) return null;

  const isPrimaryTag = /^(H[1-6]|P|BLOCKQUOTE|FIGCAPTION)$/.test(element.tagName);
  const isSupplementalContent = extras.siteRole === 'supplemental-content';
  const isInterfaceLabel = extras.siteRole === 'navigation-label'
    || Boolean(element.closest(
      'nav, header, footer, button, a[href], [role="button"], [role="link"], '
        + '[role="menuitem"], [role="menubar"], [role="tab"], [role="tablist"], '
        + '[role="toolbar"]'
    ));
  const shortTextFloor = isInterfaceLabel || isSupplementalContent ? 2 : 5;
  if (!isPrimaryTag && visibleText.length < shortTextFloor) return null;
  if (isInBoilerplateContainer(element)
      && !isInterfaceLabel
      && !isSupplementalContent
      && visibleText.length < (isPrimaryTag ? 12 : 25)) {
    return null;
  }

  return {
    element,
    textNode: null,
    text: template.text,
    template,
    inlineTemplate,
    inPlaceTemplate,
    sourceSnapshot: translationSourceState.capture(element, visibleText),
    ...extras
  };
}

/**
 * 收集视口内可见的文本块（增强版 - 支持各类 SPA）
 * 去重以元素为单位，相同文本在不同节点上仍会分别翻译。
 */
function ensureScanContext() {
  if (state.scanContext) return state.scanContext;
  state.scope = state.config?.translationScope === 'full' ? 'full' : 'smart';
  state.scanContext = pageScanner.createScanContext({ scope: state.scope });
  pageScanner.refreshOpenShadowRoots(
    document.body,
    state.scanContext,
    { force: true }
  );
  return state.scanContext;
}

function createBlockFromCandidate(candidate) {
  if (!candidate?.element) return null;
  return prepareTranslationBlock(candidate.element, {
    kind: candidate.kind,
    role: candidate.role,
    reason: candidate.reason,
    container: candidate.container,
    parent: candidate.parent,
    order: candidate.order,
    headingTrail: candidate.headingTrail || [],
    nearbyText: candidate.nearbyText || '',
    tableContext: candidate.tableContext || '',
    itemContext: candidate.context || '',
    site: candidate.site || null,
    siteRole: candidate.siteRole || null,
    isTwitter: candidate.site === 'x' && candidate.siteRole === 'post-body'
  });
}

function isCandidateInViewportScan(candidate, viewportHeight) {
  if (!candidate?.element?.isConnected) return false;
  const rect = candidate.element.getBoundingClientRect();
  const isNavigation = candidate.siteRole === 'navigation-label';
  const topLimit = isNavigation ? viewportHeight : viewportHeight * 0.8;
  const bottomLimit = isNavigation ? 0 : -viewportHeight * 0.1;
  return rect.width > 0
    && rect.height > 0
    && rect.bottom >= bottomLimit
    && rect.top <= topLimit;
}

function collectViewportBlocks() {
  const blocks = [];
  const viewportHeight = window.innerHeight;
  ensureScanContext();
  const candidates = pageScanner.collectPageCandidates(state.scope, {
    context: state.scanContext,
    discoverShadowRoots: false
  });
  state.contentRoot = state.scanContext.contentRoot || document.body;

  // Persistent navigation and supplemental page content have explicit quotas.
  // A large reading root cannot consume the first-pass budget before either
  // domain is considered, while unused capacity still flows to body content.
  const domainQuotas = {
    navigation: 40,
    supplemental: 80
  };
  let navigationCount = 0;
  let supplementalCount = 0;
  for (const candidate of candidates) {
    if (candidate.siteRole !== 'navigation-label') continue;
    if (navigationCount >= domainQuotas.navigation) continue;
    if (!isCandidateInViewportScan(candidate, viewportHeight)) continue;
    const block = createBlockFromCandidate(candidate);
    if (block) {
      blocks.push(block);
      navigationCount++;
    }
  }

  for (const candidate of candidates) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    if (candidate.siteRole !== 'supplemental-content') continue;
    if (supplementalCount >= domainQuotas.supplemental) continue;
    if (!isCandidateInViewportScan(candidate, viewportHeight)) continue;
    const block = createBlockFromCandidate(candidate);
    if (block) {
      blocks.push(block);
      supplementalCount++;
    }
  }

  for (const candidate of candidates) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    if (candidate.siteRole === 'navigation-label'
        || candidate.siteRole === 'supplemental-content') {
      continue;
    }
    if (!isCandidateInViewportScan(candidate, viewportHeight)) continue;
    const block = createBlockFromCandidate(candidate);
    if (block) blocks.push(block);
  }

  blocks.sort((a, b) => {
    const aRect = a.element.getBoundingClientRect();
    const bRect = b.element.getBoundingClientRect();
    return aRect.top - bRect.top || (a.order || 0) - (b.order || 0);
  });

  console.log(`[OIT] ${state.scope} viewport scan: found ${blocks.length} blocks`);
  return blocks;
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
// 🔥 性能优化: 使用WeakMap缓存翻译检查结果
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

  // 只检查元素自身或祖先，不能因为某个子元素已翻译就跳过整个容器。
  if (translationRecordsHas(element) || isInsideOwnedTranslation(element)) {
    translatedCheckCache.set(element, true);
    return true;
  }

  // 3. 检查父元素链 (最慢的操作,放最后)
  let parent = pageScanner.getComposedParentElement(element);
  while (parent && parent !== document.body) {
    if (state.completedElements.has(parent) ||
        translationRecords.has(parent) ||
        parent.classList?.contains('oit-translated-host')) {
      translatedCheckCache.set(element, true);
      return true;
    }
    parent = pageScanner.getComposedParentElement(parent);
  }

  // 缓存负面结果
  translatedCheckCache.set(element, false);
  return false;
}

function translationRecordsHas(element) {
  return translationRecords.has(element) || element.classList?.contains('oit-translated-host');
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
            !isInsideOwnedTranslation(node)) {
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
  state.lifecycle.stop();

  // 🔥 取消所有进行中的请求
  cancelDocumentTitleRequest();
  hideFloating();
  cancelAllInflightRequests('user stopped');

  // 🔥 立即清空翻译队列，防止继续处理旧任务
  state.translationQueue.clear();
  state.isProcessing = false;
  state.requestScheduler.reset();
  syncTranslationSchedulerState();

  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }

  if (state.mutationObserver) {
    state.mutationObserver.disconnect();
    state.mutationObserver = null;
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
  state.lifecycle.stop();
  console.log('[OpenImmerseTranslate] Translation stopped, queue cleared');
}

/**
 * 取消所有进行中的翻译请求
 */
function cancelAllInflightRequests(reason = 'cancelled') {
  for (const [, { requestId, controller }] of state.inflightRequests) {
    controller?.abort();
    abortRuntimeRequest(requestId);
  }
  state.inflightRequests.clear();
}

/**
 * Collect every in-scope candidate through the same scanner used by
 * viewport and dynamic scans. This keeps smart/full semantics consistent.
 */
function collectTextBlocks() {
  ensureScanContext();
  const candidates = pageScanner.collectPageCandidates(state.scope, {
    context: state.scanContext,
    discoverShadowRoots: false
  });
  state.contentRoot = state.scanContext.contentRoot || document.body;
  return candidates
    .map(createBlockFromCandidate)
    .filter(Boolean);
}

/**
 * 创建 Intersection Observer
 * 当元素进入视口时触发翻译
 */
function createObserver(textBlocks) {
  // 创建元素到文本块的映射
  textBlocks.forEach(block => {
    state.blockMap.set(block.element, block);
  });

  if (state.observer) {
    textBlocks.forEach(block => state.observer.observe(block.element));
    return;
  }
  
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

function observeBlocks(blocks) {
  if (!blocks?.length) return;
  createObserver(blocks);
  blocks.forEach(block => {
    state.processedElements.add(block.element);
    state.blockMap.set(block.element, block);
    state.observer?.observe(block.element);
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
function applyPlainTextTranslation(block, translation) {
  const host = block.element;
  const sourceText = host.textContent;
  const showOriginal = state.config?.showOriginal !== false;
  const doc = host.ownerDocument;
  const hadHostClass = host.classList.contains('oit-translated-host');
  const hadClassAttribute = host.hasAttribute('class');

  if (showOriginal) {
    const translationNode = doc.createElement('pre');
    translationNode.className = 'oit-translation oit-plaintext-translation';
    translationNode.textContent = translation;
    host.insertAdjacentElement('afterend', translationNode);
    if (!hadHostClass) host.classList.add('oit-translated-host');
    return {
      kind: 'plain-text-bilingual',
      host,
      sourceText,
      translationNode,
      hadHostClass,
      hadClassAttribute
    };
  }

  host.textContent = translation;
  if (!hadHostClass) host.classList.add('oit-translated-host');
  return {
    kind: 'plain-text-in-place',
    host,
    sourceText,
    appliedText: translation,
    hadHostClass,
    hadClassAttribute
  };
}

function restorePlainTextTranslation(record) {
  if (!record?.host) return false;
  let restored = false;
  if (record.kind === 'plain-text-bilingual') {
    if (record.translationNode?.parentNode) {
      record.translationNode.remove();
      restored = true;
    }
  } else if (record.kind === 'plain-text-in-place'
      && record.host.textContent === record.appliedText) {
    record.host.textContent = record.sourceText;
    restored = true;
  }

  if (!record.hadHostClass && record.host.classList.contains('oit-translated-host')) {
    record.host.classList.remove('oit-translated-host');
  }
  if (!record.hadClassAttribute && record.host.classList.length === 0) {
    record.host.removeAttribute('class');
  }
  return restored;
}

function applyTranslation(block, translation) {
  const { element, text, inlineTemplate, inPlaceTemplate } = block;
  if (!isBlockSourceCurrent(block)) {
    removePendingMark(element);
    return false;
  }
  
  // 移除待翻译标记
  removePendingMark(element);
  
  // 🔥 关键去重检查（防止重复翻译）
  if (isAlreadyTranslated(element)) {
    console.log('[OIT] Skipping duplicate translation for:', text?.substring(0, 30));
    return false;
  }

  try {
    const record = block.kind === 'plain-text'
      ? applyPlainTextTranslation(block, translation)
      : (() => {
        const showOriginal = state.config?.showOriginal !== false;
        return !showOriginal && inPlaceTemplate
          ? translationCore.applyTranslationInPlace(element, translation, inPlaceTemplate)
          : translationCore.createTranslationView(element, translation, inlineTemplate, {
            showOriginal,
            keepTranslationInHost: block.siteRole === 'navigation-label',
            dark: isDarkBackground(element) || isDarkMode()
          });
      })();
    if (!record) {
      console.warn('[OIT] Translation did not match the current source structure');
      return false;
    }
    translationRecords.set(element, record);
    translatedCheckCache.set(element, true);
    return true;
  } catch (error) {
    console.warn('[OIT] Could not apply translated DOM safely:', error.message);
    return false;
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

  translationRecords.forEach(record => {
    try {
      if (record.kind === 'plain-text-bilingual' || record.kind === 'plain-text-in-place') {
        restorePlainTextTranslation(record);
      } else {
        translationCore.restoreTranslationView(record);
      }
    } catch (error) {
      console.warn('[OIT] Failed to restore a translated node:', error.message);
    }
  });
  translationRecords.clear();
  pageScanner.unwrapAllDirectTextRuns(document);
  restoreDocumentTitle();

  // Clean up records left by an older content script after an extension update.
  document.querySelectorAll('.oit-translated-host').forEach(host => {
    host.querySelectorAll(':scope > .oit-translation').forEach(node => node.remove());
    const original = host.querySelector(':scope > .oit-original');
    if (original) {
      while (original.firstChild) host.insertBefore(original.firstChild, original);
      original.remove();
    }
    host.classList.remove('oit-translated-host', 'oit-dark');
  });

  document.querySelectorAll('.oit-wrapper').forEach(wrapper => {
    if (wrapper.querySelector(':scope > .oit-original')) {
      const original = wrapper.querySelector(':scope > .oit-original');
      original.replaceWith(...original.childNodes);
    } else {
      wrapper.querySelectorAll(':scope > .oit-translation').forEach(node => node.remove());
    }
    wrapper.classList.remove('oit-wrapper', 'oit-dark');
  });

  state.fullReset();
  
  console.log('[OpenImmerseTranslate] Translations removed');
}

// ==================== 通知函数 ====================

function notifyComplete() {
  const hasTranslations = hasOwnedTranslations();
  const lifecycle = state.lifecycle.snapshot();
  
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('completed');
  }
  
  // 安全发送消息
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      action: 'translationComplete',
      count: state.translatedCount,
      hasTranslations: hasTranslations,
      phase: lifecycle.phase,
      sessionActive: state.isActive
    }).catch(() => {});
  }
}

function notifyError(error) {
  const lifecycle = state.lifecycle.snapshot();
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('error');
  }
  
  // 安全发送消息
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      action: 'translationError',
      error: error,
      phase: lifecycle.phase,
      sessionActive: state.isActive,
      hasTranslations: hasOwnedTranslations(),
      translatedCount: state.translatedCount
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
  cancelSelectionRequest();
  if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
  if (floatingPanel) { floatingPanel.remove(); floatingPanel = null; }
  // 🔥 移除事件监听器时也要指定 capture 参数，与添加时保持一致
  document.removeEventListener('mousedown', hideOnClickOutside, true);
}

function cancelSelectionRequest() {
  selectionRequestToken++;
  const request = selectionInflightRequest;
  selectionInflightRequest = null;
  if (!request) return;

  request.controller.abort();
  abortRuntimeRequest(request.requestId);
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

  cancelSelectionRequest();

  // 清理可能存在的旧面板
  if (floatingPanel) {
    floatingPanel.remove();
    floatingPanel = null;
  }

  const token = ++selectionRequestToken;
  const requestId = `selection_${token}_${Date.now()}`;
  const controller = new AbortController();

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

  const panel = document.createElement('div');
  panel.className = 'oit-floating-panel';
  panel.innerHTML = `<div class="oit-panel-loading"><div class="oit-spinner"></div><span>翻译中...</span></div>`;
  panel.style.cssText = `position:fixed;left:${panelX}px;top:${panelY}px;z-index:2147483647;`;

  document.body.appendChild(panel);
  floatingPanel = panel;
  const request = { requestId, token, controller, panel };
  selectionInflightRequest = request;

  try {
    // 🔥 使用新配置系统
    const config = await loadFullConfig();
    if (token !== selectionRequestToken || floatingPanel !== panel) return;

    // 检查是否需要 API Key
    const needsApiKey = checkNeedsApiKey(config.provider);
    if (needsApiKey && !config.apiKey) {
      panel.innerHTML = `<div class="oit-panel-error">请先在插件设置中配置 API 密钥</div>`;
      return;
    }

    const response = await sendTimedRuntimeMessage({
      action: 'translate',
      requestId,
      texts: [text],
      config,
      context: { scene: 'selection' }
    }, 'Selection translation timed out', controller.signal);

    if (token !== selectionRequestToken || floatingPanel !== panel) return;

    if (!response || response.cancelled) {
      throw new Error('Translation was cancelled');
    }
    if (response.error) throw new Error(response.error);

    const translation = response.translations[0];
    if (!translationCore.isPlausibleTranslation(text, translation, { scene: 'selection' })) {
      throw new Error('Selection translation exceeded the requested scope');
    }

    panel.innerHTML = `
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

    panel.querySelector('.oit-copy-btn').onclick = () => {
      navigator.clipboard.writeText(translation);
      const btn = panel.querySelector('.oit-copy-btn');
      const originalContent = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" style="color:#34C759">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
        </svg>
        <span style="color:#34C759">已复制</span>`;
      setTimeout(() => {
        if (floatingPanel === panel) btn.innerHTML = originalContent;
      }, 2000);
    };
    panel.querySelector('.oit-close-btn').onclick = hideFloating;

  } catch (error) {
    if (token !== selectionRequestToken || floatingPanel !== panel) return;
    if (error.name === 'TimeoutError') {
      abortRuntimeRequest(requestId);
    }
    if (error.name === 'AbortError') return;

    // 🔥 检查上下文失效错误
    if (error.message?.includes('Extension context invalidated')) {
      showContextInvalidatedWarning();
      panel.innerHTML = `<div class="oit-panel-error">请刷新页面后重试</div>`;
    } else {
      panel.innerHTML = `<div class="oit-panel-error">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    if (selectionInflightRequest === request) {
      selectionInflightRequest = null;
    }
  }
}

// ==================== 悬浮翻译按钮 (FAB) ====================

let fab = null;
let fabStatusTimer = null;
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
    state.lifecycle.stop();
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
    translationScope: globalConfig.translationScope === 'full' ? 'full' : 'smart',
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
    translationScope: 'smart',
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
  if (fabStatusTimer) {
    clearTimeout(fabStatusTimer);
    fabStatusTimer = null;
  }
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
  if (fabStatusTimer) {
    clearTimeout(fabStatusTimer);
    fabStatusTimer = null;
  }
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
  if (fabStatusTimer) {
    clearTimeout(fabStatusTimer);
    fabStatusTimer = null;
  }
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
      fabStatusTimer = setTimeout(() => {
        fabStatusTimer = null;
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
