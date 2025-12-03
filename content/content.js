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
  ROOT_MARGIN: '0px 0px 100% 0px', // 预加载视口下方 1 屏
  THRESHOLD: 0.1, // 元素 10% 可见即触发
  
  // 批量翻译 - 降低并发避免限流
  BATCH_SIZE: 5, // 每批翻译数量（降低以减少token）
  BATCH_DELAY: 1500, // 批次间延迟(ms) - 增加间隔避免限流
  DEBOUNCE_DELAY: 300, // 防抖延迟(ms)
  
  // 文本过滤
  MIN_TEXT_LENGTH: 3,
  MAX_TEXT_LENGTH: 5000,
  
  // 跳过的标签
  SKIP_TAGS: new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'AREA',
    'CODE', 'PRE', 'KBD', 'VAR', 'SAMP', 'INPUT', 'TEXTAREA',
    'SELECT', 'BUTTON', 'IMG', 'BR', 'HR', 'META', 'LINK', 'HEAD', 'TITLE'
  ]),
  
  // 跳过的类名
  SKIP_CLASSES: ['oit-wrapper', 'oit-translation', 'oit-original', 'notranslate', 'no-translate']
};

// ==================== 状态管理 ====================
class TranslationState {
  constructor() {
    this.isActive = false;
    this.shouldStop = false;
    this.config = null;
    this.observer = null;
    this.translatedCount = 0;
    this.pendingElements = new Set(); // 待翻译元素
    this.translatingElements = new Set(); // 正在翻译的元素
    this.completedElements = new WeakSet(); // 已完成翻译的元素
    this.batchQueue = []; // 批量翻译队列
    this.batchTimer = null;
  }
  
  reset() {
    this.isActive = false;
    this.shouldStop = false;
    this.translatedCount = 0;
    this.pendingElements.clear();
    this.translatingElements.clear();
    this.batchQueue = [];
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
      // 用于检测内容脚本是否已加载
      sendResponse({ pong: true });
      break;
    case 'translatePage':
      startTranslation(message.config);
      sendResponse({ success: true });
      break;
    case 'stopTranslate':
      stopTranslation();
      sendResponse({ success: true });
      break;
    case 'removeTranslations':
      removeAllTranslations();
      sendResponse({ success: true });
      break;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
  return true;
});

// ==================== 核心翻译逻辑 ====================

/**
 * 开始翻译 - 视口优先算法
 */
function startTranslation(config) {
  if (state.isActive) {
    console.log('[OpenImmerseTranslate] Already translating');
    return;
  }
  
  state.reset();
  state.config = config;
  state.isActive = true;
  
  console.log('[OpenImmerseTranslate] Starting viewport-first translation');
  
  // 1. 收集所有可翻译的文本块
  const textBlocks = collectTextBlocks();
  console.log(`[OpenImmerseTranslate] Found ${textBlocks.length} text blocks`);
  
  if (textBlocks.length === 0) {
    notifyComplete();
    return;
  }
  
  // 2. 创建 Intersection Observer 监听视口
  createObserver(textBlocks);
  
  // 3. 开始观察所有文本块
  textBlocks.forEach(block => {
    state.observer.observe(block.element);
  });
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
 * 收集页面中所有可翻译的文本块
 * 返回包含元素和文本的对象数组
 */
function collectTextBlocks() {
  const blocks = [];
  const processedElements = new WeakSet();
  
  // 遍历所有文本节点
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // 跳过已处理
        if (processedElements.has(parent)) return NodeFilter.FILTER_REJECT;
        
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
        
        // 跳过纯数字/标点
        if (/^[\d\s\p{P}]+$/u.test(text)) return NodeFilter.FILTER_REJECT;
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!processedElements.has(parent)) {
      processedElements.add(parent);
      
      const text = node.textContent.trim();
      
      // 检查是否已是目标语言
      if (state.config.autoDetect && isTargetLanguage(text)) {
        continue;
      }
      
      blocks.push({
        element: parent,
        textNode: node,
        text: text
      });
    }
  }
  
  return blocks;
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
 * 将文本块加入翻译队列
 * 使用防抖批量处理
 */
function queueForTranslation(block) {
  state.batchQueue.push(block);
  
  // 防抖：等待更多元素加入队列
  if (state.batchTimer) {
    clearTimeout(state.batchTimer);
  }
  
  state.batchTimer = setTimeout(() => {
    processBatchQueue();
  }, CONFIG.DEBOUNCE_DELAY);
}

/**
 * 处理批量翻译队列
 */
async function processBatchQueue() {
  if (!state.isActive || state.shouldStop || state.batchQueue.length === 0) {
    return;
  }
  
  // 取出一批待翻译的文本块
  const batch = state.batchQueue.splice(0, CONFIG.BATCH_SIZE);
  
  // 过滤掉已完成的
  const validBatch = batch.filter(block => 
    !state.completedElements.has(block.element) && 
    !state.translatingElements.has(block)
  );
  
  if (validBatch.length === 0) {
    // 继续处理队列中剩余的
    if (state.batchQueue.length > 0) {
      setTimeout(() => processBatchQueue(), CONFIG.BATCH_DELAY);
    }
    return;
  }
  
  // 标记为正在翻译
  validBatch.forEach(block => {
    state.pendingElements.delete(block);
    state.translatingElements.add(block);
  });
  
  try {
    // 批量翻译
    await translateBatch(validBatch);
  } catch (error) {
    console.error('[OpenImmerseTranslate] Batch error:', error);
    notifyError(error.message);
  }
  
  // 继续处理队列
  if (state.batchQueue.length > 0 && state.isActive && !state.shouldStop) {
    setTimeout(() => processBatchQueue(), CONFIG.BATCH_DELAY);
  } else if (state.batchQueue.length === 0 && state.pendingElements.size === 0 && 
             state.translatingElements.size === 0) {
    // 当前视口翻译完成
    notifyProgress(state.translatedCount, state.translatedCount);
  }
}

/**
 * 批量翻译文本块
 */
async function translateBatch(blocks) {
  const texts = blocks.map(b => b.text);
  
  try {
    // 调用翻译 API
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      texts: texts,
      config: state.config
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    const translations = response.translations;
    
    // 应用翻译结果
    for (let i = 0; i < blocks.length; i++) {
      if (state.shouldStop) break;
      
      const block = blocks[i];
      const translation = translations[i];
      
      if (translation && translation !== block.text && !isSameContent(block.text, translation)) {
        applyTranslation(block, translation);
        state.translatedCount++;
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
  chrome.runtime.sendMessage({
    action: 'translationComplete',
    count: state.translatedCount
  });
  state.isActive = false;
}

function notifyError(error) {
  chrome.runtime.sendMessage({
    action: 'translationError',
    error: error
  });
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
    fabBtn.classList.remove('translating');
    fabBtn.classList.remove('completed');
    tooltip.textContent = '翻译页面';
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
  fabBtn.classList.add('translating');
  fabBtn.classList.remove('completed');
  tooltip.textContent = '翻译中...';
  fab.classList.remove('mini');
  
  // 更新按钮图标为加载状态
  fabBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" fill="currentColor"/>
    </svg>
  `;
  
  startTranslation(config);
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
const originalNotifyComplete = notifyComplete;
function notifyComplete() {
  originalNotifyComplete();
  updateFabStatus('completed');
}

// 修改通知错误函数
const originalNotifyError = notifyError;
function notifyError(error) {
  originalNotifyError(error);
  updateFabStatus('error');
}

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
