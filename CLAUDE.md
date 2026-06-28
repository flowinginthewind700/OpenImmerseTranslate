# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Immerse Translate is a Chrome extension (Manifest V3) that provides immersive bilingual translation. It defaults to Google Translate (free, no API key needed) and supports multiple LLM providers (DeepSeek, OpenAI, Claude, Moonshot, Zhipu GLM, Ollama, and custom OpenAI-compatible APIs).

## Build and Development Commands

```bash
# Build the extension for distribution
npm run build

# Generate icon assets from SVG source
npm run icons

# Development workflow
# After making changes, load/reload the extension in Chrome:
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select the project root directory
# 4. Or load the built version from dist/OpenImmerseTranslate/
```

**Build output**: `npm run build` creates `dist/OpenImmerseTranslate/` (unpackaged) and `dist/OpenImmerseTranslate-v{version}.zip` (packaged for distribution).

**No live reload**: Extension development requires manual reload in `chrome://extensions/` after code changes.

**No bundler/transpiler**: The extension is loaded as raw JS files. The service worker is `"type": "module"` in the manifest but doesn't use `import`/`export` statements. No TypeScript, no webpack/vite.

**No tests or linting**: There are zero test files, no ESLint/Prettier config, and no CI/CD workflows. All verification is manual in Chrome.

## Architecture

### Three-Part Chrome Extension Architecture

The extension follows the standard Manifest V3 architecture with three isolated JavaScript contexts:

1. **Background Service Worker** (`background/service-worker.js`, ~770 lines)
   - Handles all API requests to translation services
   - RateLimiter class: max 3 concurrent, 300ms minimum interval (polling-based, not queue-based — uses `setTimeout` retries)
   - Retry mechanism: `withRetry()` with exponential backoff (2s base delay, 3 retries). Only retries on rate-limit errors; abort errors are re-thrown immediately.
   - **Request cancellation**: `inflightControllers` Map tracks AbortController per requestId; `abortRequest()` cancels fetch for viewport-departed content
   - Tab state management (tracks translation status per tab)
   - Message passing hub between popup and content scripts
   - Right-click context menu items ("翻译整个页面", "移除翻译")

2. **Content Script** (`content/content.js`, ~2667 lines)
   - Injected into all web pages at `document_end`
   - **TranslationState class**: Central state machine managing the entire translation lifecycle — queue, concurrency control, observers, deduplication
   - **Streaming/single-translate mode**: `SINGLE_TRANSLATE: true` — each text block is sent as a separate API call (not batched), with concurrency capped at `MAX_CONCURRENT: 6`
   - Viewport-prioritized translation using Intersection Observer (`ROOT_MARGIN: '50% 0px 150% 0px'` — 50% above, 150% below viewport)
   - Floating Action Button (FAB) with drag, auto-mini, and edge-snap behavior (position persisted to `chrome.storage.local`)
   - Text-selection translation (mouseup handler → floating translate button → inline result panel)
   - Adaptive periodic scan with dynamic intervals (2s idle → up to 8s when queue is full)
   - Handles extension context invalidation (shows warning on extension reload)

3. **Popup UI** (`popup/popup.js`, ~1791 lines; `popup/popup.html`)
   - Extension settings interface with built-in console (max 50 lines, color-coded log levels)
   - **ConfigManager**: Modular per-provider configuration stored in `chrome.storage.sync` under keys `globalConfig` and `providerConfigs`
   - **StateManager**: Bidirectional state sync between popup and content script (translation state, FAB visibility)
   - Content script loading with retry: `ensureContentScriptLoaded()` — quick ping (3 attempts, 300ms gap) then manual injection (5 attempts, 800ms gap)
   - i18n support (`popup/i18n.js`) for 2 UI languages (zh-CN, en); 15 target languages
   - API key management, temperature slider, custom prompt editor

### TranslationState Class (content/content.js)

