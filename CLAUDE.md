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

## Architecture

### Three-Part Chrome Extension Architecture

The extension follows the standard Manifest V3 architecture with three isolated JavaScript contexts:

1. **Background Service Worker** (`background/service-worker.js`)
   - Handles all API requests to translation services
   - Implements rate limiting (RateLimiter class: max 3 concurrent, 300ms interval)
   - Retry mechanism with exponential backoff
   - Tab state management (tracks translation status per tab)
   - Message passing hub between popup and content scripts

2. **Content Script** (`content/content.js`)
   - Injected into all web pages
   - Implements viewport-prioritized translation using Intersection Observer
   - Creates the floating action button (FAB) for one-click translation
   - Manages translation UI overlays (bilingual display)
   - Handles extension context invalidation (shows warning on extension reload)
   - Uses TranslationState class to manage queue and prevent duplicate translations

3. **Popup UI** (`popup/popup.js`, `popup/popup.html`)
   - Extension settings interface
   - ConfigManager: modular per-provider configuration storage
   - i18n support (i18n.js) for multi-language UI
   - Provider management (Google, DeepSeek, OpenAI, Claude, etc.)

### Key Translation Flow

1. User clicks FAB or popup "Translate Page" button
2. Content script scans DOM for translatable text blocks (prioritizes viewport)
3. Text blocks queued and sent to background service worker via `chrome.runtime.sendMessage`
4. Service worker routes to appropriate API handler (Google Translate or LLM)
5. Translated text returned to content script
6. Content script renders bilingual display (original + translation)

### Translation Algorithm (Content Script)

- **Viewport Priority**: Uses Intersection Observer to prioritize visible content
- **Preloading**: Translates viewport + 1 screen below
- **Progressive**: Automatically translates new content as user scrolls
- **Batch Processing**: Groups multiple text blocks into single API calls
- **Deduplication**: Tracks translated elements to avoid retranslation
- **Mutation Observer**: Detects dynamically added content

### API Provider System

All LLM providers (except Google) use OpenAI-compatible endpoints:
- **OpenAI-compatible**: DeepSeek, OpenAI, Moonshot, Zhipu GLM, Custom
- **Anthropic**: Separate handler for Claude API format
- **Ollama**: Local model support with custom endpoint format
- **Google Translate**: Free public API, no authentication

Provider configs stored separately in chrome.storage.local with keys like `provider_config_deepseek`, `provider_config_openai`, etc.

## Important Implementation Details

### Extension Context Invalidation

When the extension is reloaded/updated, content scripts lose access to Chrome APIs. The code handles this gracefully:
- `isExtensionContextValid()`: Checks if `chrome.runtime.id` is accessible
- `safeChrome()`: Wraps all chrome API calls with context validation
- Shows user-friendly warning overlay when context is invalidated
- User must refresh the page to continue using the extension

### Tab State Management

Background worker maintains a Map of tab states (`tabStates`):
- `isTranslating`: Prevents concurrent translations
- `translatedCount`: Tracks progress
- `hasTranslations`: Whether tab has active translations
- Auto-cleaned on tab close or navigation

### Rate Limiting

RateLimiter class prevents API abuse:
- Configurable max concurrent requests (default: 3)
- Minimum interval between requests (default: 300ms)
- Queue-based request scheduling
- Release mechanism to free up slots

## File Organization

```
manifest.json              # Chrome extension manifest (v3)
background/
  service-worker.js        # API requests, rate limiting, tab state
content/
  content.js               # DOM manipulation, translation UI, FAB
popup/
  popup.html               # Settings UI structure
  popup.js                 # Settings logic, ConfigManager
  popup.css                # Settings styling
  i18n.js                  # Internationalization strings
styles/
  content.css              # Injected page styles (translation overlays)
icons/                     # Extension icons (16/32/48/128)
scripts/
  build.js                 # Build script (creates dist/)
  generate-icons.js        # Icon generation from SVG
```

## Version Management

Version is stored in `manifest.json` (`version` field). The build script reads this to name the output zip file. Update the version in `manifest.json` before running `npm run build`.

## Commit Conventions

Follow Conventional Commits format (see CONTRIBUTING.md):
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation
- `refactor`: Code refactoring
- `perf`: Performance improvements
