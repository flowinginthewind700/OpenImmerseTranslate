/**
 * 国际化支持
 */

const LANGUAGES = {
  'zh-CN': {
    // 主界面
    appName: 'Open Immerse',
    translatePage: '翻译当前页面',
    stopTranslate: '停止翻译',
    restore: '恢复原样',
    restored: '已恢复',
    restoredDesc: '页面已恢复原样',
    restoreFailed: '恢复失败',
    consoleRestored: '✓ 页面已恢复原样',
    ready: '就绪',
    readyDesc: '点击上方按钮开始翻译',
    translating: '翻译中...',
    translatingDesc: '正在处理页面内容',
    translateComplete: '翻译完成',
    translateError: '翻译出错',
    stopped: '已停止',
    stoppedDesc: '翻译已中断',
    
    // 配置预览
    currentConfig: '当前配置',
    translationService: '翻译服务',
    targetLanguage: '目标语言',
    apiStatus: 'API状态',
    configured: '已配置',
    notConfigured: '未配置',
    clickToConfigure: '点击配置 →',
    
    // 设置页面
    settings: '设置',
    back: '返回',
    save: '保存',
    settingsSaved: '设置已保存',
    saveFailed: '保存失败',
    
    // AI服务配置
    aiServiceConfig: '🤖 AI 翻译服务',
    serviceProvider: '服务提供商',
    apiAddress: 'API 地址 (Base URL)',
    apiKey: 'API 密钥 (API Key)',
    modelName: '模型名称',
    testConnection: '测试连接',
    testing: '测试中...',
    connectionSuccess: '✓ 连接成功！',
    connectionFailed: '连接失败',
    
    // 提供商
    providerOpenAI: 'OpenAI (GPT-4o)',
    providerDeepSeek: 'DeepSeek 深度求索',
    providerMoonshot: 'Moonshot Kimi',
    providerZhipu: '智谱 GLM',
    providerAnthropic: 'Anthropic Claude',
    providerOllama: 'Ollama (本地运行)',
    providerCustom: '自定义 OpenAI 兼容 API',
    
    // 提供商提示
    hintOpenAI: '使用 OpenAI 官方 API，需要 API Key',
    hintDeepSeek: 'DeepSeek 深度求索，国产高性价比模型',
    hintMoonshot: 'Moonshot Kimi，月之暗面出品',
    hintZhipu: '智谱 GLM，清华系大模型',
    hintAnthropic: '使用 Anthropic Claude API',
    hintOllama: '本地运行 Ollama，无需 API Key。首次使用请在终端运行: OLLAMA_ORIGINS=* ollama serve',
    hintCustom: '填入任意 OpenAI 兼容的 API 地址和密钥',
    
    // 翻译设置
    translationSettings: '🌍 翻译设置',
    targetLang: '目标语言',
    translationStyle: '翻译风格',
    styleAccurate: '准确翻译 - 忠实原文',
    styleFluent: '流畅翻译 - 自然通顺',
    styleCreative: '意译 - 生动地道',
    showOriginal: '显示原文（双语对照）',
    autoDetect: '自动检测源语言',
    
    // 高级设置
    advancedSettings: '⚙️ 高级设置',
    customPrompt: '自定义翻译提示词（可选）',
    customPromptPlaceholder: '留空使用默认提示词，可用 {targetLang} 代替目标语言',
    maxTokens: '最大 Token 数',
    temperature: 'Temperature (创造性 0-1)',
    
    // 错误提示
    pleaseConfigureApi: '请先配置 API 密钥',
    pleaseRefreshPage: '请刷新页面后重试',
    cannotUsePage: '无法在此页面使用翻译',
    cannotGetPage: '无法获取当前页面',
    fillApiAndKey: '请填写 API 地址和密钥',
    
    // 引导提示
    setupGuide: '🎯 首次使用？请先配置 API',
    setupGuideDesc: '点击此处设置您的 AI 翻译服务',
    
    // 控制台
    console: '控制台',
    copyLog: '复制日志',
    clearLog: '清空日志',
    logCopied: '日志已复制到剪贴板',
    copyFailed: '复制失败',
    consoleReady: '准备就绪，点击翻译开始',
    consoleStarting: '开始翻译页面...',
    consoleCollecting: '正在收集页面文本...',
    consoleFound: '发现 {count} 个文本块',
    consoleTranslating: '正在翻译第 {current}/{total} 批...',
    consoleCompleted: '翻译完成！共翻译 {count} 段文本',
    consoleStopped: '翻译已停止',
    consoleError: '错误：{message}',
    
    // 用户友好的错误消息
    errorApiKeyInvalid: '🔑 API 密钥无效，请检查密钥是否正确',
    errorApiKeyMissing: '请先配置 API 密钥',
    errorNetworkFailed: '🌐 网络连接失败，请检查网络',
    errorRateLimit: '⏳ API 请求过于频繁，正在自动重试...',
    errorQuotaExceeded: '📊 API 配额已用尽，请检查账户余额',
    errorInsufficientBalance: '⚠️ 账户余额不足或已暂停，请充值后重试',
    errorServerError: '🔧 AI 服务暂时不可用，请稍后重试',
    errorTimeout: '⏱️ 请求超时，网络可能不稳定',
    errorInvalidResponse: 'AI 返回了无效的响应',
    errorModelNotFound: '🤖 模型不存在，请检查模型名称',
    errorPermissionDenied: '🚫 没有权限访问此 API',
    errorUnknown: '❓ 发生未知错误'
  },
  
  'en': {
    // Main interface
    appName: 'Open Immerse',
    translatePage: 'Translate Page',
    stopTranslate: 'Stop',
    restore: 'Restore',
    restored: 'Restored',
    restoredDesc: 'Page restored to original',
    restoreFailed: 'Restore failed',
    consoleRestored: '✓ Page restored to original',
    ready: 'Ready',
    readyDesc: 'Click button above to start',
    translating: 'Translating...',
    translatingDesc: 'Processing page content',
    translateComplete: 'Complete',
    translateError: 'Error',
    stopped: 'Stopped',
    stoppedDesc: 'Translation interrupted',
    
    // Config preview
    currentConfig: 'Configuration',
    translationService: 'Service',
    targetLanguage: 'Target Language',
    apiStatus: 'API Status',
    configured: 'Configured',
    notConfigured: 'Not configured',
    clickToConfigure: 'Click to configure →',
    
    // Settings page
    settings: 'Settings',
    back: 'Back',
    save: 'Save',
    settingsSaved: 'Settings saved',
    saveFailed: 'Save failed',
    
    // AI service config
    aiServiceConfig: '🤖 AI Translation Service',
    serviceProvider: 'Service Provider',
    apiAddress: 'API Address (Base URL)',
    apiKey: 'API Key',
    modelName: 'Model Name',
    testConnection: 'Test Connection',
    testing: 'Testing...',
    connectionSuccess: '✓ Connected!',
    connectionFailed: 'Connection failed',
    
    // Providers
    providerOpenAI: 'OpenAI (GPT-4o)',
    providerDeepSeek: 'DeepSeek',
    providerMoonshot: 'Moonshot Kimi',
    providerZhipu: 'Zhipu GLM',
    providerAnthropic: 'Anthropic Claude',
    providerOllama: 'Ollama (Local)',
    providerCustom: 'Custom OpenAI Compatible API',
    
    // Provider hints
    hintOpenAI: 'Use OpenAI official API',
    hintDeepSeek: 'DeepSeek, cost-effective Chinese model',
    hintMoonshot: 'Moonshot Kimi by Moonshot AI',
    hintZhipu: 'Zhipu GLM, Tsinghua AI model',
    hintAnthropic: 'Use Anthropic Claude API',
    hintOllama: 'Run locally with Ollama, no API key needed. First time: run "OLLAMA_ORIGINS=* ollama serve" in terminal',
    hintCustom: 'Enter any OpenAI compatible API',
    
    // Translation settings
    translationSettings: '🌍 Translation Settings',
    targetLang: 'Target Language',
    translationStyle: 'Translation Style',
    styleAccurate: 'Accurate - Faithful to original',
    styleFluent: 'Fluent - Natural expression',
    styleCreative: 'Creative - Vivid interpretation',
    showOriginal: 'Show original (Bilingual)',
    autoDetect: 'Auto-detect source language',
    
    // Advanced settings
    advancedSettings: '⚙️ Advanced Settings',
    customPrompt: 'Custom Translation Prompt (Optional)',
    customPromptPlaceholder: 'Leave empty for default, use {targetLang} for target language',
    maxTokens: 'Max Tokens',
    temperature: 'Temperature (Creativity 0-1)',
    
    // Error messages
    pleaseConfigureApi: 'Please configure API key first',
    pleaseRefreshPage: 'Please refresh the page and try again',
    cannotUsePage: 'Cannot translate this page',
    cannotGetPage: 'Cannot access current page',
    fillApiAndKey: 'Please fill in API address and key',
    
    // Setup guide
    setupGuide: '🎯 First time? Configure API',
    setupGuideDesc: 'Click here to set up your AI translation service',
    
    // Console
    console: 'Console',
    copyLog: 'Copy Log',
    clearLog: 'Clear Log',
    logCopied: 'Log copied to clipboard',
    copyFailed: 'Copy failed',
    consoleReady: 'Ready. Click translate to start',
    consoleStarting: 'Starting page translation...',
    consoleCollecting: 'Collecting page text...',
    consoleFound: 'Found {count} text blocks',
    consoleTranslating: 'Translating batch {current}/{total}...',
    consoleCompleted: 'Complete! Translated {count} segments',
    consoleStopped: 'Translation stopped',
    consoleError: 'Error: {message}',
    
    // User-friendly error messages
    errorApiKeyInvalid: '🔑 Invalid API key. Please check your key',
    errorApiKeyMissing: 'Please configure API key first',
    errorNetworkFailed: '🌐 Network error. Check your connection',
    errorRateLimit: '⏳ Too many requests. Retrying automatically...',
    errorQuotaExceeded: '📊 API quota exceeded. Check account balance',
    errorInsufficientBalance: '⚠️ Insufficient balance or account suspended. Please recharge',
    errorServerError: '🔧 AI service unavailable. Try again later',
    errorTimeout: '⏱️ Request timed out. Network may be unstable',
    errorInvalidResponse: 'Invalid response from AI',
    errorModelNotFound: '🤖 Model not found. Check model name',
    errorPermissionDenied: '🚫 Permission denied for this API',
    errorUnknown: '❓ An unknown error occurred'
  }
};

// 获取浏览器语言
function getBrowserLanguage() {
  const lang = navigator.language || navigator.userLanguage;
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

// 当前语言
let currentLanguage = getBrowserLanguage();

// 获取翻译文本
function t(key) {
  const lang = LANGUAGES[currentLanguage] || LANGUAGES['en'];
  return lang[key] || LANGUAGES['en'][key] || key;
}

// 设置语言
function setLanguage(lang) {
  if (LANGUAGES[lang]) {
    currentLanguage = lang;
    return true;
  }
  return false;
}

// 获取当前语言
function getCurrentLanguage() {
  return currentLanguage;
}

// 导出
window.i18n = {
  t,
  setLanguage,
  getCurrentLanguage,
  LANGUAGES
};

