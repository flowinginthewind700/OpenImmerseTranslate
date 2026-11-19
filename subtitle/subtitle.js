const subtitleCore = window.OITSubtitleCore;
const subtitleControllerApi = window.OITSubtitleController;
const extensionConfig = window.OITExtensionConfig;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const RENDER_CHUNK_SIZE = 120;

if (!subtitleCore || !subtitleControllerApi || !extensionConfig) {
  throw new Error('Subtitle workspace dependencies failed to initialize');
}

const elements = {
  importView: document.getElementById('importView'),
  workspace: document.getElementById('workspace'),
  fileInput: document.getElementById('fileInput'),
  chooseFileBtn: document.getElementById('chooseFileBtn'),
  replaceFileBtn: document.getElementById('replaceFileBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  providerDot: document.getElementById('providerDot'),
  providerName: document.getElementById('providerName'),
  sourceLang: document.getElementById('sourceLang'),
  targetLang: document.getElementById('targetLang'),
  translateBtn: document.getElementById('translateBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  clearBtn: document.getElementById('clearBtn'),
  exportSrtBtn: document.getElementById('exportSrtBtn'),
  exportVttBtn: document.getElementById('exportVttBtn'),
  includeSource: document.getElementById('includeSource'),
  fileName: document.getElementById('fileName'),
  fileMeta: document.getElementById('fileMeta'),
  editorTitle: document.getElementById('editorTitle'),
  formatLabel: document.getElementById('formatLabel'),
  segmentCount: document.getElementById('segmentCount'),
  translationCount: document.getElementById('translationCount'),
  cueList: document.getElementById('cueList'),
  cueRowTemplate: document.getElementById('cueRowTemplate'),
  progressBlock: document.getElementById('progressBlock'),
  progressLabel: document.getElementById('progressLabel'),
  progressCount: document.getElementById('progressCount'),
  progressTrack: document.getElementById('progressTrack'),
  progressBar: document.getElementById('progressBar'),
  progressDetail: document.getElementById('progressDetail'),
  warningPanel: document.getElementById('warningPanel'),
  warningSummary: document.getElementById('warningSummary'),
  warningList: document.getElementById('warningList'),
  toast: document.getElementById('toast'),
};

const state = {
  config: null,
  cues: [],
  segments: [],
  sourceFilename: '',
  format: 'srt',
  warnings: [],
  translating: false,
  controller: null,
  renderGeneration: 0,
  translationGeneration: 0,
};

let toastTimer = 0;

function formatMessage(key, replacements = {}) {
  const template = window.i18n?.t(key) || key;
  return Object.entries(replacements).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function applyI18n() {
  document.documentElement.lang = window.i18n?.getCurrentLanguage() || 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = window.i18n?.t(element.dataset.i18n) || element.textContent;
  });
}

function showToast(message, type = 'info', duration = 3200) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', type === 'error');
  elements.toast.classList.add('visible');
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('visible');
  }, duration);
}

function hasTextTranslation(segment) {
  return Boolean(String(segment?.translatedText || '').trim());
}

function getTranslationCount() {
  return state.segments.filter(hasTextTranslation).length;
}

function getSegmentById(segmentId) {
  return state.segments.find(segment => segment.id === segmentId);
}

function updateProviderSummary() {
  if (!state.config) return;
  const configured = extensionConfig.isProviderConfigured(
    state.config,
    window.OITProviders?.PROVIDER_DEFAULTS,
  );
  elements.providerName.textContent = extensionConfig.getProviderDisplayName(
    state.config.provider,
    window.OITProviders?.PROVIDER_DEFAULTS,
  );
  elements.providerDot.classList.toggle('configured', configured);
  elements.providerName.title = configured
    ? elements.providerName.textContent
    : formatMessage('subtitleNotConfigured');

  if (!configured && state.segments.length === 0) {
    showToast(formatMessage('subtitleConfigureFirst'), 'error');
  }
  updateTranslateButton();
}

