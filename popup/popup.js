/**
 * Open Immerse Translate - Popup Script
 * 弹出窗口的交互逻辑 + 国际化支持 + 模块化配置管理
 */

/** 同时翻译路数（1–12） */
function clampMaxConcurrent(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_GLOBAL_CONFIG.maxConcurrent;
  return Math.min(12, Math.max(1, n));
}

// ==================== 模块化配置系统 ====================

/**
 * 全局配置（非 provider 相关）
 */
const DEFAULT_GLOBAL_CONFIG = {
  provider: 'google',      // 当前选择的 provider
  sourceLang: 'auto',      // 源语言
  targetLang: 'zh-CN',     // 目标语言
  translationStyle: 'accurate',
  showOriginal: true,
  autoDetect: true,
  showFab: true,
  customPrompt: '',
  maxTokens: 2048,
  temperature: 0.3,
  maxConcurrent: 6,
  uiLanguage: ''
};

/**
 * Provider 配置模板
 * 每个 provider 独立存储：endpoint, apiKey, modelName
 */
/**
 * 配置管理器 - 模块化存储和读取配置
 */
const ConfigManager = {
  // 存储键名
  STORAGE_KEY_GLOBAL: 'globalConfig',
  STORAGE_KEY_PROVIDERS: 'providerConfigs',
  
  // 内存缓存（使用空对象而非 null，避免展开操作出错）
  _globalConfig: { ...DEFAULT_GLOBAL_CONFIG },
  _providerConfigs: {},
  _initialized: false,
  
  /**
   * 初始化配置
   */
  async init() {
    if (this._initialized) return;
    await this.load();
    this._initialized = true;
  },
  
  /**
   * 确保已初始化
   */
  _ensureInitialized() {
    if (!this._globalConfig) {
      this._globalConfig = { ...DEFAULT_GLOBAL_CONFIG };
    }
    if (!this._providerConfigs) {
      this._providerConfigs = {};
    }
  },
  
  /**
   * 安全获取对象属性
   */
  _safeGet(obj, key, defaultValue = {}) {
    if (obj === null || obj === undefined) return defaultValue;
    const value = obj[key];
    if (value === null || value === undefined) return defaultValue;
    if (typeof value !== 'object') return defaultValue;
    return value;
  },
  
  /**
   * 从存储加载配置
   */
  async load() {
    try {
      const result = await chrome.storage.sync.get([
        this.STORAGE_KEY_GLOBAL,
        this.STORAGE_KEY_PROVIDERS
      ]);

      // 安全获取存储的全局配置
      const savedGlobal = this._safeGet(result, this.STORAGE_KEY_GLOBAL, {});
      this._globalConfig = {
        ...DEFAULT_GLOBAL_CONFIG,
        ...savedGlobal
      };

      // 安全获取存储的 Provider 配置
      const savedProviders = this._safeGet(result, this.STORAGE_KEY_PROVIDERS, {});
      this._providerConfigs = {};

      // 合并默认配置和已保存的配置
      for (const [providerId, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
        if (!defaults) continue;
        const savedProvider = this._safeGet(savedProviders, providerId, {});
        this._providerConfigs[providerId] = {
          endpoint: defaults.endpoint || '',
          model: defaults.model || '',
          apiKey: '',
          ...savedProvider
        };
      }

      console.log('[ConfigManager] Loaded config:', {
        global: this._globalConfig,
        providers: Object.keys(this._providerConfigs)
      });

    } catch (error) {
      console.error('[ConfigManager] Failed to load:', error);
      this._globalConfig = { ...DEFAULT_GLOBAL_CONFIG };
      this._providerConfigs = {};
    }
  },
  
  /**
   * 保存全局配置
   */
  async saveGlobal(config) {
    this._ensureInitialized();
    if (!config || typeof config !== 'object') return;
    
    this._globalConfig = { 
      ...DEFAULT_GLOBAL_CONFIG,
      ...this._globalConfig, 
      ...config 
    };
    await chrome.storage.sync.set({
      [this.STORAGE_KEY_GLOBAL]: this._globalConfig
    });
  },
  
  /**
   * 保存单个 Provider 配置
   */
  async saveProvider(providerId, config) {
    this._ensureInitialized();
    if (!providerId || !config || typeof config !== 'object') return;
    
    // 确保 provider 存在于配置中
    if (!this._providerConfigs[providerId]) {
      const defaults = PROVIDER_DEFAULTS[providerId] || PROVIDER_DEFAULTS.custom || {};
      this._providerConfigs[providerId] = {
        endpoint: defaults.endpoint || '',
        model: defaults.model || '',
        apiKey: ''
      };
    }
    
    this._providerConfigs[providerId] = {
      ...this._providerConfigs[providerId],
      ...config
    };
    
    await chrome.storage.sync.set({
      [this.STORAGE_KEY_PROVIDERS]: this._providerConfigs
    });
  },
  
  /**
   * 获取全局配置
   */
  getGlobal() {
    this._ensureInitialized();
    return { ...this._globalConfig };
  },
  
  /**
   * 获取当前 Provider ID
   */
  getCurrentProvider() {
    this._ensureInitialized();
    return this._globalConfig?.provider || 'google';
  },
  
  /**
   * 设置当前 Provider
   */
  async setCurrentProvider(providerId) {
    if (!providerId) return;
    await this.saveGlobal({ provider: providerId });
  },
  
  /**
   * 获取 Provider 配置
   */
  getProviderConfig(providerId) {
    this._ensureInitialized();
    
    // 安全获取默认配置
    const defaults = PROVIDER_DEFAULTS[providerId] || PROVIDER_DEFAULTS.custom || {
      endpoint: '',
      model: '',
      needsApiKey: true,
      hintKey: 'hintCustom',
      displayName: 'Custom'
    };
    
    // 安全获取已保存的配置
    const saved = this._safeGet(this._providerConfigs, providerId, {});
    
    return {
      endpoint: saved.endpoint || defaults.endpoint || '',
      model: saved.model || defaults.model || '',
      apiKey: saved.apiKey || '',
      needsApiKey: defaults.needsApiKey !== false,
      hintKey: defaults.hintKey || 'hintCustom',
      displayName: defaults.displayName || providerId
    };
  },
  
  /**
   * 获取当前完整配置（用于翻译）
   */
  getCurrentFullConfig() {
    this._ensureInitialized();
    const global = this.getGlobal();
    const provider = this.getProviderConfig(global.provider || 'google');
    
    return {
      provider: global.provider || 'google',
      apiEndpoint: provider.endpoint || '',
      apiKey: provider.apiKey || '',
      modelName: provider.model || '',
      sourceLang: global.sourceLang || 'auto',
      targetLang: global.targetLang || 'zh-CN',
      translationStyle: global.translationStyle || 'accurate',
      showOriginal: global.showOriginal !== false,
      autoDetect: global.autoDetect !== false,
      showFab: global.showFab !== false,  // 🔥 添加悬浮按钮配置
      customPrompt: global.customPrompt || '',
      maxTokens: global.maxTokens || 2048,
      temperature: global.temperature || 0.3,
      maxConcurrent: clampMaxConcurrent(global.maxConcurrent),
      uiLanguage: global.uiLanguage || ''  // 🔥 添加UI语言配置
    };
  },
  
  /**
   * 检查当前 Provider 是否已配置
   */
  isCurrentProviderConfigured() {
    const provider = this.getCurrentProvider();
    const config = this.getProviderConfig(provider);
    if (!config.needsApiKey) return true;
    return !!config.apiKey;
  },
  
};

// 兼容旧代码的 currentConfig（将被逐步替换）
let currentConfig = {};

// 兼容旧代码的 DEFAULT_CONFIG
const DEFAULT_CONFIG = DEFAULT_GLOBAL_CONFIG;

// 语言名称映射
const LANG_NAMES = {
  'auto': '自动检测 / Auto',
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

// DOM 元素
let elements = {};

// 当前状态（注意：currentConfig 已在上方 ConfigManager 前声明）
// let currentConfig 在第296行已声明
let isTranslating = false;

// ==================== 状态同步管理器 ====================
/**
 * StateManager - 统一管理 Popup 和 Content Script 之间的状态同步
 * 确保 FAB 开关和翻译状态的双向严格一致
 */
const StateManager = {
  // 当前 tab ID 缓存
  _currentTabId: null,
  
  /**
   * 获取当前活动 tab
   */
  async getCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      if (tab?.id) {
        this._currentTabId = tab.id;
      }
      return tab;
    } catch (e) {
      console.warn('[StateManager] Failed to get current tab:', e);
      return null;
    }
  },
  
  /**
   * 从 Content Script 获取完整状态
   * @returns {Promise<{isTranslating: boolean, hasTranslations: boolean, fabVisible: boolean}>}
   */
  async getContentState() {
    const tab = await this.getCurrentTab();
    if (!tab?.id) return null;
    
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action: 'getTranslationState' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
      ]);
      return response || null;
    } catch (e) {
      // Content script 可能未加载
      return null;
    }
  },
  
  /**
   * 同步翻译状态到 UI
   * 调用 setTranslatingState 来确保统一更新
   * @param {boolean} translating - 是否正在翻译
   */
  syncTranslatingState(translating) {
    // 使用统一的 setTranslatingState 函数
    if (typeof setTranslatingState === 'function') {
      setTranslatingState(translating);
    } else {
      // 回退方案
      isTranslating = translating;
    }
  },
  
  /**
   * 同步 FAB 开关状态到 UI
   * @param {boolean} visible - FAB 是否可见
   */
  syncFabToggle(visible) {
    if (elements.fabToggle) {
      elements.fabToggle.checked = visible;
    }
  },
  
  /**
   * 通知 Content Script 更新翻译状态
   * @param {string} action - 'startTranslate' | 'stopTranslate'
   */
  async notifyTranslationChange(action) {
    const tab = await this.getCurrentTab();
    if (!tab?.id) return;
    
    try {
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (e) {
      console.warn('[StateManager] Failed to notify content script:', e);
    }
  },
  
  /**
   * 通知 Content Script 更新 FAB 显示状态
   * @param {boolean} visible - 是否显示 FAB
   */
  async notifyFabChange(visible) {
    const tab = await this.getCurrentTab();
    if (!tab?.id) return;
    
    try {
      await chrome.tabs.sendMessage(tab.id, { 
        action: visible ? 'showFab' : 'hideFab'
      });
    } catch (e) {
      // 静默处理 - content script 可能未加载
    }
  },
  
  /**
   * 初始化时同步所有状态
   */
  async initSync() {
    const t = window.i18n?.t || ((k) => k);
    
    // 1. 从存储加载 FAB 配置（确保持久化）
    const fabVisible = currentConfig?.showFab !== false;
    this.syncFabToggle(fabVisible);
    
    // 2. 尝试从 Content Script 获取实时翻译状态
    const contentState = await this.getContentState();
    
    if (contentState) {
      // 应用翻译状态
      if (contentState.isTranslating) {
        this.syncTranslatingState(true);
        updateStatus('working', t('translating'), '');
      } else if (contentState.hasTranslations) {
        this.syncTranslatingState(false);
        showRestoreButton();
        updateStatus('success', t('translateComplete'), `${contentState.translatedCount || 0} segments`);
      } else {
        this.syncTranslatingState(false);
        hideRestoreButton();
      }
    }
    
    console.log('[StateManager] Initialized:', { 
      fabVisible, 
      contentState,
      isTranslating 
    });
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  initElements();
  await loadConfig();
  applyI18n();
  initEventListeners();
  updateUI();
  // 🔥 性能优化：不阻塞 UI 渲染，异步同步翻译状态
  // initSync 中的 getContentState() 需要 ping content script，
  // 在大多数页面上 content script 未加载，会触发超时等待。
  // 改为后台静默更新，UI 立即可用。
  StateManager.initSync();
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
  await ConfigManager.saveGlobal({ uiLanguage: newLang });
  
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
    restoreBtn: document.getElementById('restoreBtn'),
    
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
    
    sourceLang: document.getElementById('sourceLang'),
    targetLang: document.getElementById('targetLang'),
    translationStyle: document.getElementById('translationStyle'),
    showOriginal: document.getElementById('showOriginal'),
    autoDetect: document.getElementById('autoDetect'),
    
    // 主界面的 FAB 开关
    fabToggle: document.getElementById('fabToggle'),
    
    customPrompt: document.getElementById('customPrompt'),
    maxTokens: document.getElementById('maxTokens'),
    maxConcurrent: document.getElementById('maxConcurrent'),
    temperature: document.getElementById('temperature'),
    temperatureValue: document.getElementById('temperatureValue'),
    
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    toast: document.getElementById('toast'),
    
    // 控制台
    consoleBody: document.getElementById('consoleBody'),
    clearConsole: document.getElementById('clearConsole'),
    copyConsole: document.getElementById('copyConsole')
  };
}

