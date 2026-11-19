/**
 * Open Immerse Translate - model and provider policy.
 *
 * Provider differences stay out of transport functions. This module builds
 * request bodies and parses response envelopes for OpenAI-compatible,
 * Anthropic, and Ollama APIs.
 */
(function initModelPolicy(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITModelPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModelPolicy() {
  'use strict';

  const REASONING_MODEL_PATTERN = /^(?:gpt-5(?:$|[-_.])|o[1-4](?:$|[-_.]))/i;
  const THINKING_MODEL_PATTERN = /(?:reason|thinking|think)/i;

  function normalizeProvider(value) {
    return String(value || 'custom').trim().toLowerCase();
  }

  function inferProvider(config = {}) {
    const endpoint = String(config.apiEndpoint || '').toLowerCase();
    if (endpoint.includes('api.anthropic.com')) return 'anthropic';
    if (endpoint.includes('api.deepseek.com')) return 'deepseek';
    if (endpoint.includes('api.moonshot.cn')) return 'moonshot';
    if (endpoint.includes('bigmodel.cn')) return 'zhipu';
    if (endpoint.includes('dashscope.aliyuncs.com')) return 'dashscope';
    if (endpoint.includes('siliconflow.cn')) return 'siliconflow';
    if (endpoint.includes('localhost:11434') || endpoint.includes('127.0.0.1:11434')) {
      return 'ollama';
    }
    if (endpoint.includes('api.openai.com')) return 'openai';
    return normalizeProvider(config.provider);
  }

  function clampNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  }

  function supportsTemperature(model) {
    return !REASONING_MODEL_PATTERN.test(String(model || ''));
  }

  function isResponsesEndpoint(endpoint) {
    return /\/responses\/?(?:[?#]|$)/i.test(String(endpoint || '').trim());
  }

  function normalizeMaxTokens(value) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 2048;
  }

  function shouldDisableThinking(provider, model) {
    const normalizedModel = String(model || '').toLowerCase();
    if (provider === 'deepseek') {
      return THINKING_MODEL_PATTERN.test(normalizedModel)
        || normalizedModel.includes('v3.2');
    }
    if (provider === 'moonshot') {
      return /kimi-k2|thinking|reason/.test(normalizedModel);
    }
    if (provider === 'zhipu') {
      return /glm-(?:4\.5|4\.6|5)/.test(normalizedModel)
        || THINKING_MODEL_PATTERN.test(normalizedModel);
    }
    return false;
  }

  function buildHeaders(config, nativeAnthropic = false) {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = String(config.apiKey || '').trim();
    if (apiKey) {
      if (nativeAnthropic) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }
    return headers;
  }

  function buildOpenAICompatibleRequest(config = {}, systemPrompt, userPrompt) {
    const provider = inferProvider(config);
    const model = String(config.modelName || '');
    const maxTokens = normalizeMaxTokens(config.maxTokens);
    const usesResponsesApi = isResponsesEndpoint(config.apiEndpoint);
    const body = { model };

    if (usesResponsesApi) {
      body.instructions = systemPrompt;
      body.input = userPrompt;
      body.max_output_tokens = maxTokens;
      if (supportsTemperature(model)) {
        body.temperature = clampNumber(config.temperature, 0.3, 0, 1);
      }
    } else {
      body.messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      if (supportsTemperature(model)) {
        body.temperature = clampNumber(config.temperature, 0.3, 0, 1);
        body.max_tokens = maxTokens;
      } else {
        body.max_completion_tokens = maxTokens;
      }

      if (shouldDisableThinking(provider, model)) {
        body.thinking = { type: 'disabled' };
      }
      if ((provider === 'dashscope' || provider === 'siliconflow')
          && /qwen3|thinking|reason/i.test(model)) {
        body.enable_thinking = false;
      }
    }

    return Object.freeze({
      provider,
      endpoint: String(config.apiEndpoint || ''),
      headers: Object.freeze(buildHeaders(config)),
      body: Object.freeze(body)
    });
  }

  function normalizeOllamaEndpoint(endpoint) {
    const value = String(endpoint || 'http://localhost:11434/api/chat');
    if (value.includes('/v1/chat/completions')) {
      return value.replace('/v1/chat/completions', '/api/chat');
    }
    if (!value.includes('/api/')) return `${value.replace(/\/$/, '')}/api/chat`;
    return value;
  }

  function buildOllamaRequest(config = {}, systemPrompt, userPrompt) {
    return Object.freeze({
      provider: 'ollama',
      endpoint: normalizeOllamaEndpoint(config.apiEndpoint),
      headers: Object.freeze({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }),
      body: Object.freeze({
        model: String(config.modelName || ''),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: Object.freeze({
          temperature: clampNumber(config.temperature, 0.3, 0, 1)
        })
      })
    });
  }

  function buildAnthropicRequest(config = {}, systemPrompt, userPrompt) {
    return Object.freeze({
      provider: 'anthropic',
      endpoint: String(config.apiEndpoint || 'https://api.anthropic.com/v1/messages'),
      headers: Object.freeze(buildHeaders(config, true)),
      body: Object.freeze({
        model: String(config.modelName || ''),
        max_tokens: normalizeMaxTokens(config.maxTokens),
        temperature: clampNumber(config.temperature, 0.3, 0, 1),
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
  }

  function contentBlocksToText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map(block => typeof block === 'string' ? block : block?.text || '')
      .filter(Boolean)
      .join('');
  }

  function parseProviderResponse(provider, data) {
    const normalized = normalizeProvider(provider);
    if (normalized === 'anthropic') {
      return contentBlocksToText(data?.content);
    }
    if (normalized === 'ollama') {
      return data?.message?.content || data?.response || '';
    }

    const choiceContent = contentBlocksToText(data?.choices?.[0]?.message?.content);
    if (choiceContent) return choiceContent;
    if (typeof data?.output_text === 'string') return data.output_text;
    if (Array.isArray(data?.output)) {
      return data.output
        .flatMap(item => item?.content || [])
        .map(item => item?.text || '')
        .filter(Boolean)
        .join('');
    }
    return data?.response || '';
  }

  return Object.freeze({
    inferProvider,
    normalizeProvider,
    supportsTemperature,
    shouldDisableThinking,
    isResponsesEndpoint,
    normalizeMaxTokens,
    buildHeaders,
    buildOpenAICompatibleRequest,
    normalizeOllamaEndpoint,
    buildOllamaRequest,
    buildAnthropicRequest,
    parseProviderResponse
  });
});
