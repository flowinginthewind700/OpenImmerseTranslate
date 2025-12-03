/**
 * Open Immerse Translate - Popup Script
 * 弹出窗口的交互逻辑 + 国际化支持
 */

// 默认配置
const DEFAULT_CONFIG = {
  provider: 'openai',
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  modelName: 'gpt-4o-mini',
  targetLang: 'zh-CN',
  translationStyle: 'accurate',
  showOriginal: true,
  autoDetect: true,
  customPrompt: '',
  maxTokens: 2048,
  temperature: 0.3,
  uiLanguage: '' // 空表示跟随系统
};

// 提供商默认配置
const PROVIDER_DEFAULTS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    hintKey: 'hintOpenAI'
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-haiku-20240307',
    hintKey: 'hintAnthropic'
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    hintKey: 'hintDeepSeek'
  },
  moonshot: {
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    hintKey: 'hintMoonshot'
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    hintKey: 'hintZhipu'
  },
  custom: {
    endpoint: '',
    model: '',
    hintKey: 'hintCustom'
  }
};

// 语言名称映射
const LANG_NAMES = {
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

// DOM 元素
let elements = {};

// 当前状态
let currentConfig = { ...DEFAULT_CONFIG };
let isTranslating = false;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  initElements();
  await loadConfig();
  applyI18n();
  initEventListeners();
  updateUI();
});

// 应用国际化
function applyI18n() {
  const t = window.i18n.t;
  
  // 更新所有带 data-i18n 的元素
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  // 更新 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // 更新语言按钮显示
  updateLangButton();
}

// 更新语言下拉选择
function updateLangButton() {
  if (elements.langSelect) {
    const currentLang = window.i18n.getCurrentLanguage();
    elements.langSelect.value = currentLang;
  }
}

// 处理语言切换
async function handleLanguageChange(e) {
  const newLang = e.target.value;
  
  window.i18n.setLanguage(newLang);
  currentConfig.uiLanguage = newLang;
  
  // 保存语言设置
  await chrome.storage.sync.set({ config: currentConfig });
  
  // 重新应用国际化
  applyI18n();
  updateUI();
  
  // 显示提示
  showToast(newLang === 'zh-CN' ? '已切换到中文' : 'Switched to English', 'success');
}

// 初始化DOM元素引用
function initElements() {
  elements = {
    // 主界面
    mainContent: document.getElementById('mainContent'),
    settingsPanel: document.getElementById('settingsPanel'),
    settingsBtn: document.getElementById('settingsBtn'),
    backBtn: document.getElementById('backBtn'),
    
    // 语言切换
    langSelect: document.getElementById('langSelect'),
    
    // 引导
    setupGuide: document.getElementById('setupGuide'),
    guideCard: document.getElementById('guideCard'),
    
    // 翻译操作
    translatePageBtn: document.getElementById('translatePageBtn'),
    stopTranslateBtn: document.getElementById('stopTranslateBtn'),
    
    // 状态显示
    statusCard: document.getElementById('statusCard'),
    currentProvider: document.getElementById('currentProvider'),
    currentTargetLang: document.getElementById('currentTargetLang'),
    apiStatus: document.getElementById('apiStatus'),
    apiStatusItem: document.getElementById('apiStatusItem'),
    
    // 设置表单
    providerSelect: document.getElementById('providerSelect'),
    providerHint: document.getElementById('providerHint'),
    apiEndpoint: document.getElementById('apiEndpoint'),
    apiKey: document.getElementById('apiKey'),
    toggleApiKey: document.getElementById('toggleApiKey'),
    modelName: document.getElementById('modelName'),
    testApiBtn: document.getElementById('testApiBtn'),
    
    targetLang: document.getElementById('targetLang'),
    translationStyle: document.getElementById('translationStyle'),
    showOriginal: document.getElementById('showOriginal'),
    autoDetect: document.getElementById('autoDetect'),
    
    customPrompt: document.getElementById('customPrompt'),
    maxTokens: document.getElementById('maxTokens'),
    temperature: document.getElementById('temperature'),
    temperatureValue: document.getElementById('temperatureValue'),
    
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    toast: document.getElementById('toast')
  };
}