// ==================== 控制台日志功能 ====================

/**
 * 添加控制台日志
 * @param {string} message - 消息内容
 * @param {string} type - 类型: info, success, warning, error, progress
 */
function logToConsole(message, type = 'info') {
  if (!elements.consoleBody) return;
  
  const time = new Date().toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
  
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.innerHTML = `
    <span class="console-time">${time}</span>
    <span class="console-msg">${escapeHtml(message)}</span>
  `;
  
  elements.consoleBody.appendChild(line);
  
  // 自动滚动到底部
  elements.consoleBody.scrollTop = elements.consoleBody.scrollHeight;
  
  // 限制日志数量（保留最近50条）
  while (elements.consoleBody.children.length > 50) {
    elements.consoleBody.removeChild(elements.consoleBody.firstChild);
  }
}

/**
 * 清空控制台
 */
function clearConsole() {
  if (!elements.consoleBody) return;
  
  const t = window.i18n.t;
  elements.consoleBody.innerHTML = `
    <div class="console-line info">
      <span class="console-time"></span>
      <span class="console-msg">${t('consoleReady')}</span>
    </div>
  `;
}

/**
 * 复制控制台内容
 */
async function copyConsole() {
  if (!elements.consoleBody) return;
  
  const t = window.i18n.t;
  
  // 获取所有日志行的文本
  const lines = elements.consoleBody.querySelectorAll('.console-line');
  const text = Array.from(lines).map(line => {
    const time = line.querySelector('.console-time')?.textContent || '';
    const msg = line.querySelector('.console-msg')?.textContent || '';
    return time ? `[${time}] ${msg}` : msg;
  }).join('\n');
  
  try {
    await navigator.clipboard.writeText(text);
    
    // 显示复制成功的视觉反馈
    if (elements.copyConsole) {
      elements.copyConsole.classList.add('copied');
      setTimeout(() => {
        elements.copyConsole.classList.remove('copied');
      }, 1000);
    }
    
    showToast(t('logCopied'), 'success');
  } catch (err) {
    console.error('复制失败:', err);
    showToast(t('copyFailed'), 'error');
  }
}