The `TranslationState` class is the core orchestrator. Key properties:
- `isActive`, `shouldStop` — control flags checked throughout the pipeline
- `completedElements` — WeakSet of translated DOM elements
- `processedTexts` — Set of already-translated text strings
- `translationQueue` — **PriorityQueue** (heap-like ordered array, max size 100) of pending blocks sorted by viewport proximity
- `activeTranslations` — counter for concurrency control
- `queueResolvers` — array of Promise resolve callbacks for **event-driven slot management** (avoids polling)
- `inflightRequests` — Map of element → `{requestId, blocks}` for **AbortController-based cancellation**
- `pendingElements`, `translatingElements` — Sets for efficient element tracking (avoids `querySelectorAll`)
- `blockMap` — Map of element → block data for IntersectionObserver
- `requestIdCounter` — monotonic counter for generating unique request IDs

**`reset()`** clears queue, timers, observers but preserves `processedTexts` and `completedElements`. **`fullReset()`** also clears deduplication state.

### Translation Scheduling (v1.7.0: Priority + Preemption + Batch)

The translation pipeline uses 5 key optimizations:

1. **Priority Queue** (`PriorityQueue` class, `computeBlockPriority()`)
   - Each block scores by: distance from viewport center (primary), visible ratio, wait time (anti-starvation), tag importance (h1-h6/p/blockquote get +500)
   - Queue is sorted descending by score; new blocks insert at correct position
   - Max 100 items; lowest-priority items evicted when full

2. **Viewport Reordering + Preemption** (`reorderQueue()`)
   - Called on scroll/resize/mutation/new-block-detected
   - Re-scores all queued blocks and re-sorts
   - Cancels in-flight requests for elements that have scrolled far out of viewport (>1 viewport above or >2 viewports below)

3. **AbortController Cancellation** (content → service-worker)
   - Each `translateBatch` creates a unique `requestId` and stores it in `state.inflightRequests`
   - When elements leave viewport, content script sends `{action: 'abortRequest', requestId}` to service worker
   - Service worker maintains `inflightControllers` Map; `AbortController.abort()` cancels the `fetch()`
   - All API functions (`callGoogleTranslateApi`, `callOpenAICompatibleApi`, `callOllamaApi`, `callAnthropicApi`) accept `signal` and pass it to `fetch()`
   - `stopTranslation()` calls `cancelAllInflightRequests()` to abort all pending requests

4. **Event-Driven Slot Management** (`acquireSlot()`, `releaseSlot()`)
   - Replaces polling (`sleep(50)` loops) with Promise-based wakeup
   - When `activeTranslations < MAX_CONCURRENT`, `acquireSlot()` resolves immediately
   - Otherwise returns a Promise stored in `queueResolvers[]`; `releaseSlot()` wakes the next waiter

5. **Spatial Batch Translation** (`dequeueBatch()`)
   - Groups spatially-nearby blocks (within 400px Y distance) into a single LLM request
   - Config: `BATCH_SIZE: 4`, `BATCH_MAX_CHARS: 2000`, `BATCH_MAX_DISTANCE: 400`
   - Reduces API calls and TTFT while maintaining per-block display granularity

### Key Translation Flow

1. User clicks FAB or popup "Translate Page" button
2. Content script calls `startTranslation(config)` which resets state, scans viewport via `collectViewportBlocks()`, queues blocks by priority, and starts:
   - `processQueue()` — main loop: acquire slot → dequeue batch → `translateBatch()` (async, non-blocking)
   - Scroll listener (passive, with SPA overflow-container attachment, calls `reorderQueue()`)
   - MutationObserver (200ms debounced, detects dynamically added content)
   - `scanAndObserveAll()` in idle callback
   - `periodicScan` — adaptive timing based on queue depth
3. `translateBatch()` sends `chrome.runtime.sendMessage({action:'translate', requestId, texts, config})` with unique requestId
4. Service worker routes to API handler, passes `AbortSignal` through to `fetch()`; returns translated text (or `{cancelled: true}` if aborted)
5. `applyTranslation()` renders bilingual display (three modes: Twitter/append mode, text-node wrap mode, translation-only mode)

### Deduplication