// 加载配置
async function loadConfig() {
  try {
    const result = await chrome.storage.sync.get('config');
    if (result.config) {
      currentConfig = { ...DEFAULT_CONFIG, ...result.config };
    }
    
    // 设置UI语言
    if (currentConfig.uiLanguage) {
      window.i18n.setLanguage(currentConfig.uiLanguage);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    await chrome.storage.sync.set({ config: currentConfig });
    showToast(window.i18n.t('settingsSaved'), 'success');
  } catch (error) {
    console.error('Failed to save config:', error);
    showToast(window.i18n.t('saveFailed'), 'error');
  }
}

// 初始化事件监听器
function initEventListeners() {
  // 语言切换下拉
  if (elements.langSelect) {
    elements.langSelect.addEventListener('change', handleLanguageChange);
  }
  
  // 设置面板切换
  elements.settingsBtn.addEventListener('click', () => showPanel('settings'));
  elements.backBtn.addEventListener('click', () => showPanel('main'));
  
  // 引导卡片点击
  if (elements.guideCard) {
    elements.guideCard.addEventListener('click', () => showPanel('settings'));
  }
  
  // API状态点击 - 导航到设置
  if (elements.apiStatusItem) {
    elements.apiStatusItem.addEventListener('click', () => {
      if (!currentConfig.apiKey) {
        showPanel('settings');
      }
    });
  }
  
  // 翻译操作
  elements.translatePageBtn.addEventListener('click', handleTranslatePage);
  elements.stopTranslateBtn.addEventListener('click', handleStopTranslate);
  
  // 提供商选择变化
  elements.providerSelect.addEventListener('change', handleProviderChange);
  
  // API密钥显示切换
  elements.toggleApiKey.addEventListener('click', () => {
    const input = elements.apiKey;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  
  // Temperature滑块
  elements.temperature.addEventListener('input', (e) => {
    elements.temperatureValue.textContent = e.target.value;
  });
  
  // 测试API连接
  elements.testApiBtn.addEventListener('click', handleTestApi);
  
  // 保存设置
  elements.saveSettingsBtn.addEventListener('click', handleSaveSettings);
}

// 更新UI
function updateUI() {
  const t = window.i18n.t;
  
  // 更新设置表单
  elements.providerSelect.value = currentConfig.provider;
  elements.apiEndpoint.value = currentConfig.apiEndpoint;
  elements.apiKey.value = currentConfig.apiKey;
  elements.modelName.value = currentConfig.modelName;
  elements.targetLang.value = currentConfig.targetLang;
  elements.translationStyle.value = currentConfig.translationStyle;
  elements.showOriginal.checked = currentConfig.showOriginal;
  elements.autoDetect.checked = currentConfig.autoDetect;
  elements.customPrompt.value = currentConfig.customPrompt;
  elements.maxTokens.value = currentConfig.maxTokens;
  elements.temperature.value = currentConfig.temperature;
  elements.temperatureValue.textContent = currentConfig.temperature;
  
  // 更新提供商提示
  updateProviderHint(currentConfig.provider);
  
  // 更新主界面预览
  elements.currentProvider.textContent = getProviderName(currentConfig.provider);
  elements.currentTargetLang.textContent = LANG_NAMES[currentConfig.targetLang] || currentConfig.targetLang;
  
  // 更新API状态
  updateApiStatus();
  
  // 显示/隐藏引导
  updateSetupGuide();
}

// 更新引导显示
function updateSetupGuide() {
  if (elements.setupGuide) {
    if (!currentConfig.apiKey) {
      elements.setupGuide.style.display = 'block';
    } else {
      elements.setupGuide.style.display = 'none';
    }
  }
}

// 更新提供商提示
function updateProviderHint(provider) {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (defaults && elements.providerHint) {
    elements.providerHint.textContent = window.i18n.t(defaults.hintKey);
  }
}

// 更新API状态显示
function updateApiStatus() {
  const t = window.i18n.t;
  const statusEl = elements.apiStatus;
  const itemEl = elements.apiStatusItem;
  
  if (currentConfig.apiKey) {
    statusEl.innerHTML = `<span class="status-dot active"></span><span>${t('configured')}</span>`;
    itemEl.classList.remove('not-configured', 'clickable');
  } else {
    statusEl.innerHTML = `<span class="status-dot"></span><span>${t('clickToConfigure')}</span>`;
    itemEl.classList.add('not-configured', 'clickable');
  }
}

// 获取提供商名称
function getProviderName(provider) {
  const names = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    deepseek: 'DeepSeek',
    moonshot: 'Kimi',
    zhipu: '智谱GLM',
    custom: window.i18n.t('providerCustom')
  };
  return names[provider] || provider;
}

// 显示面板
function showPanel(panel) {
  if (panel === 'settings') {
    elements.mainContent.style.display = 'none';
    elements.settingsPanel.style.display = 'flex';
  } else {
    elements.mainContent.style.display = 'block';
    elements.settingsPanel.style.display = 'none';
    updateUI();
  }
}

// 处理提供商变化
function handleProviderChange(e) {
  const provider = e.target.value;
  const defaults = PROVIDER_DEFAULTS[provider];
  
  if (defaults) {
    elements.apiEndpoint.value = defaults.endpoint;
    elements.modelName.value = defaults.model;
    updateProviderHint(provider);
    
    if (provider === 'custom') {
      elements.apiEndpoint.placeholder = window.i18n.t('apiAddress');
      elements.modelName.placeholder = window.i18n.t('modelName');
    } else {
      elements.apiEndpoint.placeholder = defaults.endpoint;
      elements.modelName.placeholder = defaults.model;
    }
  }
}

// 检查内容脚本是否已加载
async function checkContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return response && response.pong;
  } catch (error) {
    return false;
  }
}

// 注入内容脚本
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['styles/content.css']
    });
    return true;
  } catch (error) {
    console.error('Failed to inject content script:', error);
    return false;
  }
}