/**
 * 解析并翻译错误消息
 * Delegates to shared/providers.js parseTranslationError()
 */
function parseErrorMessage(error) {
  const t = window.i18n.t;
  const result = parseTranslationError(error);
  // Use i18n if available, fall back to the English message
  try {
    return t(result.key) || result.message;
  } catch (e) {
    return result.message;
  }
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 加载配置（🔥 优化：单次 storage 读取完成所有初始化）
async function loadConfig() {
  try {
    await ConfigManager.init();

    // 兼容旧代码：设置 currentConfig
    currentConfig = ConfigManager.getCurrentFullConfig();

    // 设置UI语言
    const global = ConfigManager.getGlobal();
    if (global.uiLanguage) {
      window.i18n.setLanguage(global.uiLanguage);
    }

    console.log('[Popup] Config loaded:', currentConfig);
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// 保存配置（使用 ConfigManager）
async function saveConfig() {
  try {
    // 保存全局配置
    await ConfigManager.saveGlobal({
      provider: currentConfig.provider,
      sourceLang: currentConfig.sourceLang,
      targetLang: currentConfig.targetLang,
      translationStyle: currentConfig.translationStyle,
      showOriginal: currentConfig.showOriginal,
      autoDetect: currentConfig.autoDetect,
      showFab: currentConfig.showFab,
      customPrompt: currentConfig.customPrompt,
      maxTokens: currentConfig.maxTokens,
      temperature: currentConfig.temperature,
      maxConcurrent: clampMaxConcurrent(currentConfig.maxConcurrent),
      uiLanguage: currentConfig.uiLanguage
    });
    
    // 保存当前 Provider 的配置
    await ConfigManager.saveProvider(currentConfig.provider, {
      endpoint: currentConfig.apiEndpoint,
      model: currentConfig.modelName,
      apiKey: currentConfig.apiKey
    });
    
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
  if (elements.restoreBtn) {
    elements.restoreBtn.addEventListener('click', handleRestore);
  }
  
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
  
  // 控制台按钮
  if (elements.clearConsole) {
    elements.clearConsole.addEventListener('click', clearConsole);
  }
  if (elements.copyConsole) {
    elements.copyConsole.addEventListener('click', copyConsole);
  }
  
  // FAB 开关（主界面）
  if (elements.fabToggle) {
    elements.fabToggle.addEventListener('change', handleFabToggle);
  }
}

// 更新UI
function updateUI() {
  const t = window.i18n.t;
  
  // 更新设置表单
  elements.providerSelect.value = currentConfig.provider;
  elements.apiEndpoint.value = currentConfig.apiEndpoint;
  elements.apiKey.value = currentConfig.apiKey;
  elements.modelName.value = currentConfig.modelName;
  if (elements.sourceLang) {
    elements.sourceLang.value = currentConfig.sourceLang || 'auto';
  }
  elements.targetLang.value = currentConfig.targetLang;
  elements.translationStyle.value = currentConfig.translationStyle;
  elements.showOriginal.checked = currentConfig.showOriginal;
  elements.autoDetect.checked = currentConfig.autoDetect;
  // 更新主界面的 FAB 开关
  if (elements.fabToggle) {
    elements.fabToggle.checked = currentConfig.showFab !== false;
  }
  elements.customPrompt.value = currentConfig.customPrompt;
  elements.maxTokens.value = currentConfig.maxTokens;
  if (elements.maxConcurrent) {
    elements.maxConcurrent.value = clampMaxConcurrent(currentConfig.maxConcurrent);
  }
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
  
  // 根据提供商显示/隐藏 API Key 相关字段
  updateApiFieldsVisibility(currentConfig.provider);
}

// 更新引导显示
function updateSetupGuide() {
  if (elements.setupGuide) {
    // 使用 ConfigManager 检查是否需要配置
    const needsSetup = !ConfigManager.isCurrentProviderConfigured();
    elements.setupGuide.style.display = needsSetup ? 'block' : 'none';
  }
}

// 更新提供商提示
function updateProviderHint(provider) {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (defaults && elements.providerHint) {
    elements.providerHint.textContent = window.i18n.t(defaults.hintKey);
  }
}

// 更新API字段可见性（Google翻译不需要API配置）
function updateApiFieldsVisibility(provider) {
  const providerConfig = PROVIDER_DEFAULTS[provider];
  const needsApiKey = providerConfig?.needsApiKey !== false;
  
  // 获取 API 相关的表单组
  const apiEndpointGroup = elements.apiEndpoint?.closest('.form-group');
  const apiKeyGroup = elements.apiKey?.closest('.form-group');
  const modelNameGroup = elements.modelName?.closest('.form-group');
  const testApiGroup = elements.testApiBtn?.closest('.form-group') || elements.testApiBtn;
  
  if (provider === 'google') {
    // Google 翻译隐藏所有 API 相关字段
    if (apiEndpointGroup) apiEndpointGroup.style.display = 'none';
    if (apiKeyGroup) apiKeyGroup.style.display = 'none';
    if (modelNameGroup) modelNameGroup.style.display = 'none';
    if (testApiGroup) testApiGroup.style.display = 'none';
  } else {
    // 其他提供商显示字段
    if (apiEndpointGroup) apiEndpointGroup.style.display = 'block';
    if (apiKeyGroup) apiKeyGroup.style.display = needsApiKey ? 'block' : 'none';
    if (modelNameGroup) modelNameGroup.style.display = 'block';
    if (testApiGroup) testApiGroup.style.display = 'block';
  }
}

// 更新API状态显示
function updateApiStatus() {
  const t = window.i18n.t;
  const statusEl = elements.apiStatus;
  const itemEl = elements.apiStatusItem;
  
  // 使用 ConfigManager 检查配置状态
  const isConfigured = ConfigManager.isCurrentProviderConfigured();
  
  if (isConfigured) {
    statusEl.innerHTML = `<span class="status-dot active"></span><span>${t('configured')}</span>`;
    itemEl.classList.remove('not-configured', 'clickable');
  } else {
    statusEl.innerHTML = `<span class="status-dot"></span><span>${t('clickToConfigure')}</span>`;
    itemEl.classList.add('not-configured', 'clickable');
  }
}

// 获取提供商名称
function getProviderName(provider) {
  // 使用 PROVIDER_DEFAULTS 中的 displayName
  const config = PROVIDER_DEFAULTS[provider];
  if (config?.displayName) {
    // DeepSeek 加星标推荐
    if (provider === 'deepseek') {
      return config.displayName + ' ⭐';
    }
    return config.displayName;
  }
  return provider;
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
    // 🔥 关键：加载该 Provider 已保存的配置
    const savedConfig = ConfigManager.getProviderConfig(provider);
    
    // 使用已保存的配置，如果没有则使用默认值
    elements.apiEndpoint.value = savedConfig.endpoint || defaults.endpoint;
    elements.modelName.value = savedConfig.model || defaults.model;
    elements.apiKey.value = savedConfig.apiKey || '';
    
    updateProviderHint(provider);
    updateApiFieldsVisibility(provider);
    
    if (provider === 'custom') {
      elements.apiEndpoint.placeholder = window.i18n.t('apiAddress');
      elements.modelName.placeholder = window.i18n.t('modelName');
    } else if (provider !== 'google') {
      elements.apiEndpoint.placeholder = defaults.endpoint;
      elements.modelName.placeholder = defaults.model;
    }
    
    // 如果已保存了 API Key，显示提示
    if (savedConfig.apiKey) {
      console.log(`[Popup] Loaded saved API key for ${provider}`);
    }
  }
}

// ==================== 内容脚本通信 ====================

/**
 * 检查内容脚本是否已加载
 * @param {number} tabId - 标签页ID
 * @param {number} timeout - 超时时间(ms)
 * @returns {Promise<boolean>}
 */
async function checkContentScript(tabId, timeout = 2000) {
  if (!tabId || typeof tabId !== 'number') return false;
  
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'ping' }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Ping timeout')), timeout)
      )
    ]);
    return response?.pong === true;
  } catch (error) {
    // 静默处理常见错误
    const msg = error?.message || '';
    if (msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist') ||
        msg.includes('Ping timeout')) {
      return false;
    }
    console.warn('[Popup] checkContentScript error:', msg);
    return false;
  }
}