Multiple layers prevent re-translating the same content:
- **`isAlreadyTranslated(element)`**: WeakMap cache → `completedElements` WeakSet → DOM query for `.oit-wrapper`/`.oit-translation` → parent chain walk. Caches both positive and negative results.
- **`isSameContent()`**: Whitespace-normalized lowercase comparison against `processedTexts`
- **`isTargetLanguage()`**: Precompiled regex patterns (`REGEX_PATTERNS`) detect CJK character ratio thresholds to skip content already in the target language
- SKIP_TAGS (19 HTML tags), SKIP_CLASSES (5 class names), and CONTAINER_TAGS (27 HTML tags) filter non-translatable elements

### FAB (Floating Action Button)

- Draggable via mouse and touch events, snaps to left/right viewport edges (20px margin)
- Position persisted to `chrome.storage.local` under key `fabPosition`
- 3-second auto-mini mode on idle; mouse enter/leave toggles expanded/mini
- Three states: idle (blue/purple gradient), translating (orange/red pulse animation), completed (green checkmark, auto-resets after 3s)
- Close button saves preference to `chrome.storage.sync` under `globalConfig.showFab` and broadcasts to popup
- Toggle visibility synced across devices via `chrome.storage.sync`

### Selection Translation

- `mouseup` handler detects text selections, shows a floating translate button at cursor position
- On click: retrieves full config from storage, sends to service worker, displays result in a floating panel
- Panel includes copy-to-clipboard, close button, HTML escaping, and viewport boundary clamping

### Performance Optimizations (v1.6.12)

Documented in `PERFORMANCE_OPTIMIZATIONS.md`. Key patterns:
1. `pendingElements`/`translatingElements` Sets instead of global `querySelectorAll`
2. Batch `getBoundingClientRect` in Read-Measure-Process phases (avoids layout thrashing)
3. Adaptive scroll scan intervals (50ms for large scrolls, 100ms debounced for small)
4. Precompiled regex via `REGEX_PATTERNS` object
5. Named event handler functions enabling proper cleanup (no anonymous handlers on `beforeunload`)
6. WeakMap cache for `isAlreadyTranslated()` checks
7. Preallocated array in `buildUserPrompt()` (avoid spread operator in hot path)
8. Lazy element caching with `isAlreadyTranslated()`

Code comments use `🔥` to mark performance-critical sections.

### ConfigManager Storage Model

Config is stored in `chrome.storage.sync` under two keys:
- `globalConfig`: provider choice, source/target language, translation style, FAB visibility, custom prompt, max tokens, temperature, UI language
- `providerConfigs`: per-provider objects (each with `endpoint`, `model`, `apiKey`)

**Provider defaults** are duplicated in `popup/popup.js` (`PROVIDER_DEFAULTS`) and `content/content.js` (`getDefaultEndpoint()`, `getDefaultModel()`). When adding a new provider, both locations must be updated.

## API Provider System

All LLM providers (except Google) use OpenAI-compatible endpoints:
- **OpenAI-compatible**: DeepSeek, OpenAI, Moonshot, Zhipu GLM, Custom — uses `callOpenAICompatibleApi()`
- **Anthropic**: Separate handler (`callAnthropicApi()`) for Claude API format (`x-api-key` header, `anthropic-version`, different body shape)
- **Ollama**: Local model support (`callOllamaApi()`), auto-corrects `/v1/chat/completions` to `/api/chat`
- **Google Translate**: Free public API via `translate.googleapis.com/translate_a/single`, no authentication

Provider configs stored separately in chrome.storage.sync with keys like `provider_config_deepseek`, `provider_config_openai`, etc.

## Important Implementation Details

### Extension Context Invalidation

When the extension is reloaded/updated, content scripts lose access to Chrome APIs. The code handles this gracefully:
- `isExtensionContextValid()`: Checks if `chrome.runtime.id` is accessible
- `safeChrome()`: Wraps all chrome API calls with context validation
- Shows user-friendly warning overlay when context is invalidated (bottom toast with refresh button, auto-hides after 10s, only shown once per page load via `contextWarningShown` flag)
- User must refresh the page to continue using the extension

