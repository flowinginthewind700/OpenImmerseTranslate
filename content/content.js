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

// ==================== 配置常量 ====================
const CONFIG = {
  // 视口检测
  ROOT_MARGIN: '50% 0px 150% 0px', // 上方50% + 下方150%
  THRESHOLD: 0.01,
  
  // 🚀 流式翻译配置（核心优化）
  MAX_CONCURRENT: 6, // 最大并发翻译数（单条）
  SINGLE_TRANSLATE: true, // 启用单条翻译模式（流式显示）
  SCAN_INTERVAL: 150, // 滚动扫描间隔(ms)
  SCROLL_DEBOUNCE: 100, // 滚动防抖(ms)
  
  // 动态内容
  MUTATION_DEBOUNCE: 200,
  
  // 扫描限制
  MAX_VIEWPORT_SCAN: 300,
  MAX_QUEUE_SIZE: 100, // 队列最大长度
  
  // 文本过滤
  MIN_TEXT_LENGTH: 2,
  MAX_TEXT_LENGTH: 5000,
  
  // 跳过的标签
  SKIP_TAGS: new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'AREA',
    'CODE', 'PRE', 'KBD', 'VAR', 'SAMP', 'INPUT', 'TEXTAREA',
    'SELECT', 'IMG', 'BR', 'HR', 'META', 'LINK', 'HEAD', 'TITLE'
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
    
    // 🚀 流式翻译队列
    this.translationQueue = []; // 待翻译队列
    this.activeTranslations = 0; // 当前并发数
    this.isProcessing = false; // 是否正在处理队列
  }
  
  reset() {
    this.isActive = false;
    this.shouldStop = false;
    this.translatedCount = 0;
    this.processedTexts.clear();
    this.blockMap.clear();
    this.translationQueue = [];
    this.activeTranslations = 0;
    this.isProcessing = false;
    
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.mutationTimer) {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = null;
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

// 广播翻译状态变化
function broadcastState(status) {
  try {
    // 检查页面是否有已翻译的内容
    const hasTranslations = document.querySelectorAll('.oit-wrapper').length > 0;
    chrome.runtime.sendMessage({
      action: 'translationStateChanged',
      status: status,
      isTranslating: state.isActive,
      hasTranslations: hasTranslations,
      translatedCount: state.translatedCount
    });
  } catch (e) {
    // popup 可能已关闭，忽略错误
  }
}

// 发送日志到 popup 控制台
function sendLog(text, type = 'info') {
  console.log(`[OpenImmerseTranslate] ${type.toUpperCase()}: ${text}`);
  try {
    chrome.runtime.sendMessage({
      action: 'consoleLog',
      text: text,
      type: type
    });
  } catch (e) {
    // popup 可能已关闭，忽略
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
    
    // 立即开始处理队列（流式）
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
 * 添加到翻译队列
 */
function addToQueue(block) {
  if (!block || !block.element) return;
  if (state.completedElements.has(block.element)) return;
  if (state.translationQueue.some(b => b.element === block.element)) return;
  
  // 限制队列大小
  if (state.translationQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    state.translationQueue.shift(); // 移除最旧的
  }
  
  state.translationQueue.push(block);
  markAsPending(block.element);
}

/**
 * 处理翻译队列（流式）
 * 🔥 核心：并发控制 + 即时显示
 */
async function processQueue() {
  if (state.isProcessing) return;
  if (!state.isActive || state.shouldStop) return;
  
  state.isProcessing = true;
  
  while (state.translationQueue.length > 0 && state.isActive && !state.shouldStop) {
    // 并发控制：等待有空闲槽位
    while (state.activeTranslations >= CONFIG.MAX_CONCURRENT) {
      await sleep(50);
      if (!state.isActive || state.shouldStop) break;
    }
    
    if (!state.isActive || state.shouldStop) break;
    
    // 取出一个任务
    const block = state.translationQueue.shift();
    if (!block || state.completedElements.has(block.element)) continue;
    
    // 异步翻译（不等待，立即处理下一个）
    translateSingle(block);
  }
  
  state.isProcessing = false;
}

/**
 * 单条翻译（异步，不阻塞）
 */
async function translateSingle(block) {
  state.activeTranslations++;
  markAsTranslating(block.element);
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      texts: [block.text],
      config: state.config
    });
    
    if (!state.isActive || state.shouldStop) return;
    
    if (response.error) {
      console.error('[OIT] Translation error:', response.error);
      removePendingMark(block.element);
      return;
    }
    
    const translation = response.translations?.[0];
    if (translation && translation !== block.text && !isSameContent(block.text, translation)) {
      applyTranslation(block, translation);
      state.translatedCount++;
      
      // 更新进度（每5个更新一次避免刷屏）
      if (state.translatedCount % 5 === 0) {
        notifyProgress(state.translatedCount, state.translatedCount);
      }
    } else {
      removePendingMark(block.element);
    }
    
    state.completedElements.add(block.element);
    
  } catch (error) {
    console.error('[OIT] Translation failed:', error);
    removePendingMark(block.element);
  } finally {
    state.activeTranslations--;
    
    // 如果队列还有内容，继续处理
    if (state.translationQueue.length > 0 && !state.isProcessing) {
      processQueue();
    }
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
    if (state.completedElements.has(block.element)) return;
    if (state.translationQueue.some(b => b.element === block.element)) return;
    
    addToQueue(block);
    addedCount++;
  });
  
  if (addedCount > 0) {
    sendLog(`🔄 发现 ${addedCount} 个新文本`, 'info');
    processQueue();
  }
}