/**
 * 注入内容脚本
 * @param {number} tabId - 标签页ID
 * @returns {Promise<boolean>}
 */
async function injectContentScript(tabId) {
  if (!tabId || typeof tabId !== 'number') return false;
  
  try {
    // 先尝试注入 CSS（可能已存在，忽略错误）
    try {
    await chrome.scripting.insertCSS({
        target: { tabId },
      files: ['styles/content.css']
    });
    } catch (cssError) {
      // CSS 可能已经存在，忽略
      console.log('[Popup] CSS may already be injected');
    }
    
    // 注入 JS
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    
    return true;
  } catch (error) {
    const msg = error?.message || '';
    
    // 检查是否是"脚本已存在"类型的错误（这其实是好的）
    if (msg.includes('Cannot access') || msg.includes('not allowed')) {
      logToConsole('此页面不支持脚本注入', 'warning');
    return false;
  }
    
    // 检查是否是扩展上下文失效
    if (msg.includes('Extension context invalidated')) {
      logToConsole('扩展已更新，请刷新页面', 'warning');
      return false;
}

    // 其他错误，可能脚本已经存在
    console.warn('[Popup] Script injection result:', msg);
    
    // 返回 true，让后续的 ping 检测来验证
    return true;
  }
}

/**
 * 确保内容脚本已加载（带重试）
 * 由于内容脚本通过 manifest.json 自动注入，这里主要处理：
 * 1. 扩展更新后旧页面需要重新注入
 * 2. 脚本初始化延迟
 * 
 * @param {number} tabId - 标签页ID
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<boolean>}
 */
