/**
 * Open Immerse Translate - subtitle parsing and segmentation kernel.
 *
 * This module is independent of extension messaging and DOM rendering. It
 * parses SRT/WebVTT, creates bounded translation segments, and serializes
 * bilingual output while preserving cue timing.
 */
(function initSubtitleCore(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.OITSubtitleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSubtitleCore() {
  'use strict';

  const SEGMENTATION_DEFAULTS = Object.freeze({
    maxCharacters: 280,
    maxCjkCharacters: 120,
    maxDurationSeconds: 10,
    mergeGapSeconds: 0.65,
  });
  const BATCH_DEFAULTS = Object.freeze({
    maxItems: 8,
    maxCharacters: 3200,
  });
  const SENTENCE_END_PATTERN = /[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]?$/;
  const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

  function normalizeNewlines(value) {
    return String(value ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function decodeEntities(value) {
    const entities = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    };
    return String(value ?? '').replace(
      /&(#x?[0-9a-f]+|[a-z]+);/gi,
      (match, entity) => {
        const normalized = entity.toLowerCase();
        if (normalized.startsWith('#x')) {
          const codePoint = Number.parseInt(normalized.slice(2), 16);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        if (normalized.startsWith('#')) {
          const codePoint = Number.parseInt(normalized.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return entities[normalized] ?? match;
      },
    );
  }

  function cleanCueText(lines) {
    return normalizeText(
      decodeEntities(
        lines
          .join(' ')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>\n]+>/g, ''),
      ),
    );
  }

  function parseTimestamp(value) {
    const match = String(value ?? '').trim().match(
      /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/,
    );
    if (!match) return null;

    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (!Number.isFinite(hours)
        || !Number.isFinite(minutes)
        || !Number.isFinite(seconds)
        || minutes > 59
        || seconds > 59) {
      return null;
    }

    const milliseconds = Number(match[4].padEnd(3, '0'));
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
  }

  function detectFormat(source, filename) {
    const firstLine = normalizeNewlines(source).split('\n', 1)[0].trim().toUpperCase();
    if (firstLine === 'WEBVTT' || firstLine.startsWith('WEBVTT ')) return 'vtt';
    if (String(filename || '').toLowerCase().endsWith('.vtt')) return 'vtt';
    return 'srt';
  }

  function parseTimingLine(line) {
    const parts = String(line ?? '').split(/\s+-->\s+/, 2);
    if (parts.length !== 2) return null;
    const startText = parts[0].trim();
    const endText = parts[1].trim().split(/\s+/, 1)[0];
    const start = parseTimestamp(startText);
    const end = parseTimestamp(endText);
    if (start === null || end === null || end <= start) return null;
    return { start, end };
  }

  function parseSubtitle(source, options = {}) {
    const normalized = normalizeNewlines(source);
    const format = detectFormat(normalized, options.filename);
    const lines = normalized.split('\n');
    const cues = [];
    const warnings = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) {
        index++;
        continue;
      }

      if (format === 'vtt' && /^WEBVTT(?:\s|$)/i.test(line)) {
        index++;
        while (index < lines.length && lines[index].trim() !== '') index++;
        continue;
      }

      if (format === 'vtt' && /^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(line)) {
        index++;
        while (index < lines.length && lines[index].trim() !== '') index++;
        continue;
      }

      if (!line.includes('-->')) {
        const nextLine = lines[index + 1]?.trim() || '';
        if (format === 'srt'
            && /^\d+$/.test(line)
            && nextLine
            && !nextLine.includes('-->')) {
          warnings.push({
            line: index + 2,
            message: 'Invalid subtitle timing block',
          });
          index += 2;
          while (index < lines.length && lines[index].trim() !== '') {
            index++;
          }
          continue;
        }
        index++;
        continue;
      }

      const timing = parseTimingLine(line);
      const textLines = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].trim() !== '') {
        if (lines[cursor].includes('-->')) break;
        textLines.push(lines[cursor]);
        cursor++;
      }

      if (!timing) {
        warnings.push({
          line: index + 1,
          message: 'Invalid subtitle timing range',
        });
      } else {
        const text = cleanCueText(textLines);
        if (text) {
          cues.push({
            id: `cue-${cues.length + 1}`,
            start: timing.start,
            end: timing.end,
            text,
          });
        } else {
          warnings.push({
            line: index + 1,
            message: 'Subtitle cue has no readable text',
          });
        }
      }
      index = Math.max(cursor, index + 1);
    }

    if (cues.length === 0 && warnings.length === 0) {
      warnings.push({ line: 0, message: 'No subtitle cues found' });
    }

    return {
      format,
      cues,
      warnings,
    };
  }

  function isCjkSource(sourceLang, text) {
    const language = String(sourceLang || '').toLowerCase();
    return /^(?:zh|ja|ko)(?:-|$)/.test(language)
      || (sourceLang === 'auto' && CJK_PATTERN.test(text));
  }

  function splitWordText(text, limit) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return splitCharacterText(text, limit);
    const parts = [];
    let current = '';

    for (const word of words) {
      if (word.length > limit) {
        if (current) {
          parts.push(current);
          current = '';
        }
        parts.push(...splitCharacterText(word, limit));
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > limit && current) {
        parts.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) parts.push(current);
    return parts;
  }

  function splitCharacterText(text, limit) {
    const characters = Array.from(text);
    const parts = [];
    for (let index = 0; index < characters.length; index += limit) {
      parts.push(characters.slice(index, index + limit).join(''));
    }
    return parts.filter(Boolean);
  }

  function splitCue(cue, options) {
    const text = normalizeText(cue.text);
    const cjk = isCjkSource(options.sourceLang, text);
    const limit = cjk
      ? options.maxCjkCharacters
      : options.maxCharacters;
    const parts = cjk || !/\s/.test(text)
      ? splitCharacterText(text, limit)
      : splitWordText(text, limit);

    if (parts.length <= 1) {
      return [{
        id: `${cue.id}:part-1`,
        sourceCueId: cue.id,
        sourceCueIds: [cue.id],
        start: cue.start,
        end: cue.end,
        text,
        sourceText: text,
        translatedText: '',
      }];
    }

    const totalCharacters = parts.reduce((sum, part) => sum + part.length, 0) || 1;
    const duration = cue.end - cue.start;
    let consumed = 0;
    return parts.map((part, partIndex) => {
      const start = cue.start + (duration * (consumed / totalCharacters));
      consumed += part.length;
      const end = partIndex === parts.length - 1
        ? cue.end
        : cue.start + (duration * (consumed / totalCharacters));
      return {
        id: `${cue.id}:part-${partIndex + 1}`,
        sourceCueId: cue.id,
        sourceCueIds: [cue.id],
        start,
        end: Math.max(start + 0.001, end),
        text,
        sourceText: part,
        translatedText: '',
      };
    });
  }

  function resolveSegmentationOptions(options = {}) {
    return {
      sourceLang: options.sourceLang || 'auto',
      maxCharacters: Math.max(20, Number(options.maxCharacters)
        || SEGMENTATION_DEFAULTS.maxCharacters),
      maxCjkCharacters: Math.max(10, Number(options.maxCjkCharacters)
        || SEGMENTATION_DEFAULTS.maxCjkCharacters),
      maxDurationSeconds: Math.max(1, Number(options.maxDurationSeconds)
        || SEGMENTATION_DEFAULTS.maxDurationSeconds),
      mergeGapSeconds: Math.max(0, Number(options.mergeGapSeconds)
        || SEGMENTATION_DEFAULTS.mergeGapSeconds),
    };
  }

  function buildSegments(cues, options = {}) {
    const settings = resolveSegmentationOptions(options);
    const segments = [];
    const sortedCues = (Array.isArray(cues) ? cues : [])
      .filter(cue => cue
        && Number.isFinite(cue.start)
        && Number.isFinite(cue.end)
        && cue.end > cue.start
        && normalizeText(cue.text))
      .slice()
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map((cue, index) => ({
        ...cue,
        id: cue.id || `cue-${index + 1}`,
        text: normalizeText(cue.text),
      }));

    for (const cue of sortedCues) {
      const parts = splitCue(cue, settings);
      for (const part of parts) {
        const previous = segments[segments.length - 1];
        const separator = isCjkSource(settings.sourceLang, part.sourceText) ? '' : ' ';
        const mergedText = previous
          ? `${previous.sourceText}${separator}${part.sourceText}`
          : part.sourceText;
        const canMerge = previous
          && previous.sourceCueId !== part.sourceCueId
          && part.start >= previous.end
          && (part.start - previous.end) <= settings.mergeGapSeconds
          && (part.end - previous.start) <= settings.maxDurationSeconds
          && mergedText.length <= (
            isCjkSource(settings.sourceLang, mergedText)
              ? settings.maxCjkCharacters
              : settings.maxCharacters
          )
          && !SENTENCE_END_PATTERN.test(previous.sourceText);

        if (canMerge) {
          previous.end = part.end;
          previous.sourceText = mergedText;
          previous.text = mergedText;
          previous.sourceCueIds.push(part.sourceCueId);
          previous.id = previous.sourceCueIds.join('+');
        } else {
          segments.push({
            ...part,
            sourceCueIds: part.sourceCueIds.slice(),
          });
        }
      }
    }

    return segments;
  }

  function createTranslationBatches(segments, options = {}) {
    const maxItems = Math.max(1, Number(options.maxItems) || BATCH_DEFAULTS.maxItems);
    const maxCharacters = Math.max(
      1,
      Number(options.maxCharacters) || BATCH_DEFAULTS.maxCharacters,
    );
    const batches = [];
    let current = [];
    let characters = 0;

    for (const segment of Array.isArray(segments) ? segments : []) {
      const length = String(segment?.sourceText || '').length;
      if (current.length > 0
          && (current.length >= maxItems || characters + length > maxCharacters)) {
        batches.push(current);
        current = [];
        characters = 0;
      }
      current.push(segment);
      characters += length;
    }

    if (current.length > 0) batches.push(current);
    return batches;
  }

  function formatTimestamp(seconds, format) {
    const safe = Math.max(0, Number(seconds) || 0);
    const milliseconds = Math.round(safe * 1000);
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const wholeSeconds = Math.floor((milliseconds % 60000) / 1000);
    const remainder = milliseconds % 1000;
    const separator = format === 'vtt' ? '.' : ',';
    return [
      String(hours).padStart(2, '0'),
      String(minutes).padStart(2, '0'),
      `${String(wholeSeconds).padStart(2, '0')}${separator}${String(remainder).padStart(3, '0')}`,
    ].join(':');
  }

  function serializeSubtitles(segments, options = {}) {
    const format = options.format === 'vtt' ? 'vtt' : 'srt';
    const includeSource = options.includeSource !== false;
    const blocks = [];
    let cueNumber = 0;

    (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
      const timing = [
        formatTimestamp(segment.start, format),
        '-->',
        formatTimestamp(segment.end, format),
      ].join(' ');
      const textLines = [];
      if (includeSource) {
        textLines.push(normalizeText(segment.sourceText || segment.text));
      }
      if (normalizeText(segment.translatedText)) {
        textLines.push(normalizeText(segment.translatedText));
      }
      if (textLines.length === 0) return;
      cueNumber++;
      blocks.push([
        format === 'srt' ? String(cueNumber) : segment.id || `cue-${index + 1}`,
        timing,
        textLines.join('\n'),
      ].join('\n'));
    });

    const body = blocks.join('\n\n');
    return format === 'vtt'
      ? `WEBVTT\n\n${body}${body ? '\n' : ''}`
      : `${body}${body ? '\n' : ''}`;
  }

  return Object.freeze({
    SEGMENTATION_DEFAULTS,
    BATCH_DEFAULTS,
    normalizeNewlines,
    normalizeText,
    parseTimestamp,
    parseSubtitle,
    buildSegments,
    createTranslationBatches,
    formatTimestamp,
    serializeSubtitles,
  });
});