// 处理翻译页面
async function handleTranslatePage() {
  const t = window.i18n.t;
  
  if (!currentConfig.apiKey) {
    showToast(t('pleaseConfigureApi'), 'error');
    showPanel('settings');
    return;
  }
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showToast(t('cannotGetPage'), 'error');
      return;
    }
    
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      showToast(t('cannotUsePage'), 'error');
      return;
    }
    
    updateStatus('working', t('translating'), t('translatingDesc'));
    elements.translatePageBtn.style.display = 'none';
    elements.stopTranslateBtn.style.display = 'flex';
    isTranslating = true;
    
    let scriptLoaded = await checkContentScript(tab.id);
    
    if (!scriptLoaded) {
      const injected = await injectContentScript(tab.id);
      
      if (!injected) {
        throw new Error(t('pleaseRefreshPage'));
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      scriptLoaded = await checkContentScript(tab.id);
      
      if (!scriptLoaded) {
        throw new Error(t('pleaseRefreshPage'));
      }
    }
    
    await chrome.tabs.sendMessage(tab.id, {
      action: 'translatePage',
      config: currentConfig
    });
    
  } catch (error) {
    console.error('Translation error:', error);
    
    let errorMsg = error.message;
    if (error.message.includes('Could not establish connection') || 
        error.message.includes('Receiving end does not exist')) {
      errorMsg = t('pleaseRefreshPage');
    }
    
    showToast(errorMsg, 'error');
    updateStatus('error', t('translateError'), errorMsg);
    resetTranslateButton();
  }
}

// 处理停止翻译
async function handleStopTranslate() {
  const t = window.i18n.t;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'stopTranslate' });
      } catch (e) {}
    }
    
    resetTranslateButton();
    updateStatus('idle', t('stopped'), t('stoppedDesc'));
    
  } catch (error) {
    console.error('Stop error:', error);
    resetTranslateButton();
  }
}

// 重置翻译按钮状态
function resetTranslateButton() {
  elements.translatePageBtn.style.display = 'flex';
  elements.stopTranslateBtn.style.display = 'none';
  isTranslating = false;
}

// 更新状态显示
function updateStatus(type, title, desc) {
  const iconEl = elements.statusCard.querySelector('.status-icon');
  const titleEl = elements.statusCard.querySelector('.status-title');
  const descEl = elements.statusCard.querySelector('.status-desc');
  
  iconEl.className = 'status-icon ' + type;
  titleEl.textContent = title;
  descEl.textContent = desc;
  
  const icons = {
    idle: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/></svg>',
    working: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" fill="currentColor"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg>'
  };
  
  iconEl.innerHTML = icons[type] || icons.idle;
}

// 处理测试API
async function handleTestApi() {
  const t = window.i18n.t;
  const endpoint = elements.apiEndpoint.value.trim();
  const apiKey = elements.apiKey.value.trim();
  const model = elements.modelName.value.trim();
  const provider = elements.providerSelect.value;
  
  if (!endpoint || !apiKey) {
    showToast(t('fillApiAndKey'), 'error');
    return;
  }
  
  elements.testApiBtn.disabled = true;
  elements.testApiBtn.innerHTML = `<span class="loading-spinner"></span> ${t('testing')}`;
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testApi',
      config: { 
        provider,
        apiEndpoint: endpoint, 
        apiKey, 
        modelName: model,
        targetLang: elements.targetLang.value
      }
    });
    
    if (response.success) {
      showToast(t('connectionSuccess'), 'success');
    } else {
      showToast(`${t('connectionFailed')}: ${response.error || ''}`, 'error');
    }
  } catch (error) {
    showToast(`${t('connectionFailed')}: ${error.message}`, 'error');
  } finally {
    elements.testApiBtn.disabled = false;
    elements.testApiBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
      </svg>
      <span>${t('testConnection')}</span>
    `;
  }
}

// 处理保存设置
async function handleSaveSettings() {
  currentConfig = {
    ...currentConfig,
    provider: elements.providerSelect.value,
    apiEndpoint: elements.apiEndpoint.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    modelName: elements.modelName.value.trim(),
    targetLang: elements.targetLang.value,
    translationStyle: elements.translationStyle.value,
    showOriginal: elements.showOriginal.checked,
    autoDetect: elements.autoDetect.checked,
    customPrompt: elements.customPrompt.value.trim(),
    maxTokens: parseInt(elements.maxTokens.value) || 2048,
    temperature: parseFloat(elements.temperature.value) || 0.3
  };
  
  await saveConfig();
  updateUI();
}

// 显示Toast提示
function showToast(message, type = 'info') {
  const toast = elements.toast;
  toast.querySelector('.toast-message').textContent = message;
  toast.className = 'toast ' + type;
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const t = window.i18n.t;
  
  if (message.action === 'translationComplete') {
    resetTranslateButton();
    updateStatus('success', t('translateComplete'), `${message.count || 0} segments`);
  } else if (message.action === 'translationError') {
    resetTranslateButton();
    updateStatus('error', t('translateError'), message.error || '');
    showToast(message.error || t('translateError'), 'error');
  } else if (message.action === 'translationProgress') {
    updateStatus('working', t('translating'), `${message.current}/${message.total}`);
  }
});