async function ensureContentScriptLoaded(tabId, maxRetries = 5) {
  // 第一阶段：快速检查（脚本可能已通过 manifest 自动加载）
  logToConsole('检查翻译脚本...', 'info');
  
  // 尝试多次 ping，脚本可能正在初始化
  for (let i = 0; i < 3; i++) {
    if (await checkContentScript(tabId, 1500)) {
      logToConsole('翻译脚本已就绪', 'success');
      return true;
    }
    // 等待脚本初始化
    await sleep(300);
  }
  
  // 第二阶段：尝试手动注入（扩展更新后旧页面需要重新注入）
  logToConsole('尝试重新加载翻译脚本...', 'info');
  
  for (let i = 0; i < maxRetries; i++) {
    logToConsole(`注入脚本中... (${i + 1}/${maxRetries})`, 'info');
    
    const injected = await injectContentScript(tabId);
    
    if (injected) {
      // 等待脚本初始化（给更多时间）
      await sleep(800);
      
      // 验证是否成功
      if (await checkContentScript(tabId, 2000)) {
        logToConsole('翻译脚本加载成功', 'success');
        return true;
      }
    }
    
    // 等待后重试
    if (i < maxRetries - 1) {
      await sleep(500);
    }
  }
  
  // 最后尝试：可能脚本已加载但响应慢
  logToConsole('最后检查...', 'info');
  await sleep(1000);
  if (await checkContentScript(tabId, 3000)) {
    logToConsole('翻译脚本已就绪', 'success');
    return true;
  }
  
  logToConsole('无法加载翻译脚本，请刷新页面', 'error');
  return false;
}