/**
 * 定期全面扫描（补漏）
 */
function startPeriodicScan() {
  // 每 2 秒进行一次补充扫描
  setInterval(() => {
    if (!state.isActive || state.shouldStop) return;
    if (state.translationQueue.length > 20) return; // 队列满时跳过
    
    scanViewportAndQueue();
  }, 2000);
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
              !node.classList?.contains('oit-pending')) {
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
 */
function collectViewportBlocks() {
  const blocks = [];
  const viewportHeight = window.innerHeight;
  const seenInThisScan = new Set(); // 本次扫描内去重
  
  // 第一步：优先处理 Twitter/X 的推文内容
  const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
  for (const el of tweetTexts) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    if (state.completedElements.has(el)) continue; // 只用 completedElements 去重
    if (el.closest('.oit-wrapper') || el.classList.contains('oit-pending')) continue;
    
    const rect = el.getBoundingClientRect();
    // 视口检测：当前视口上下各扩展 50%
    if (rect.bottom < -viewportHeight * 0.5 || rect.top > viewportHeight * 1.5) continue;
    
    const text = el.textContent?.trim();
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (text.length > CONFIG.MAX_TEXT_LENGTH) continue;
    if (seenInThisScan.has(text)) continue;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) continue;
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
  const primarySelectors = 'h1, h2, h3, h4, h5, h6, p, blockquote, figcaption';
  collectElementsWithText(primarySelectors, blocks, viewportHeight, seenInThisScan);
  
  // 第三步：处理列表项和其他容器
  const secondarySelectors = 'li, td, th, dt, dd, label, button, a';
  collectElementsWithText(secondarySelectors, blocks, viewportHeight, seenInThisScan);
  
  // 第四步：处理 span 和 div（只取叶子节点）
  collectLeafTextElements(blocks, viewportHeight, seenInThisScan);
  
  // 按Y坐标排序
  blocks.sort((a, b) => {
    const aRect = a.element.getBoundingClientRect();
    const bRect = b.element.getBoundingClientRect();
    return aRect.top - bRect.top;
  });
  
  console.log(`[OIT] Viewport scan: found ${blocks.length} blocks`);
  return blocks;
}

/**
 * 收集指定选择器的文本元素
 */