### Tab State Management

Background worker maintains a Map of tab states (`tabStates`):
- `isTranslating`: Prevents concurrent translations
- `translatedCount`: Tracks progress
- `hasTranslations`: Whether tab has active translations
- Auto-cleaned on `chrome.tabs.onRemoved` and `chrome.tabs.onUpdated` (when `status === 'loading'` with a new URL)

### Rate Limiting

RateLimiter class prevents API abuse:
- Configurable max concurrent requests (default: 3)
- Minimum interval between requests (default: 300ms)
- Uses polling-based wait (`setTimeout` retries every 100ms) rather than a queue
- `acquire()` blocks until a slot is free, `release()` decrements active count

### Retry Mechanism

`withRetry(fn, maxRetries=3, baseDelay=2000)` with exponential backoff. Only retries on rate-limit errors (detected by string matching on error messages containing "concurrency", "rate limit", "too many requests", "429"). Non-rate-limit errors are thrown immediately without retry.

### Content Script Loading (from Popup)

The popup must ensure the content script is loaded before sending commands. `ensureContentScriptLoaded()` uses a two-phase approach:
1. Quick ping (3 attempts, 300ms gap) — most pages have the script already injected
2. Manual injection (5 retries, 800ms wait) — for pages where manifest injection failed

`checkUrlCanTranslate()` blocks restricted URL schemes: `chrome://`, `chrome-extension://`, `edge://`, `about:`, `file://`, `view-source:`, `data:`.

### Error Handling Patterns

- Service worker: `withRetry()` for transient errors, `try/catch` with friendly responses for permanent errors
- Content script: All chrome API calls wrapped in `safeChrome()` with context validation; `parseFriendlyError()` converts raw API errors to Chinese user-facing messages
- Popup: `parseErrorMessage()` maps error strings to i18n keys (balance, API key, rate limit, quota, timeout, network, server, model, permission); `handleTranslationError()` maps error codes to user messages
- **Note**: `parseFriendlyError()` in content.js and `parseErrorMessage()` in popup.js are near-duplicates — changes to error handling should update both

### Google Translate Handler

- Converts language codes via `convertToGoogleLangCode()` (limited code mapping)
- Calls `https://translate.googleapis.com/translate_a/single?client=gtx&sl=...&tl=...&dt=t&q=...`
- Parses response format: `[[["translation","original",null,null,1]],null,"en"]`
- On error, falls back to returning the original text (does not throw)
- Iterates texts one-by-one through the rate limiter; checks `signal?.aborted` between items
- Supports `AbortSignal` for cancellation

### Translation Parsing

`parseTranslations(content)` splits LLM responses on `[SEP]` delimiters, trims, and filters empties. This is a simplistic split — edge cases with `[SEP]` appearing in translated text are not handled.

## Version Management

Version is stored in `manifest.json` (`version` field). The build script reads this to name the output zip file. **Note**: `package.json` version (`1.1.0`) is not kept in sync with `manifest.json` (`1.6.12`). The manifest version is the source of truth. Update the version in `manifest.json` before running `npm run build`.

## Commit Conventions

Follow Conventional Commits format (see CONTRIBUTING.md):
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation
- `refactor`: Code refactoring
- `perf`: Performance improvements

## Known Codebase Patterns

- **Duplicate provider defaults**: `PROVIDER_DEFAULTS` in popup.js and `getDefaultEndpoint()`/`getDefaultModel()` in content.js serve the same purpose. Adding a provider requires changes in both files.
- **Duplicate error parsing**: `parseFriendlyError()` (content.js) and `parseErrorMessage()` (popup.js) are near-copies.
- **No ES modules**: Despite `"type": "module"` in the manifest, the codebase uses no `import`/`export`. Each file is a self-contained script.
- **Queue cleanup bugs**: Versions 1.6.7–1.6.11 were all fixes for the same class of bug (stale translation queue after stop). The current fix clears `state.translationQueue = []` immediately in `stopTranslation()` and checks `shouldStop` flags throughout the processing pipeline.