/**
 * 安全发送消息到内容脚本
 * @param {number} tabId - 标签页ID
 * @param {object} message - 消息对象
 * @param {number} timeout - 超时时间(ms)
 * @returns {Promise<any>}
 */
async function sendMessageToTab(tabId, message, timeout = 5000) {
  if (!tabId || !message) {
    throw new Error('Invalid parameters');
  }
  
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Message timeout')), timeout)
      )
    ]);
    return response;
  } catch (error) {
    const msg = error?.message || '';
    
    // 转换为友好的错误消息
    if (msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist')) {
      throw new Error('CONTENT_SCRIPT_NOT_READY');
    }
    if (msg.includes('Message timeout')) {
      throw new Error('CONTENT_SCRIPT_TIMEOUT');
    }
    
    throw error;
  }
}

/**
 * 工具函数：延迟
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查标签页URL是否可翻译
 * @param {string} url - 标签页URL
 * @returns {{ canTranslate: boolean, reason?: string }}
 */
function checkUrlCanTranslate(url) {
  if (!url) {
    return { canTranslate: false, reason: 'NO_URL' };
  }
  
  const blockedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'moz-extension://',
    'file://',
    'view-source:',
    'data:'
  ];
  
  for (const prefix of blockedPrefixes) {
    if (url.startsWith(prefix)) {
      return { canTranslate: false, reason: 'BLOCKED_PAGE' };
    }
  }
  
  return { canTranslate: true };
}

// ==================== 翻译控制 ====================

/**
 * 处理翻译页面（主入口）
 */
async function handleTranslatePage() {
  const t = window.i18n.t;
  
  // 如果正在翻译，则停止
  if (isTranslating) {
    await handleStopTranslate();
    return;
  }
  
  // 验证配置
  const configError = validateTranslationConfig();
  if (configError) {
    showToast(configError, 'error');
    logToConsole(configError, 'error');
    showPanel('settings');
    return;
  }
  
  let tab = null;
  
  try {
    // 获取当前标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs?.[0];
    
    if (!tab?.id) {
      throw new Error('CANNOT_GET_TAB');
    }
    
    // 检查URL是否可翻译
    const urlCheck = checkUrlCanTranslate(tab.url);
    if (!urlCheck.canTranslate) {
      throw new Error(urlCheck.reason);
    }
    
    // 设置翻译状态
    setTranslatingState(true);
    logToConsole(t('consoleStarting'), 'info');
    
    // 确保内容脚本已加载
    const scriptReady = await ensureContentScriptLoaded(tab.id);
    if (!scriptReady) {
      throw new Error('CONTENT_SCRIPT_FAILED');
    }
    
      logToConsole(t('consoleCollecting'), 'info');
    
    // 发送翻译命令
    await sendMessageToTab(tab.id, {
      action: 'translatePage',
      config: currentConfig
    });
    
    logToConsole('翻译已启动', 'success');
    
  } catch (error) {
    handleTranslationError(error, t);
  }
}