function collectElementsWithText(selectors, blocks, viewportHeight, seenInThisScan) {
  const elements = document.querySelectorAll(selectors);
  
  for (const el of elements) {
    if (blocks.length >= CONFIG.MAX_VIEWPORT_SCAN) break;
    
    const rect = el.getBoundingClientRect();
    // 🔥 只检测当前视口附近（上下各50%），不要太远
    if (rect.bottom < -viewportHeight * 0.5 || rect.top > viewportHeight * 1.5) continue;
    if (rect.width === 0 || rect.height === 0) continue;
    
    if (el.closest('.oit-wrapper') || el.classList.contains('oit-pending')) continue;
    if (el.closest('.oit-translation')) continue;
    if (state.completedElements.has(el)) continue;
    
    // 获取元素的完整文本内容（包括嵌套）
    const text = el.textContent?.trim();
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (text.length > CONFIG.MAX_TEXT_LENGTH) continue;
    // 🔥 只用本次扫描的 Set 去重，不用 processedTexts（那个只在翻译完成后才标记）
    if (seenInThisScan && seenInThisScan.has(text)) continue;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) continue;
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;
    
    // 检查是否有直接文本内容（不是纯容器）
    const directText = getDirectTextContent(el);
    const hasDirectText = directText && directText.length >= CONFIG.MIN_TEXT_LENGTH;
    
    // 如果没有直接文本但有嵌套文本，使用整体追加模式
    const useAppendMode = !hasDirectText && text.length >= CONFIG.MIN_TEXT_LENGTH;
    
    if (hasDirectText) {
      const textNode = findTextNode(el, directText);
      if (textNode) {
        if (seenInThisScan) seenInThisScan.add(text);
        blocks.push({ element: el, textNode, text: directText });
      }
    } else if (useAppendMode) {
      if (seenInThisScan) seenInThisScan.add(text);
      blocks.push({ element: el, textNode: null, text, isAppend: true });
    }
  }
}

/**
 * 收集叶子文本节点（span/div 中没有更深子元素的）
 */
function collectLeafTextElements(blocks, viewportHeight, seenInThisScan) {
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
        if (parent.closest('.oit-wrapper') || parent.classList.contains('oit-pending')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (state.completedElements.has(parent)) return NodeFilter.FILTER_REJECT;
        
        // 跳过不需要的标签
        if (CONFIG.SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        
        // 🔥 只检测当前视口附近（上下各50%）
        const rect = parent.getBoundingClientRect();
        if (rect.bottom < -viewportHeight * 0.5 || rect.top > viewportHeight * 1.5) {
          return NodeFilter.FILTER_REJECT;
        }
        if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
        
        // 跳过纯符号
        if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) return NodeFilter.FILTER_REJECT;
        
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
    
    if (seenInThisScan) seenInThisScan.add(text);
    blocks.push({ element: parent, textNode: node, text });
  }
}

/**
 * 标记元素为待翻译状态
 */
function markAsPending(element) {
  if (!element || element.classList.contains('oit-pending')) return;
  
  element.classList.add('oit-pending');
  
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
}

/**
 * 标记元素为翻译中状态
 */
function markAsTranslating(element) {
  if (!element) return;
  element.classList.remove('oit-pending', 'oit-pending-dark');
  element.classList.add('oit-translating-text');
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
  
  state.reset();
  console.log('[OpenImmerseTranslate] Translation stopped');
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
        if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) return NodeFilter.FILTER_REJECT;
        
        // 跳过纯URL或邮箱
        if (/^(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+)/.test(text)) return NodeFilter.FILTER_REJECT;
        
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
    if (/^[\d\s\p{P}\p{S}]+$/u.test(directText)) return;
    
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
          addToQueue(block);
          addedCount++;
          // 停止观察已加入队列的元素
          state.observer?.unobserve(entry.target);
        }
      }
    });
    
    // 如果有新内容加入队列，触发处理
    if (addedCount > 0) {
      processQueue();
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
 */
function parseFriendlyError(errorMsg) {
  const msg = (errorMsg || '').toLowerCase();
  
  // 账户余额不足/暂停
  if (msg.includes('suspended') || msg.includes('insufficient balance') || msg.includes('recharge')) {
    return '⚠️ 账户余额不足或已暂停，请充值后重试';
  }
  
  // API密钥无效
  if (msg.includes('invalid') && msg.includes('key') || msg.includes('401') || msg.includes('unauthorized')) {
    return '🔑 API密钥无效，请检查设置';
  }
  
  // 请求频率限制
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many') || msg.includes('concurrency')) {
    return '⏳ API请求过于频繁，正在自动重试...';
  }
  
  // 配额用尽
  if (msg.includes('quota') || msg.includes('exceeded')) {
    return '📊 API配额已用尽，请检查账户额度';
  }
  
  // 超时
  if (msg.includes('timeout')) {
    return '⏱️ 请求超时，网络可能不稳定';
  }
  
  // 网络错误
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection') || msg.includes('failed to fetch')) {
    return '🌐 网络连接失败，请检查网络';
  }
  
  // 服务器错误
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server error')) {
    return '🔧 AI服务暂时不可用，请稍后重试';
  }
  
  // 模型不存在
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('not exist') || msg.includes('does not exist'))) {
    return '🤖 模型不存在，请检查模型名称';
  }
  
  // 权限问题
  if (msg.includes('permission') || msg.includes('403') || msg.includes('forbidden')) {
    return '🚫 没有权限访问此API';
  }
  
  // 截断过长的错误信息
  if (errorMsg && errorMsg.length > 100) {
    return errorMsg.substring(0, 100) + '...';
  }
  
  return errorMsg || '❓ 未知错误';
}

