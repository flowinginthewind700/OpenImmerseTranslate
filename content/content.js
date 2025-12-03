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
  // 视口检测 - 优化预加载范围
  ROOT_MARGIN: '50% 0px 100% 0px', // 预加载上方50%+下方1屏
  THRESHOLD: 0.01, // 1%可见即触发，更快响应
  
  // 极速翻译配置
  BATCH_SIZE: 8, // 每批翻译数量
  IMMEDIATE_BATCH_SIZE: 15, // 首屏立即翻译数量
  BATCH_DELAY: 100, // 批次间延迟(ms) - 极速
  DEBOUNCE_DELAY: 30, // 防抖延迟(ms) - 极速
  MAX_CONCURRENT_BATCHES: 3, // 最大并发批次
  
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
    this.translatedCount = 0;
    this.pendingElements = new Set();
    this.translatingElements = new Set();
    this.completedElements = new WeakSet();
    this.batchQueue = [];
    this.batchTimer = null;
    // 性能优化新增
    this.activeBatches = 0; // 当前并发批次数
    this.isFirstBatch = true; // 是否首批（立即处理）
    this.processedTexts = new Set(); // 已处理文本去重
    this.blockMap = new Map(); // 元素到块的映射（缓存）
  }
  
  reset() {
    this.isActive = false;
    this.shouldStop = false;
    this.translatedCount = 0;
    this.pendingElements.clear();
    this.translatingElements.clear();
    this.batchQueue = [];
    this.activeBatches = 0;
    this.isFirstBatch = true;
    this.processedTexts.clear();
    this.blockMap.clear();
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
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
 * 开始翻译 - 极速视口优先算法
 * 1. 立即翻译视口内容（无延迟）
 * 2. 异步收集并观察其他内容
 * 3. 并发批次处理
 */
function startTranslation(config) {
  if (state.isActive) {
    console.log('[OpenImmerseTranslate] Already translating');
    return;
  }
  
  state.reset();
  state.config = config;
  state.isActive = true;
  state.isFirstBatch = true;
  
  const startTime = performance.now();
  sendLog('🚀 开始扫描页面...', 'info');
  
  // 第一步：立即收集并翻译视口内可见内容（同步，极快）
  const viewportBlocks = collectViewportBlocks();
  const scanTime = (performance.now() - startTime).toFixed(0);
  
  if (viewportBlocks.length > 0) {
    sendLog(`⚡ 视口扫描完成: ${viewportBlocks.length} 个文本块 (${scanTime}ms)`, 'success');
    sendLog(`📤 开始翻译首屏内容...`, 'info');
    // 立即开始翻译视口内容，无需等待
    immediateTranslate(viewportBlocks);
  } else {
    sendLog(`⚠️ 视口内未发现可翻译文本`, 'warning');
  }
  
  // 第二步：异步收集页面其他内容（不阻塞主线程）
  requestIdleCallback(() => {
    if (!state.isActive || state.shouldStop) return;
    
    sendLog('📄 正在扫描页面其他内容...', 'info');
    const allBlocks = collectTextBlocks();
    const remainingBlocks = allBlocks.filter(b => !state.processedTexts.has(b.text));
    
    if (remainingBlocks.length > 0) {
      sendLog(`📋 发现 ${remainingBlocks.length} 个待翻译文本块`, 'info');
      createObserver(remainingBlocks);
      remainingBlocks.forEach(block => {
        state.blockMap.set(block.element, block);
        state.observer.observe(block.element);
      });
    } else {
      sendLog('✅ 页面扫描完成，无更多内容', 'success');
    }
  }, { timeout: 100 });
}

/**
 * 收集视口内可见的文本块（极速版）
 */
function collectViewportBlocks() {
  const blocks = [];
  const viewportHeight = window.innerHeight;
  const viewportTop = window.scrollY;
  const viewportBottom = viewportTop + viewportHeight;
  
  // 快速选择器 - 只选常见文本容器
  const selectors = 'p,span,div,a,li,td,th,h1,h2,h3,h4,h5,h6,label,button,blockquote';
  const elements = document.querySelectorAll(selectors);
  
  for (const el of elements) {
    if (blocks.length >= CONFIG.IMMEDIATE_BATCH_SIZE * 2) break; // 限制首批数量
    
    const rect = el.getBoundingClientRect();
    const elTop = rect.top + viewportTop;
    const elBottom = elTop + rect.height;
    
    // 检查是否在视口内
    if (elBottom < viewportTop || elTop > viewportBottom) continue;
    if (rect.width === 0 || rect.height === 0) continue;
    
    // 快速过滤
    if (CONFIG.SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest('.oit-wrapper')) continue;
    
    // 获取直接文本
    const text = getDirectTextContent(el);
    if (!text || text.length < CONFIG.MIN_TEXT_LENGTH) continue;
    if (state.processedTexts.has(text)) continue;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) continue;
    
    // 跳过已是目标语言
    if (state.config?.autoDetect && isTargetLanguage(text)) continue;
    
    const textNode = findTextNode(el, text);
    if (textNode) {
      state.processedTexts.add(text);
      blocks.push({ element: el, textNode, text });
    }
  }
  
  // 按Y坐标排序，从上到下
  blocks.sort((a, b) => {
    const aRect = a.element.getBoundingClientRect();
    const bRect = b.element.getBoundingClientRect();
    return aRect.top - bRect.top;
  });
  
  return blocks;
}