/**
 * 验证翻译配置
 * @returns {string|null} 错误消息或null
 */
function validateTranslationConfig() {
  const t = window.i18n.t;
  
  // 确保 currentConfig 有效
  if (!currentConfig || typeof currentConfig !== 'object') {
    return t('errorConfigInvalid') || '配置无效，请刷新页面';
      }
      
  // 检查 Provider 是否需要 API Key
  const provider = currentConfig.provider || 'google';
  const providerConfig = PROVIDER_DEFAULTS[provider];
  const needsApiKey = providerConfig?.needsApiKey !== false;
      
  if (needsApiKey && !currentConfig.apiKey) {
    return t('pleaseConfigureApi') || '请先配置 API Key';
      }
  
  return null;
}

/**
 * 处理翻译错误
 * @param {Error} error - 错误对象
 * @param {Function} t - 翻译函数
 */
function handleTranslationError(error, t) {
  console.error('[Popup] Translation error:', error);
    
  const errorCode = error?.message || 'UNKNOWN';
  let userMessage = '';
  let logMessage = '';
  
  switch (errorCode) {
    case 'CANNOT_GET_TAB':
      userMessage = t('cannotGetPage') || '无法获取当前页面';
      logMessage = userMessage;
      break;
      
    case 'BLOCKED_PAGE':
    case 'NO_URL':
      userMessage = t('cannotUsePage') || '此页面不支持翻译';
      logMessage = userMessage;
      break;
      
    case 'CONTENT_SCRIPT_FAILED':
    case 'CONTENT_SCRIPT_NOT_READY':
      userMessage = t('pleaseRefreshPage') || '请刷新页面后重试';
      logMessage = '内容脚本加载失败，请刷新页面';
      break;
      
    case 'CONTENT_SCRIPT_TIMEOUT':
      userMessage = t('pleaseRefreshPage') || '请刷新页面后重试';
      logMessage = '通信超时，请刷新页面';
      break;
      
    default:
      // 使用通用错误解析
    const friendlyError = parseErrorMessage(error);
      userMessage = friendlyError;
      logMessage = friendlyError;
  }
  
  showToast(userMessage, 'error');
  logToConsole(logMessage, 'error');
  updateStatus('error', t('translateError') || '翻译出错', userMessage);
    setTranslatingState(false);
}

// 设置翻译状态
/**
 * 设置翻译状态（统一入口）
 * 此函数同时更新：1. 内存状态 2. UI 显示
 * 确保 Popup 和 FAB 状态一致
 */
function setTranslatingState(translating) {
  const t = window.i18n.t;
  
  // 更新内存状态
  isTranslating = translating;
  
  // 更新 UI
  if (translating) {
    updateStatus('working', t('translating'), t('translatingDesc'));
    elements.translatePageBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
      </svg>
      <span data-i18n="stopTranslate">${t('stopTranslate')}</span>
    `;
    elements.translatePageBtn.classList.add('translating');
  } else {
    elements.translatePageBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
      </svg>
      <span data-i18n="translatePage">${t('translatePage')}</span>
    `;
    elements.translatePageBtn.classList.remove('translating');
  }
}

// 处理停止翻译
/**
 * 处理停止翻译
 */
async function handleStopTranslate() {
  const t = window.i18n.t;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    
    if (tab?.id) {
      // 尝试发送停止命令，忽略通信错误
      try {
        await sendMessageToTab(tab.id, { action: 'stopTranslate' }, 2000);
      } catch (e) {
        // 静默处理 - 脚本可能已经停止或页面已关闭
        console.warn('[Popup] Stop message failed:', e?.message);
      }
    }
    
    setTranslatingState(false);
    updateStatus('idle', t('stopped'), t('stoppedDesc'));
    logToConsole(t('consoleStopped') || '翻译已停止', 'warning');
    
  } catch (error) {
    console.error('[Popup] Stop error:', error);
    // 确保状态被重置
    setTranslatingState(false);
  }
}

/**
 * 重置翻译按钮状态（保持向后兼容）
 */
function resetTranslateButton() {
  setTranslatingState(false);
}

/**
 * 处理恢复原样（移除所有翻译）
 */
async function handleRestore() {
  const t = window.i18n.t;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    
    if (tab?.id) {
      try {
        await sendMessageToTab(tab.id, { action: 'removeTranslations' }, 3000);
        
        // 隐藏恢复按钮
        if (elements.restoreBtn) {
          elements.restoreBtn.style.display = 'none';
        }
        
        updateStatus('idle', t('restored'), t('restoredDesc'));
        logToConsole(t('consoleRestored'), 'success');
        showToast(t('restored'), 'success');
        
      } catch (e) {
        console.error('Restore error:', e);
        showToast(t('pleaseRefreshPage'), 'error');
      }
    }
    
  } catch (error) {
    console.error('Restore error:', error);
    showToast(t('restoreFailed'), 'error');
  }
}