/**
 * 应用翻译到 DOM
 */
function applyTranslation(block, translation) {
  const { element, textNode, text, isTwitter, isAppend } = block;
  
  // 移除待翻译标记
  removePendingMark(element);
  
  // 追加模式：在元素后追加翻译（Twitter/嵌套文本等）
  if (isTwitter || isAppend || !textNode) {
    // 检查是否已经翻译过
    if (element.querySelector(':scope > .oit-translation')) return;
    
    const translationEl = document.createElement('div');
    translationEl.className = 'oit-translation';
    
    // 检测深色背景并设置颜色
    const isDark = isDarkBackground(element) || isDarkMode();
    if (isDark) {
      translationEl.style.color = '#a78bfa';
    } else {
      translationEl.style.color = '#7c3aed';
    }
    
    translationEl.textContent = translation;
    translationEl.style.marginTop = '6px';
    translationEl.style.fontSize = '0.95em';
    translationEl.style.lineHeight = '1.5';
    translationEl.style.display = 'block';
    
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
    translationEl.style.color = '#7c3aed';
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
 */
function isTargetLanguage(text) {
  const targetLang = state.config?.targetLang || 'zh-CN';
  
  if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
    const ratio = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.replace(/\s/g, '').length;
    return ratio > 0.5;
  }
  if (targetLang === 'ja') {
    const ratio = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length / text.replace(/\s/g, '').length;
    return ratio > 0.3;
  }
  if (targetLang === 'ko') {
    const ratio = (text.match(/[\uac00-\ud7af]/g) || []).length / text.replace(/\s/g, '').length;
    return ratio > 0.3;
  }
  
  return false;
}

/**
 * 检查内容是否相同
 */
function isSameContent(original, translation) {
  return original.replace(/\s+/g, ' ').trim().toLowerCase() === 
         translation.replace(/\s+/g, ' ').trim().toLowerCase();
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
  
  // 移除所有待翻译和翻译中的标记
  document.querySelectorAll('.oit-pending, .oit-pending-dark, .oit-translating-text').forEach(el => {
    el.classList.remove('oit-pending', 'oit-pending-dark', 'oit-translating-text');
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
  chrome.runtime.sendMessage({
    action: 'translationComplete',
    count: state.translatedCount,
    hasTranslations: hasTranslations
  });
  state.isActive = false;
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('completed');
  }
}

function notifyError(error) {
  chrome.runtime.sendMessage({
    action: 'translationError',
    error: error
  });
  // 更新 FAB 状态
  if (typeof updateFabStatus === 'function') {
    updateFabStatus('error');
  }
}

function notifyProgress(current, total) {
  chrome.runtime.sendMessage({
    action: 'translationProgress',
    current: current,
    total: total
  });
}

// ==================== 选中文本翻译 ====================

let floatingBtn = null;
let floatingPanel = null;

document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText.length < CONFIG.MIN_TEXT_LENGTH) {
    hideFloating();
    return;
  }
  
  showFloatingButton(e.clientX, e.clientY, selectedText);
});