function updateTranslateButton() {
  const configured = state.config && extensionConfig.isProviderConfigured(
    state.config,
    window.OITProviders?.PROVIDER_DEFAULTS,
  );
  const translatedCount = getTranslationCount();
  const missingCount = state.segments.length - translatedCount;
  let label = window.i18n?.t('subtitleTranslate') || 'Translate';

  if (state.translating) {
    label = window.i18n?.t('subtitleTranslating') || 'Translating';
  } else if (translatedCount > 0 && missingCount > 0) {
    label = window.i18n?.t('subtitleRetryMissing') || 'Continue Translation';
  } else if (translatedCount > 0 && missingCount === 0) {
    label = window.i18n?.t('subtitleRetranslate') || 'Translate Again';
  }

  const labelNode = elements.translateBtn.querySelector('span');
  if (labelNode) labelNode.textContent = label;
  elements.translateBtn.disabled = state.translating
    || !configured
    || state.segments.length === 0;
  elements.translateBtn.hidden = state.translating;
  elements.cancelBtn.hidden = !state.translating;
  elements.sourceLang.disabled = state.translating;
  elements.targetLang.disabled = state.translating;
  elements.clearBtn.disabled = state.translating || translatedCount === 0;
  elements.exportSrtBtn.disabled = state.translating || translatedCount === 0;
  elements.exportVttBtn.disabled = state.translating || translatedCount === 0;
  elements.cueList.querySelectorAll('.cue-translation').forEach(textarea => {
    textarea.disabled = state.translating;
  });
}

function updateTranslationSummary() {
  const translatedCount = getTranslationCount();
  elements.translationCount.textContent = formatMessage('subtitleTranslatedCount', {
    count: translatedCount,
    total: state.segments.length,
  });
  updateTranslateButton();
}

function setProgress({ label, current, total, detail, stateName = 'working' }) {
  elements.progressBlock.hidden = false;
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
  const percentage = safeTotal === 0 ? 0 : Math.round((safeCurrent / safeTotal) * 100);

  if (label) elements.progressLabel.textContent = label;
  if (detail !== undefined) elements.progressDetail.textContent = detail;
  elements.progressCount.textContent = formatMessage('subtitleProgress', {
    current: safeCurrent,
    total: safeTotal,
  });
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressTrack.setAttribute('aria-valuenow', String(percentage));
  elements.progressBar.dataset.state = stateName;
}

function renderWarnings(warnings) {
  elements.warningList.replaceChildren();
  if (!warnings.length) {
    elements.warningPanel.hidden = true;
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement('li');
    item.textContent = warning.line
      ? `Line ${warning.line}: ${warning.message}`
      : warning.message;
    elements.warningList.append(item);
  }
  elements.warningSummary.textContent = formatMessage('subtitleWarnings', {
    count: warnings.length,
  });
  elements.warningPanel.hidden = false;
}

function formatClock(seconds) {
  return subtitleCore.formatTimestamp(seconds, 'srt');
}

function createCueRow(segment, index) {
  const row = elements.cueRowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.segmentId = segment.id;
  row.querySelector('.cue-number').textContent = String(index + 1).padStart(2, '0');
  row.querySelector('.cue-time').textContent = (
    `${formatClock(segment.start)}\n${formatClock(segment.end)}`
  );
  row.querySelector('.cue-source').textContent = segment.sourceText;

  const textarea = row.querySelector('.cue-translation');
  textarea.dataset.segmentId = segment.id;
  textarea.value = segment.translatedText || '';
  textarea.disabled = state.translating;
  textarea.setAttribute(
    'aria-label',
    `${window.i18n?.t('targetLang') || 'Translation'} ${index + 1}`,
  );
  textarea.placeholder = window.i18n?.t('targetLang') || 'Translation';
  updateCueState(row, segment);
  return row;
}