// 显示恢复按钮
function showRestoreButton() {
  if (elements.restoreBtn) {
    elements.restoreBtn.style.display = 'flex';
  }
}

function hideRestoreButton() {
  if (elements.restoreBtn) {
    elements.restoreBtn.style.display = 'none';
  }
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
  
  // Ollama 不需要 API Key
  const needsApiKey = provider !== 'ollama';
  if (!endpoint || (needsApiKey && !apiKey)) {
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
    sourceLang: elements.sourceLang ? elements.sourceLang.value : 'auto',
    targetLang: elements.targetLang.value,
    translationStyle: elements.translationStyle.value,
    showOriginal: elements.showOriginal.checked,
    autoDetect: elements.autoDetect.checked,
    customPrompt: elements.customPrompt.value.trim(),
    maxTokens: parseInt(elements.maxTokens.value) || 2048,
    temperature: parseFloat(elements.temperature.value) || 0.3,
    maxConcurrent: clampMaxConcurrent(elements.maxConcurrent?.value)
  };
  
  await saveConfig();
  updateUI();
}

// 处理 FAB 开关切换（主界面）
async function handleFabToggle() {
  const newShowFab = elements.fabToggle.checked;
  
  // 1. 更新内存中的配置
  currentConfig.showFab = newShowFab;
  
  // 2. 持久化保存到存储
  await ConfigManager.saveGlobal({ showFab: newShowFab });
  
  // 3. 通知 Content Script 更新 FAB 显示
  await StateManager.notifyFabChange(newShowFab);
  
  console.log('[Popup] FAB toggle changed:', newShowFab);
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
    // 🔥 使用 StateManager 同步状态
    StateManager.syncTranslatingState(false);
    updateStatus('success', t('translateComplete'), `${message.count || 0} segments`);
    const completeMsg = t('consoleCompleted').replace('{count}', message.count || 0);
    logToConsole(completeMsg, 'success');
    showRestoreButton();
    
  } else if (message.action === 'translationError') {
    StateManager.syncTranslatingState(false);
    updateStatus('error', t('translateError'), message.error || '');
    const friendlyError = parseErrorMessage({ message: message.error });
    logToConsole(friendlyError, 'error');
    showToast(friendlyError, 'error');
    
  } else if (message.action === 'translationProgress') {
    // 确保翻译状态为 true
    if (!isTranslating) {
      StateManager.syncTranslatingState(true);
    }
    updateStatus('working', t('translating'), `${message.current}/${message.total}`);
    if (message.current % 5 === 0 || message.current === message.total) {
      const progressMsg = t('consoleTranslating')
        .replace('{current}', message.current)
        .replace('{total}', message.total);
      logToConsole(progressMsg, 'progress');
    }
    
  } else if (message.action === 'translationStateChanged') {
    // 🔥 FAB 和 Popup 之间的状态同步（来自 Content Script）
    if (message.status === 'translating') {
      StateManager.syncTranslatingState(true);
      updateStatus('working', t('translating'), '');
      logToConsole(t('consoleStarting'), 'info');
    } else if (message.status === 'stopped') {
      StateManager.syncTranslatingState(false);
      updateStatus('idle', t('stopped'), t('stoppedDesc'));
      logToConsole(t('consoleStopped'), 'warning');
      if (message.hasTranslations) {
        showRestoreButton();
      } else {
        hideRestoreButton();
      }
    } else if (message.status === 'idle') {
      StateManager.syncTranslatingState(false);
      updateStatus('idle', t('ready'), t('readyDesc'));
      hideRestoreButton();
      logToConsole(t('consoleRestored') || '已恢复原样', 'info');
    }
    
  } else if (message.action === 'consoleLog') {
    logToConsole(message.text, message.type || 'info');
    
  } else if (message.action === 'fabStateChanged') {
    // 🔥 FAB 状态从 content script 同步过来（用户通过 FAB 关闭按钮关闭）
    console.log('[Popup] FAB state changed from content:', message.showFab);
    
    // 更新 UI 开关
    if (elements.fabToggle) {
      elements.fabToggle.checked = message.showFab;
    }
    
    // 更新内存配置
    if (currentConfig) {
      currentConfig.showFab = message.showFab;
  }
}
});

// 应用翻译状态到 UI（供 StateManager 使用）
function applyTranslationState(state) {
  const t = window.i18n.t;
  
  if (state.isTranslating) {
    StateManager.syncTranslatingState(true);
    updateStatus('working', t('translating'), '');
  } else if (state.hasTranslations) {
    StateManager.syncTranslatingState(false);
    showRestoreButton();
    updateStatus('success', t('translateComplete'), `${state.translatedCount || 0} segments`);
  } else {
    StateManager.syncTranslatingState(false);
    hideRestoreButton();
    updateStatus('idle', t('ready'), t('readyDesc'));
  }
}