/**
 * 立即翻译（首屏无延迟）
 */
async function immediateTranslate(blocks) {
  if (blocks.length === 0) return;
  
  // 分批但并发执行
  const batches = [];
  for (let i = 0; i < blocks.length; i += CONFIG.IMMEDIATE_BATCH_SIZE) {
    batches.push(blocks.slice(i, i + CONFIG.IMMEDIATE_BATCH_SIZE));
  }
  
  sendLog(`🔄 首屏分为 ${batches.length} 批，开始并发翻译...`, 'info');
  
  // 并发执行所有首屏批次
  let hasError = false;
  let lastError = null;
  
  const promises = batches.map((batch, index) => {
    return new Promise(resolve => {
      // 微小延迟避免同时发送太多请求
      setTimeout(async () => {
        try {
          sendLog(`📡 发送第 ${index + 1}/${batches.length} 批请求 (${batch.length} 条)...`, 'progress');
          await translateBatch(batch);
          sendLog(`✓ 第 ${index + 1} 批完成`, 'success');
        } catch (e) {
          hasError = true;
          lastError = e;
          // 解析友好错误并显示完整信息
          const friendlyMsg = parseFriendlyError(e.message);
          sendLog(`❌ LLM服务报错: ${friendlyMsg}`, 'error');
          // 如果是账户问题，显示原始消息帮助用户诊断
          if (e.message && e.message.length < 200) {
            sendLog(`📋 原始信息: ${e.message}`, 'warning');
          }
        }
        resolve();
      }, index * 50);
    });
  });
  
  await Promise.all(promises);
  state.isFirstBatch = false;
  
  if (hasError) {
    sendLog(`⚠️ 翻译过程中出现错误，请检查API设置`, 'warning');
    // 通知错误
    if (lastError) {
      notifyError(parseFriendlyError(lastError.message));
    }
  } else if (state.translatedCount > 0) {
    sendLog(`🎉 首屏翻译完成！共 ${state.translatedCount} 段`, 'success');
  }
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
  // 创建元素到文本块的映射
  const blockMap = new Map();
  textBlocks.forEach(block => {
    blockMap.set(block.element, block);
  });
  
  state.observer = new IntersectionObserver((entries) => {
    if (!state.isActive || state.shouldStop) return;
    
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const block = blockMap.get(entry.target);
        if (block && !state.completedElements.has(block.element) && 
            !state.pendingElements.has(block) && !state.translatingElements.has(block)) {
          // 添加到待翻译队列
          state.pendingElements.add(block);
          queueForTranslation(block);
        }
      }
    });
  }, {
    rootMargin: CONFIG.ROOT_MARGIN,
    threshold: CONFIG.THRESHOLD
  });
}

/**
 * 将文本块加入翻译队列（极速版）
 */
function queueForTranslation(block) {
  // 去重检查
  if (state.processedTexts.has(block.text)) return;
  state.processedTexts.add(block.text);
  
  state.batchQueue.push(block);
  
  // 极短防抖
  if (state.batchTimer) {
    clearTimeout(state.batchTimer);
  }
  
  state.batchTimer = setTimeout(() => {
    processBatchQueue();
  }, CONFIG.DEBOUNCE_DELAY);
}

/**
 * 处理批量翻译队列（并发版）
 */