function showFloatingButton(x, y, text) {
  hideFloating();
  
  floatingBtn = document.createElement('button');
  floatingBtn.className = 'oit-floating-btn';
  floatingBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/></svg>`;
  floatingBtn.style.cssText = `position:fixed;left:${Math.min(x+10,window.innerWidth-50)}px;top:${Math.max(y-40,10)}px;z-index:2147483647;`;
  
  document.body.appendChild(floatingBtn);
  
  floatingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    translateSelection(text, x, y);
  });
  
  setTimeout(() => document.addEventListener('mousedown', hideOnClickOutside), 100);
}

function hideOnClickOutside(e) {
  if (floatingBtn && !floatingBtn.contains(e.target) && 
      (!floatingPanel || !floatingPanel.contains(e.target))) {
    hideFloating();
  }
}

function hideFloating() {
  if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
  if (floatingPanel) { floatingPanel.remove(); floatingPanel = null; }
  document.removeEventListener('mousedown', hideOnClickOutside);
}

async function translateSelection(text, x, y) {
  hideFloating();
  
  floatingPanel = document.createElement('div');
  floatingPanel.className = 'oit-floating-panel';
  floatingPanel.innerHTML = `<div class="oit-panel-loading"><div class="oit-spinner"></div><span>翻译中...</span></div>`;
  floatingPanel.style.cssText = `position:fixed;left:${Math.min(x,window.innerWidth-320)}px;top:${Math.min(y+10,window.innerHeight-200)}px;z-index:2147483647;`;
  
  document.body.appendChild(floatingPanel);
  
  try {
    const result = await chrome.storage.sync.get('config');
    const config = result.config || {};
    
    if (!config.apiKey) {
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
        <div class="oit-panel-original">${escapeHtml(text)}</div>
        <div class="oit-panel-divider"></div>
        <div class="oit-panel-translation">${escapeHtml(translation)}</div>
        <div class="oit-panel-actions">
          <button class="oit-copy-btn" title="复制"><svg viewBox="0 0 24 24" fill="none"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg></button>
          <button class="oit-close-btn" title="关闭"><svg viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg></button>
        </div>
      </div>`;
    
    floatingPanel.querySelector('.oit-copy-btn').onclick = () => {
      navigator.clipboard.writeText(translation);
      floatingPanel.querySelector('.oit-copy-btn').innerHTML = '<span style="font-size:12px">✓</span>';
    };
    floatingPanel.querySelector('.oit-close-btn').onclick = hideFloating;
    
  } catch (error) {
    floatingPanel.innerHTML = `<div class="oit-panel-error">${escapeHtml(error.message)}</div>`;
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
  
  // 从存储中获取位置
  chrome.storage.local.get('fabPosition', (result) => {
    const position = result.fabPosition || { right: 20, top: '50%' };
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
  
  // 点击翻译
  fabBtn.addEventListener('click', (e) => {
    if (!fabState.hasMoved) {
      handleFabClick();
    }
    fabState.hasMoved = false;
  });
  
  // 拖拽功能
  fabBtn.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
  
  // 触摸支持
  fabBtn.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('touchmove', onDrag, { passive: false });
  document.addEventListener('touchend', endDrag);
  
  // 关闭按钮
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideFAB();
  });
  
  // 3秒后变成迷你模式
  setTimeout(() => {
    if (fab && !fabState.isDragging) {
      fab.classList.add('mini');
    }
  }, 3000);
  
  // 鼠标进入时取消迷你模式
  fab.addEventListener('mouseenter', () => {
    fab.classList.remove('mini');
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
  
  // 保存位置
  chrome.storage.local.set({ fabPosition: position });
}

// 点击悬浮按钮
async function handleFabClick() {
  const fabBtn = fab.querySelector('.oit-fab-btn');
  const tooltip = fab.querySelector('.oit-fab-tooltip');
  
  // 如果正在翻译，停止
  if (state.isActive) {
    stopTranslation();
    resetFabToIdle();
    // 通知 popup 状态变化
    broadcastState('stopped');
    return;
  }
  
  // 获取配置
  const result = await chrome.storage.sync.get('config');
  const config = result.config || {};
  
  if (!config.apiKey) {
    // 显示提示
    tooltip.textContent = '请先配置 API';
    tooltip.style.opacity = '1';
    setTimeout(() => {
      tooltip.style.opacity = '';
      tooltip.textContent = '翻译页面';
    }, 2000);
    return;
  }
  
  // 开始翻译
  setFabToTranslating();
  
  startTranslation(config);
  
  // 通知 popup 状态变化
  broadcastState('translating');
}

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

// 检查是否应该显示 FAB
async function shouldShowFab() {
  try {
    const syncResult = await chrome.storage.sync.get('config');
    // 默认显示，除非明确设置为 false
    if (syncResult.config && syncResult.config.showFab === false) {
      return false;
    }
    return true;
  } catch (e) {
    console.log('[OIT] Error checking FAB setting:', e);
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