function updateCueState(row, segment) {
  const status = row.querySelector('.cue-state');
  const translated = hasTextTranslation(segment);
  status.textContent = translated
    ? (window.i18n?.t('subtitleTranslated') || 'Translated')
    : (window.i18n?.t('subtitleReady') || 'Ready');
  status.classList.toggle('translated', translated);
}

function updateRowState(segmentId) {
  const segment = getSegmentById(segmentId);
  if (!segment) return;
  const row = elements.cueList.querySelector(
    `.cue-row[data-segment-id="${CSS.escape(segmentId)}"]`,
  );
  if (row) updateCueState(row, segment);
}

async function renderCueRows() {
  const generation = ++state.renderGeneration;
  elements.cueList.replaceChildren();

  for (let start = 0; start < state.segments.length; start += RENDER_CHUNK_SIZE) {
    if (generation !== state.renderGeneration) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(start + RENDER_CHUNK_SIZE, state.segments.length);
    for (let index = start; index < end; index++) {
      fragment.append(createCueRow(state.segments[index], index));
    }
    elements.cueList.append(fragment);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

function showWorkspace() {
  elements.importView.hidden = true;
  elements.workspace.hidden = false;
  elements.fileName.textContent = state.sourceFilename;
  elements.editorTitle.textContent = state.sourceFilename;
  elements.formatLabel.textContent = state.format.toUpperCase();
  elements.fileMeta.textContent = formatMessage('subtitleCueCount', {
    count: state.cues.length,
  });
  elements.segmentCount.textContent = formatMessage('subtitleSegmentCount', {
    count: state.segments.length,
  });
  updateTranslationSummary();
  setProgress({
    label: window.i18n?.t('subtitleReady') || 'Ready',
    current: 0,
    total: 0,
    detail: formatMessage('subtitleTranslatedCount', {
      count: 0,
      total: state.segments.length,
    }),
    stateName: 'ready',
  });
  renderWarnings(state.warnings);
  renderCueRows();
}

function showImportView() {
  elements.workspace.hidden = true;
  elements.importView.hidden = false;
}

function decodeSubtitleBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function readSubtitleFile(file) {
  const lowerName = String(file?.name || '').toLowerCase();
  if (!file || (!lowerName.endsWith('.srt') && !lowerName.endsWith('.vtt'))) {
    throw new Error(formatMessage('subtitleInvalidFile'));
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(formatMessage('subtitleFileTooLarge'));
  }

  const buffer = await file.arrayBuffer();
  return decodeSubtitleBuffer(buffer);
}

function rebuildSegments() {
  state.segments = subtitleCore.buildSegments(state.cues, {
    sourceLang: elements.sourceLang.value || 'auto',
  });
}

async function importFile(file) {
  try {
    const source = await readSubtitleFile(file);
    const subtitleDocument = subtitleCore.parseSubtitle(source, {
      filename: file.name,
    });
    if (subtitleDocument.cues.length === 0) {
      throw new Error(formatMessage('subtitleNoCues'));
    }

    if (state.translating) {
      const previousController = state.controller;
      state.translationGeneration++;
      state.translating = false;
      state.controller = null;
      previousController?.cancel('replace-file');
    }
    state.cues = subtitleDocument.cues;
    state.sourceFilename = file.name;
    state.format = subtitleDocument.format;
    state.warnings = subtitleDocument.warnings;
    rebuildSegments();
    if (state.segments.length === 0) {
      throw new Error(formatMessage('subtitleNoCues'));
    }

    showWorkspace();
    elements.fileInput.value = '';
  } catch (error) {
    showToast(error?.message || formatMessage('subtitleInvalidFile'), 'error');
  }
}

async function loadConfig() {
  state.config = await extensionConfig.loadRuntimeConfig(chrome.storage.sync, {
    providerDefaults: window.OITProviders?.PROVIDER_DEFAULTS,
  });
  updateProviderSummary();
}

function applyConfigToControls() {
  if (!state.config) return;
  elements.sourceLang.value = state.config.sourceLang || 'auto';
  elements.targetLang.value = state.config.targetLang || 'zh-CN';
  const language = state.config.uiLanguage || window.i18n?.getCurrentLanguage();
  if (language && window.i18n?.setLanguage(language)) {
    applyI18n();
  }
}

function createAbortError() {
  return subtitleControllerApi.createAbortError('Subtitle request cancelled');
}

async function translateBatch(texts, details) {
  const response = await chrome.runtime.sendMessage({
    action: 'translate',
    texts,
    config: {
      ...state.config,
      sourceLang: elements.sourceLang.value,
      targetLang: elements.targetLang.value,
    },
    context: {
      ...details.context,
      scene: 'subtitle',
      sourceFormat: state.format,
      batchIndex: details.batchIndex,
      batchCount: details.totalBatches,
    },
    requestId: details.requestId,
  });

  if (response?.cancelled) {
    throw createAbortError();
  }
  if (response?.error) {
    throw new Error(response.error);
  }
  return response?.translations;
}

function abortRequest(requestId) {
  chrome.runtime.sendMessage({
    action: 'abortRequest',
    requestId,
  }).catch(() => {});
  return true;
}

function mergeTranslatedSegments(translatedSegments) {
  const translatedById = new Map(
    translatedSegments.map(segment => [segment.id, segment.translatedText]),
  );
  state.segments.forEach(segment => {
    if (!translatedById.has(segment.id)) return;
    segment.translatedText = translatedById.get(segment.id);
    const textarea = elements.cueList.querySelector(
      `.cue-translation[data-segment-id="${CSS.escape(segment.id)}"]`,
    );
    if (textarea) textarea.value = segment.translatedText;
    updateRowState(segment.id);
  });
}

async function translateSubtitles() {
  if (state.translating) return;
  const configured = state.config && extensionConfig.isProviderConfigured(
    state.config,
    window.OITProviders?.PROVIDER_DEFAULTS,
  );
  if (!configured) {
    showToast(formatMessage('subtitleConfigureFirst'), 'error');
    return;
  }

  const translatedCount = getTranslationCount();
  const missingSegments = state.segments.filter(segment => !hasTextTranslation(segment));
  const requestedSegments = translatedCount === state.segments.length
    ? state.segments
    : missingSegments;
  if (requestedSegments.length === 0) return;

  state.config.sourceLang = elements.sourceLang.value;
  state.config.targetLang = elements.targetLang.value;
  const controller = subtitleControllerApi.createSubtitleTranslationController({
    translateBatch,
    abortRequest,
    createBatches: (segments, options) => subtitleCore.createTranslationBatches(
      segments,
      options,
    ),
  });
  const translationGeneration = ++state.translationGeneration;
  const isCurrentTranslation = () => (
    state.translating
    && state.controller === controller
    && state.translationGeneration === translationGeneration
  );
  state.translating = true;
  state.controller = controller;
  updateTranslateButton();
  setProgress({
    label: window.i18n?.t('subtitleTranslating') || 'Translating',
    current: 0,
    total: 0,
    detail: formatMessage('subtitleTranslatedCount', {
      count: translatedCount,
      total: state.segments.length,
    }),
  });

  try {
    const result = await controller.translate(requestedSegments, {
      batchOptions: {
        maxItems: 8,
        maxCharacters: 3200,
      },
      continueOnError: true,
      requestIdPrefix: 'subtitle',
      onProgress: event => {
        if (!isCurrentTranslation()) return;
        if (event.type === 'start') {
          setProgress({
            label: window.i18n?.t('subtitleTranslating') || 'Translating',
            current: 0,
            total: event.totalBatches,
            detail: formatMessage('subtitleTranslatedCount', {
              count: getTranslationCount(),
              total: state.segments.length,
            }),
          });
        } else if (event.type === 'batch-complete' || event.type === 'batch-error') {
          setProgress({
            label: window.i18n?.t('subtitleTranslating') || 'Translating',
            current: event.processedBatches,
            total: event.totalBatches,
            detail: formatMessage('subtitleTranslatedCount', {
              count: getTranslationCount(),
              total: state.segments.length,
            }),
            stateName: event.type === 'batch-error' ? 'error' : 'working',
          });
        }
      },
      onBatchComplete: event => {
        if (!isCurrentTranslation()) return;
        mergeTranslatedSegments(event.translatedItems || []);
        setProgress({
          label: window.i18n?.t('subtitleTranslating') || 'Translating',
          current: event.processedBatches,
          total: event.totalBatches,
          detail: formatMessage('subtitleTranslatedCount', {
            count: getTranslationCount(),
            total: state.segments.length,
          }),
        });
      },
      onBatchError: event => {
        if (!isCurrentTranslation()) return;
        showToast(event.message, 'error', 5000);
      },
    });

    if (!isCurrentTranslation()) return;
    mergeTranslatedSegments(result.segments);
    const finalTranslatedCount = getTranslationCount();
    const finalProcessed = result.totalBatches;
    if (result.cancelled) {
      setProgress({
        label: window.i18n?.t('subtitleCancelled') || 'Stopped',
        current: result.processedBatches,
        total: finalProcessed,
        detail: formatMessage('subtitleTranslatedCount', {
          count: finalTranslatedCount,
          total: state.segments.length,
        }),
        stateName: 'cancelled',
      });
    } else if (result.failures.length > 0) {
      setProgress({
        label: window.i18n?.t('subtitlePartial') || 'Partially complete',
        current: result.processedBatches,
        total: finalProcessed,
        detail: formatMessage('subtitleTranslatedCount', {
          count: finalTranslatedCount,
          total: state.segments.length,
        }),
        stateName: 'error',
      });
    } else {
      setProgress({
        label: window.i18n?.t('subtitleComplete') || 'Complete',
        current: finalProcessed,
        total: finalProcessed,
        detail: formatMessage('subtitleTranslatedCount', {
          count: finalTranslatedCount,
          total: state.segments.length,
        }),
        stateName: 'complete',
      });
    }
  } catch (error) {
    if (!isCurrentTranslation()) return;
    const friendly = window.parseTranslationError?.(error);
    const message = friendly?.message || error?.message || String(error);
    setProgress({
      label: window.i18n?.t('subtitleFailed') || 'Translation failed',
      current: 0,
      total: 0,
      detail: message,
      stateName: 'error',
    });
    showToast(message, 'error', 5000);
  } finally {
    if (isCurrentTranslation()) {
      state.translating = false;
      state.controller = null;
      updateTranslationSummary();
    }
  }
}

function cancelTranslation() {
  if (!state.controller) return;
  state.controller.cancel('user');
}

function clearTranslations() {
  if (state.translating) return;
  state.segments.forEach(segment => {
    segment.translatedText = '';
    const textarea = elements.cueList.querySelector(
      `.cue-translation[data-segment-id="${CSS.escape(segment.id)}"]`,
    );
    if (textarea) textarea.value = '';
    updateRowState(segment.id);
  });
  setProgress({
    label: window.i18n?.t('subtitleReady') || 'Ready',
    current: 0,
    total: 0,
    detail: formatMessage('subtitleTranslatedCount', {
      count: 0,
      total: state.segments.length,
    }),
    stateName: 'ready',
  });
  updateTranslationSummary();
}

function getExportFilename(format) {
  const base = state.sourceFilename.replace(/\.(?:srt|vtt)$/i, '') || 'subtitle';
  return `${base}.bilingual.${format}`;
}

function exportSubtitles(format) {
  const content = subtitleCore.serializeSubtitles(state.segments, {
    format,
    includeSource: elements.includeSource.checked,
  });
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = getExportFilename(format);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openSettings() {
  window.open(chrome.runtime.getURL('popup/popup.html#settings'), '_blank', 'noopener');
}

function openFilePicker() {
  elements.fileInput.click();
}

function handleSourceLanguageChange() {
  if (state.segments.length === 0) return;
  if (getTranslationCount() > 0) {
    const confirmed = window.confirm(
      window.i18n?.t('subtitleLanguageResetConfirm')
        || 'Changing the language will clear existing translations. Continue?',
    );
    if (!confirmed) {
      elements.sourceLang.value = state.config?.sourceLang || 'auto';
      return;
    }
  }
  rebuildSegments();
  state.config.sourceLang = elements.sourceLang.value;
  updateTranslationSummary();
  renderCueRows();
  setProgress({
    label: window.i18n?.t('subtitleReady') || 'Ready',
    current: 0,
    total: 0,
    detail: formatMessage('subtitleTranslatedCount', {
      count: 0,
      total: state.segments.length,
    }),
    stateName: 'ready',
  });
}

function handleTargetLanguageChange() {
  if (state.segments.length === 0) return;
  if (getTranslationCount() > 0) {
    const confirmed = window.confirm(
      window.i18n?.t('subtitleLanguageResetConfirm')
        || 'Changing the language will clear existing translations. Continue?',
    );
    if (!confirmed) {
      elements.targetLang.value = state.config?.targetLang || 'zh-CN';
      return;
    }
    clearTranslations();
  }
  if (state.config) state.config.targetLang = elements.targetLang.value;
}

function initEventListeners() {
  elements.chooseFileBtn.addEventListener('click', openFilePicker);
  elements.replaceFileBtn.addEventListener('click', openFilePicker);
  elements.fileInput.addEventListener('change', event => {
    const [file] = event.target.files || [];
    if (file) importFile(file);
  });
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.translateBtn.addEventListener('click', translateSubtitles);
  elements.cancelBtn.addEventListener('click', cancelTranslation);
  elements.clearBtn.addEventListener('click', clearTranslations);
  elements.exportSrtBtn.addEventListener('click', () => exportSubtitles('srt'));
  elements.exportVttBtn.addEventListener('click', () => exportSubtitles('vtt'));
  elements.sourceLang.addEventListener('change', handleSourceLanguageChange);
  elements.targetLang.addEventListener('change', handleTargetLanguageChange);

  elements.cueList.addEventListener('input', event => {
    const textarea = event.target.closest('.cue-translation');
    if (!textarea) return;
    const segment = getSegmentById(textarea.dataset.segmentId);
    if (!segment) return;
    segment.translatedText = textarea.value;
    updateRowState(segment.id);
    updateTranslationSummary();
  });

  for (const eventName of ['dragenter', 'dragover']) {
    elements.chooseFileBtn.addEventListener(eventName, event => {
      event.preventDefault();
      elements.chooseFileBtn.classList.add('drag-over');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    elements.chooseFileBtn.addEventListener(eventName, event => {
      event.preventDefault();
      elements.chooseFileBtn.classList.remove('drag-over');
    });
  }
  elements.chooseFileBtn.addEventListener('drop', event => {
    const [file] = event.dataTransfer?.files || [];
    if (file) importFile(file);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync'
        || (!changes.globalConfig && !changes.providerConfigs)
        || state.translating) {
      return;
    }
    loadConfig()
      .then(updateProviderSummary)
      .catch(error => console.warn('[Subtitle] Config refresh failed:', error));
  });

  window.addEventListener('beforeunload', () => {
    state.controller?.cancel('page-unload');
  });
}

async function init() {
  try {
    await loadConfig();
    applyConfigToControls();
    updateProviderSummary();
  } catch (error) {
    console.error('[Subtitle] Configuration failed:', error);
    showToast(error?.message || 'Unable to load configuration', 'error', 5000);
  }
  initEventListeners();
  updateTranslateButton();
}

init();