async function processBatchQueue() {
  if (!state.isActive || state.shouldStop || state.batchQueue.length === 0) {
    return;
  }
  
  // 检查并发限制
  if (state.activeBatches >= CONFIG.MAX_CONCURRENT_BATCHES) {
    // 延迟重试
    setTimeout(() => processBatchQueue(), CONFIG.BATCH_DELAY);
    return;
  }
  
  // 取出一批
  const batch = state.batchQueue.splice(0, CONFIG.BATCH_SIZE);
  
  // 快速过滤
  const validBatch = batch.filter(block => 
    !state.completedElements.has(block.element) && 
    !state.translatingElements.has(block)
  );
  
  if (validBatch.length === 0) {
    if (state.batchQueue.length > 0) {
      // 立即处理下一批
      setImmediate(() => processBatchQueue());
    }
    return;
  }
  
  // 标记状态
  validBatch.forEach(block => {
    state.pendingElements.delete(block);
    state.translatingElements.add(block);
  });
  
  state.activeBatches++;
  
  // 异步执行，不阻塞
  translateBatchAsync(validBatch).finally(() => {
    state.activeBatches--;
    
    // 继续处理队列
    if (state.batchQueue.length > 0 && state.isActive && !state.shouldStop) {
      // 极短延迟继续
      setTimeout(() => processBatchQueue(), CONFIG.BATCH_DELAY);
    } else if (state.batchQueue.length === 0 && state.pendingElements.size === 0 && 
               state.translatingElements.size === 0 && state.activeBatches === 0) {
      notifyProgress(state.translatedCount, state.translatedCount);
    }
  });
  
  // 立即尝试启动更多并发批次
  if (state.batchQueue.length > 0 && state.activeBatches < CONFIG.MAX_CONCURRENT_BATCHES) {
    setImmediate(() => processBatchQueue());
  }
}

/**
 * 异步批量翻译
 */
async function translateBatchAsync(blocks) {
  try {
    await translateBatch(blocks);
  } catch (error) {
    console.error('[OpenImmerseTranslate] Batch error:', error);
    // 不中断整体流程
  }
}

// setImmediate polyfill
const setImmediate = window.setImmediate || ((fn) => setTimeout(fn, 0));

/**
 * 批量翻译文本块
 */
async function translateBatch(blocks) {
  const texts = blocks.map(b => b.text);
  const previewText = texts[0]?.substring(0, 30) + (texts[0]?.length > 30 ? '...' : '');
  
  try {
    // 调用翻译 API
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      texts: texts,
      config: state.config
    });
    
    if (response.error) {
      // 解析并友好化错误信息
      const friendlyError = parseFriendlyError(response.error);
      sendLog(`❌ API错误: ${friendlyError}`, 'error');
      throw new Error(response.error);
    }
    
    const translations = response.translations;
    
    if (!translations || translations.length === 0) {
      sendLog(`⚠️ API返回空结果`, 'warning');
      return;
    }
    
    // 应用翻译结果
    let appliedCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (state.shouldStop) break;
      
      const block = blocks[i];
      const translation = translations[i];
      
      if (translation && translation !== block.text && !isSameContent(block.text, translation)) {
        applyTranslation(block, translation);
        state.translatedCount++;
        appliedCount++;
      }
      
      // 标记为已完成
      state.completedElements.add(block.element);
      state.translatingElements.delete(block);
      
      // 停止观察已翻译的元素
      if (state.observer) {
        state.observer.unobserve(block.element);
      }
    }
    
    // 更新进度
    notifyProgress(state.translatedCount, state.translatedCount);
    
  } catch (error) {
    // 翻译失败，移除正在翻译标记
    blocks.forEach(block => {
      state.translatingElements.delete(block);
    });
    throw error;
  }
}

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
  const { textNode, text } = block;
  const parent = textNode.parentElement;
  if (!parent) return;
  
  const wrapper = document.createElement('span');
  wrapper.className = 'oit-wrapper';
  
  // 检测深色背景
  if (isDarkBackground(parent)) {
    wrapper.classList.add('oit-dark');
  }
  
  if (state.config.showOriginal) {
    wrapper.innerHTML = `<span class="oit-original">${escapeHtml(text)}</span><span class="oit-translation">${escapeHtml(translation)}</span>`;
  } else {
    wrapper.innerHTML = `<span class="oit-translation oit-only">${escapeHtml(translation)}</span>`;
  }
  
  textNode.parentNode.replaceChild(wrapper, textNode);
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
  
  document.querySelectorAll('.oit-wrapper').forEach(wrapper => {
    const original = wrapper.querySelector('.oit-original');
    if (original) {
      const textNode = document.createTextNode(original.textContent);
      wrapper.parentNode.replaceChild(textNode, wrapper);
    } else {
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
  // 记住隐藏状态
  chrome.storage.local.set({ fabHidden: true });
}

// 显示悬浮按钮
function showFAB() {
  chrome.storage.local.set({ fabHidden: false });
  initFAB();
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

// 修改通知完成函数
// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('fabHidden', (result) => {
      if (!result.fabHidden) {
        initFAB();
      }
    });
  });
} else {
  chrome.storage.local.get('fabHidden', (result) => {
    if (!result.fabHidden) {
      initFAB();
    }
  });
}
