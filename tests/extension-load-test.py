#!/usr/bin/env python3
"""Load the built extension in Chromium and verify its runtime entry points."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import os
import re
import sys
import time

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "dist" / "OpenImmerseTranslate"


class SmokePageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            body = (
                "<!doctype html><html><body><main>"
                "<h1>Extension smoke page</h1>"
                "<p>This paragraph is visible to the injected content script.</p>"
                "</main></body></html>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/generic":
            body = b"""<!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <title>Global workspace</title>
              <style>
                body { margin: 0; font: 16px/1.5 sans-serif; }
                header, nav, main, article, form, label, button, a, span {
                  display: block;
                }
                header, nav, main { padding: 12px; }
                nav, form { display: flex; gap: 12px; flex-wrap: wrap; }
                a, button, label, span { min-height: 24px; }
                p { min-height: 48px; }
              </style>
            </head>
            <body>
              <header id="generic-header">
                <nav id="generic-navigation" aria-label="Primary">
                  <a id="generic-home-control" href="#home">
                    <svg aria-hidden="true" width="14" height="14">
                      <path d="M0 0h12v12z"></path>
                    </svg>
                    <span id="generic-home-label">Home</span>
                    <span id="generic-home-badge">12</span>
                  </a>
                  <button id="generic-create-control" type="button">
                    <svg aria-hidden="true" width="14" height="14">
                      <path d="M0 0h12v12z"></path>
                    </svg>
                    <span id="generic-create-label">Create post</span>
                  </button>
                </nav>
              </header>
              <main id="generic-main">
                <article>
                  <h1 id="generic-title">A globally usable translation extension</h1>
                  <p id="generic-copy">
                    The generic scanner translates ordinary article content on any website.
                  </p>
                </article>
                <form id="generic-form">
                  <label id="generic-email-label" for="generic-email">Email address</label>
                  <input id="generic-email" type="email">
                  <button id="generic-save-control" type="button">
                    <span id="generic-save-label">Save changes</span>
                  </button>
                </form>
              </main>
              <script>
                window.__genericSaveClicks = 0;
                document.querySelector('#generic-save-control').addEventListener('click', () => {
                  window.__genericSaveClicks++;
                });
              </script>
            </body>
            </html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/x-like":
            body = b"""<!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <title>X-like timeline</title>
              <style>
                body { margin: 0; font: 16px/1.5 sans-serif; }
                header, nav, main, article, a, span, time { display: block; }
                header, nav, main, article { padding: 10px; }
                #x-like-navigation {
                  display: flex;
                  width: 780px;
                  min-height: 44px;
                  gap: 16px;
                  align-items: center;
                }
                #x-like-shell { display: flex; gap: 24px; align-items: flex-start; }
                #x-like-left-rail { display: block; width: 230px; min-height: 600px; }
                #x-like-left-rail a {
                  display: flex;
                  width: 210px;
                  min-height: 34px;
                  align-items: center;
                }
                article { max-width: 680px; }
                [lang][dir="auto"] { min-height: 40px; }
                [data-testid="reply"], [data-testid="like"] {
                  display: flex;
                  gap: 8px;
                }
              </style>
            </head>
            <body>
              <div id="x-like-header">
                <div id="x-like-navigation">
                  <a id="x-like-home-control" href="#home">
                    <svg aria-hidden="true" width="14" height="14">
                      <path d="M0 0h12v12z"></path>
                    </svg>
                    <span id="x-like-home-label">Home</span>
                    <span id="x-like-home-badge">4</span>
                  </a>
                  <a id="x-like-explore-control" href="#explore">
                    <span id="x-like-explore-label">Explore</span>
                  </a>
                  <a id="x-like-notifications-control" href="#notifications">
                    <span id="x-like-notifications-label">Notifications</span>
                  </a>
                  <a id="x-like-messages-control" href="#messages">
                    <span id="x-like-messages-label">Messages</span>
                  </a>
                  <button id="x-like-more-control" type="button" aria-expanded="false">
                    <span id="x-like-more-label">More</span>
                  </button>
                  <div id="x-like-more-menu" role="menu" hidden>
                    <a id="x-like-lists-control" href="#lists" role="menuitem">
                      <span id="x-like-lists-label">Lists</span>
                    </a>
                    <a id="x-like-bookmarks-control" href="#bookmarks" role="menuitem">
                      <span id="x-like-bookmarks-label">Bookmarks</span>
                    </a>
                  </div>
                </div>
              </div>
              <div id="x-like-shell">
              <div id="x-like-left-rail">
                <a id="x-like-rail-home-control" href="#rail-home">
                  <span id="x-like-rail-home-label">Home</span>
                  <span id="x-like-rail-home-badge">9</span>
                </a>
                <a id="x-like-rail-explore-control" href="#rail-explore">
                  <span id="x-like-rail-explore-label">Explore rail</span>
                </a>
                <a id="x-like-rail-notifications-control" href="#rail-notifications">
                  <span id="x-like-rail-notifications-label">Notifications rail</span>
                </a>
                <a id="x-like-rail-messages-control" href="#rail-messages">
                  <span id="x-like-rail-messages-label">Messages rail</span>
                </a>
                <a id="x-like-rail-bookmarks-control" href="#rail-bookmarks">
                  <span id="x-like-rail-bookmarks-label">Bookmarks rail</span>
                </a>
                <a id="x-like-rail-jobs-control" href="#rail-jobs">
                  <span id="x-like-rail-jobs-label">Jobs rail</span>
                </a>
              </div>
              <main id="x-like-main">
                <article id="x-like-article">
                  <div data-post-avatar="true"><a href="#alice">Avatar</a></div>
                  <div data-testid="User-Name" id="x-like-account">
                    <span id="x-like-display-name">Alice Example</span>
                    <span id="x-like-handle">@alice</span>
                  </div>
                  <time id="x-like-time" datetime="2026-11-19T00:00:00Z">2h</time>
                  <div id="x-like-post-body" lang="en" dir="auto">
                    Shipping a faster translation pipeline to every website today.
                  </div>
                  <div data-testid="reply" id="x-like-reply-action">
                    <span id="x-like-reply-label">Reply</span>
                    <span id="x-like-reply-count">12</span>
                  </div>
                  <div data-testid="like" id="x-like-like-action">
                    <span id="x-like-like-label">Like</span>
                    <span id="x-like-like-count">48</span>
                  </div>
                </article>
              </main>
              </div>
              <script>
                document.querySelector('#x-like-more-control').addEventListener('click', () => {
                  document.querySelector('#x-like-more-control')
                    .setAttribute('aria-expanded', 'true');
                  document.querySelector('#x-like-more-menu').hidden = false;
                });
              </script>
            </body>
            </html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(204 if self.path == "/favicon.ico" else 404)
        self.end_headers()

    def log_message(self, *args):
        pass


def find_chromium(playwright):
    candidates = [
        os.environ.get("CHROMIUM_PATH"),
        playwright.chromium.executable_path,
    ]

    cache_roots = [
        Path.home() / "Library" / "Caches" / "ms-playwright",
        Path.home() / ".cache" / "ms-playwright",
    ]
    for cache_root in cache_roots:
        candidates.extend(
            str(path)
            for path in sorted(
                cache_root.glob(
                    "chromium-*/chrome-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
                ),
                reverse=True,
            )
        )
        candidates.extend(
            str(path)
            for path in sorted(cache_root.glob("chromium-*/chrome-linux*/chrome"), reverse=True)
        )

    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return ""


def compact_diagnostic(value, limit=260):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def get_live_x_page_diagnostic(page, navigation_status=None):
    try:
        state = page.evaluate(
            """
            () => ({
              url: location.href,
              title: document.title,
              body: (document.body?.innerText || '').trim().slice(0, 1200),
              readyState: document.readyState
            })
            """
        )
    except Exception as error:
        state = {
            "url": page.url,
            "title": "",
            "body": "",
            "readyState": "unavailable",
            "diagnosticError": str(error),
        }

    status = (
        f"HTTP {navigation_status}"
        if navigation_status is not None
        else "HTTP status unavailable"
    )
    return (
        f"{status}; url={compact_diagnostic(state.get('url'), 180)}; "
        f"title={compact_diagnostic(state.get('title'), 100)!r}; "
        f"readyState={state.get('readyState')}; "
        f"body={compact_diagnostic(state.get('body'))!r}"
    )


def open_live_x_page(page, url):
    navigation_error = None
    response = None

    try:
        response = page.goto(url, wait_until="commit", timeout=30000)
    except Exception as error:
        navigation_error = error

    try:
        page.wait_for_load_state("domcontentloaded", timeout=5000)
    except Exception:
        pass

    status = response.status if response is not None else None
    diagnostic = get_live_x_page_diagnostic(page, status)
    status_blocked = status is not None and status >= 400
    try:
        page_text = page.evaluate(
            "() => (document.body?.innerText || '').slice(0, 4000)"
        )
    except Exception:
        page_text = ""
    access_blocked = bool(
        re.search(
            r"\b403\b|access (?:is )?denied|request (?:was )?denied|"
            r"请求遭到拒绝|未获授权|无法查看此网页|HTTP ERROR",
            page_text,
            re.IGNORECASE,
        )
    )

    if navigation_error or status_blocked or access_blocked:
        failure = "live X navigation was blocked"
        if navigation_error:
            failure += f": {compact_diagnostic(navigation_error)}"
        raise RuntimeError(f"{failure}; {diagnostic}")

    try:
        page.wait_for_selector(
            'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]',
            timeout=20000,
        )
    except Exception as error:
        raise RuntimeError(
            "live X page did not expose a visible post body; "
            f"{diagnostic}; selectorError={compact_diagnostic(error)}"
        ) from error


def wait_for_service_worker(context, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if context.service_workers:
            return context.service_workers[0]
        time.sleep(0.1)
    return None


def get_x_content_state(worker, timeout=5):
    deadline = time.monotonic() + timeout
    last_error = None

    while time.monotonic() < deadline:
        try:
            result = worker.evaluate(
                """
                async () => {
                  const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
                  if (!tabs.length || !tabs[0].id) {
                    return { error: `No X tab found: ${JSON.stringify(tabs)}` };
                  }
                  try {
                    return await chrome.tabs.sendMessage(
                      tabs[0].id,
                      { action: 'getTranslationState' }
                    );
                  } catch (error) {
                    return { error: String(error) };
                  }
                }
                """
            )
            if isinstance(result, dict) and "diagnostics" in result:
                return result
            last_error = result
        except Exception as error:
            last_error = str(error)
        time.sleep(0.1)

    raise RuntimeError(f"Content-script state is unavailable: {last_error}")


def get_page_content_state(worker, url, timeout=5):
    deadline = time.monotonic() + timeout
    last_error = None
    pattern = f"{url}*"

    while time.monotonic() < deadline:
        try:
            result = worker.evaluate(
                """
                async pattern => {
                  const tabs = await chrome.tabs.query({ url: pattern });
                  if (!tabs.length || !tabs[0].id) {
                    return { error: `No matching tab found: ${pattern}` };
                  }
                  try {
                    return await chrome.tabs.sendMessage(
                      tabs[0].id,
                      { action: 'getTranslationState' }
                    );
                  } catch (error) {
                    return { error: String(error) };
                  }
                }
                """,
                pattern,
            )
            if isinstance(result, dict) and "diagnostics" in result:
                return result
            last_error = result
        except Exception as error:
            last_error = str(error)
        time.sleep(0.1)

    raise RuntimeError(f"Content-script state is unavailable: {last_error}")


def configure_page_translation(worker, scope):
    worker.evaluate(
        """
        async scope => {
          await chrome.storage.sync.set({
            globalConfig: {
              provider: 'custom',
              sourceLang: 'en',
              targetLang: 'zh-CN',
              translationStyle: 'accurate',
              translationScope: scope,
              showOriginal: true,
              autoDetect: false,
              customPrompt: '',
              maxTokens: 512,
              temperature: 0,
              maxConcurrent: 3,
              uiLanguage: 'en'
            },
            providerConfigs: {
              custom: {
                endpoint: 'https://provider.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model'
              }
            }
          });
          await chrome.runtime.sendMessage({ action: 'clearTranslationCache' });
        }
        """,
        scope,
    )


def install_page_provider_mock(worker, marker):
    worker.evaluate(
        """
        marker => {
          globalThis.__oitPageOriginalFetch = globalThis.fetch;
          globalThis.__oitPageFetchCalls = [];
          globalThis.fetch = async (url, options = {}) => {
            const requestBody = String(options.body || '');
            globalThis.__oitPageFetchCalls.push({ url, body: requestBody });

            let userPrompt = '';
            try {
              const payload = JSON.parse(requestBody);
              userPrompt = payload.messages?.find(
                message => message.role === 'user'
              )?.content || '';
            } catch (error) {
              userPrompt = requestBody;
            }

            const targets = Array.from(
              userPrompt.matchAll(/<target(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/target>/g)
            ).map(match => match[1]);
            const translations = (targets.length ? targets : ['']).map((target, index) => {
              const tokens = target.match(
                /\\[\\[OIT-[A-Z0-9]+:(?:OPEN|CLOSE|ATOM):\\d+\\]\\]/g
              ) || [];
              return `${marker} ${index + 1}${tokens.join('')}`;
            });

            await new Promise(resolve => setTimeout(resolve, 80));
            return new Response(
              JSON.stringify({
                choices: [{
                  message: { content: JSON.stringify(translations) }
                }]
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          };
        }
        """,
        marker,
    )


def observe_translated_selectors(page, selectors):
    return page.evaluate(
        """
        selectors => Object.fromEntries(selectors.map(selector => {
          const element = document.querySelector(selector);
          return [
            selector,
            Boolean(element && (
              element.matches('.oit-translated-host')
              || element.querySelector('.oit-translation')
            ))
          ];
        }))
        """,
        selectors,
    )


def observe_translation_hosts(page, selectors):
    return page.evaluate(
        """
        selectors => Object.fromEntries(selectors.map(selector => {
          const element = document.querySelector(selector);
          return [selector, Boolean(element?.matches('.oit-translated-host'))];
        }))
        """,
        selectors,
    )


def get_x_scanner_diagnostics(worker, timeout=5):
    deadline = time.monotonic() + timeout
    last_error = None

    while time.monotonic() < deadline:
        try:
            result = worker.evaluate(
                """
                async () => {
                  const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
                  if (!tabs.length || !tabs[0].id) {
                    return { error: `No X tab found: ${JSON.stringify(tabs)}` };
                  }
                  try {
                    const results = await chrome.scripting.executeScript({
                      target: { tabId: tabs[0].id },
                      func: () => {
                        const scanner = globalThis.OITPageScanner;
                        if (!scanner) {
                          return { error: 'OITPageScanner is unavailable' };
                        }
                        const hasVisibleArea = element => {
                          const rect = element?.getBoundingClientRect?.();
                          if (!rect || rect.width <= 0 || rect.height <= 0) {
                            return false;
                          }
                          let visible = {
                            top: Math.max(0, rect.top),
                            right: Math.min(window.innerWidth, rect.right),
                            bottom: Math.min(window.innerHeight, rect.bottom),
                            left: Math.max(0, rect.left)
                          };
                          let current = element.parentElement;
                          while (current) {
                            const style = getComputedStyle(current);
                            if (['hidden', 'clip'].includes(style.overflow)
                                || ['hidden', 'clip'].includes(style.overflowY)) {
                              const clip = current.getBoundingClientRect();
                              visible = {
                                top: Math.max(visible.top, clip.top),
                                right: Math.min(visible.right, clip.right),
                                bottom: Math.min(visible.bottom, clip.bottom),
                                left: Math.max(visible.left, clip.left)
                              };
                            }
                            current = current.parentElement;
                          }
                          return visible.right > visible.left
                            && visible.bottom > visible.top;
                        };
                        const context = scanner.createScanContext({
                          scope: 'smart',
                          site: 'x'
                        });
                        const candidates = scanner.collectPageCandidates('smart', {
                          context,
                          site: 'x',
                          discoverShadowRoots: false,
                          includeContext: false
                        });
                        const samples = candidates.map(candidate => {
                          const element = candidate.element;
                          const rect = element.getBoundingClientRect();
                          return {
                            tag: element.tagName,
                            id: element.id || null,
                            testId: element.getAttribute('data-testid'),
                            role: candidate.role || null,
                            siteRole: candidate.siteRole || null,
                            reason: candidate.reason || null,
                            text: String(candidate.text || '').slice(0, 160),
                            visible: hasVisibleArea(element),
                            rect: {
                              top: Math.round(rect.top),
                              left: Math.round(rect.left),
                              width: Math.round(rect.width),
                              height: Math.round(rect.height)
                            }
                          };
                        });
                        const visibleSamples = samples.filter(
                          sample => sample.visible
                        );
                        const navigationElements = [];
                        for (const candidate of candidates) {
                          const element = candidate.element;
                          if (candidate.siteRole !== 'navigation-label'
                              || !hasVisibleArea(element)
                              || navigationElements.includes(element)) {
                            continue;
                          }
                          navigationElements.push(element);
                        }
                        const navigationSamples = samples.filter(sample => (
                          sample.visible
                          && sample.siteRole === 'navigation-label'
                        ));
                        const controls = visibleSamples.filter(sample => (
                          sample.siteRole !== 'navigation-label'
                          && sample.role === 'control'
                        )).length;
                        const bodyCandidates = visibleSamples.filter(
                          sample => sample.siteRole === 'post-body'
                        ).length;
                        const navigationLabels = navigationElements.length;
                        const otherVisible = Math.max(
                          0,
                          visibleSamples.length
                            - navigationLabels
                            - controls
                            - bodyCandidates
                        );
                        globalThis.__oitXScannerNavigationElements =
                          navigationElements;
                        globalThis.__oitXScannerAdaptiveRoots =
                          Array.from(context.adaptiveUiRoots);
                        return {
                          total: samples.length,
                          visible: visibleSamples.length,
                          navigationLabels,
                          controls,
                          bodyCandidates,
                          otherVisible,
                          adaptiveUiRootsFound:
                            context.stats.adaptiveUiRootsFound,
                          adaptiveUiRootsAccepted:
                            context.stats.adaptiveUiRootsAccepted,
                          adaptiveUiRootsRejected:
                            context.stats.adaptiveUiRootsRejected,
                          adaptiveUiRootSources:
                            context.stats.adaptiveUiRootSources,
                          adaptiveUiRootSamples:
                            context.stats.adaptiveUiRootSamples,
                          navigationSamples: navigationSamples.slice(0, 24),
                          samples: samples.slice(0, 80)
                        };
                      }
                    });
                    return results[0]?.result
                      || { error: 'Scanner injection returned no result' };
                  } catch (error) {
                    return { error: String(error) };
                  }
                }
                """
            )
            if isinstance(result, dict) and "error" not in result:
                return result
            last_error = result
        except Exception as error:
            last_error = str(error)
        time.sleep(0.1)

    return {"error": f"Scanner diagnostics are unavailable: {last_error}"}


def get_x_scanner_navigation_state(worker, timeout=5):
    deadline = time.monotonic() + timeout
    last_error = None

    while time.monotonic() < deadline:
        try:
            result = worker.evaluate(
                """
                async () => {
                  const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
                  if (!tabs.length || !tabs[0].id) {
                    return { error: `No X tab found: ${JSON.stringify(tabs)}` };
                  }
                  try {
                    const results = await chrome.scripting.executeScript({
                      target: { tabId: tabs[0].id },
                      func: () => {
                        const hasVisibleArea = element => {
                          const rect = element?.getBoundingClientRect?.();
                          if (!rect || rect.width <= 0 || rect.height <= 0) {
                            return false;
                          }
                          let visible = {
                            top: Math.max(0, rect.top),
                            right: Math.min(window.innerWidth, rect.right),
                            bottom: Math.min(window.innerHeight, rect.bottom),
                            left: Math.max(0, rect.left)
                          };
                          let current = element.parentElement;
                          while (current) {
                            const style = getComputedStyle(current);
                            if (['hidden', 'clip'].includes(style.overflow)
                                || ['hidden', 'clip'].includes(style.overflowY)) {
                              const clip = current.getBoundingClientRect();
                              visible = {
                                top: Math.max(visible.top, clip.top),
                                right: Math.min(visible.right, clip.right),
                                bottom: Math.min(visible.bottom, clip.bottom),
                                left: Math.max(visible.left, clip.left)
                              };
                            }
                            current = current.parentElement;
                          }
                          return visible.right > visible.left
                            && visible.bottom > visible.top;
                        };
                        const elements =
                          globalThis.__oitXScannerNavigationElements || [];
                        const retained = elements.filter(
                          element => element?.isConnected
                        );
                        const scanner = globalThis.OITPageScanner;
                        const context = scanner?.createScanContext?.({
                          scope: 'smart',
                          site: 'x'
                        });
                        if (context) {
                          scanner.collectPageCandidates('smart', {
                            context,
                            site: 'x',
                            discoverShadowRoots: false,
                            includeContext: false
                          });
                        }
                        const adaptiveRoots = Array.from(new Set([
                          ...(globalThis.__oitXScannerAdaptiveRoots || []),
                          ...(context?.adaptiveUiRoots || [])
                        ])).filter(root => root?.isConnected);
                        const translationNodes = new Set();
                        for (const root of adaptiveRoots) {
                          for (const translation of root.querySelectorAll(
                            '.oit-translation'
                          )) {
                            translationNodes.add(translation);
                          }
                        }
                        const translated = Array.from(translationNodes);
                        return {
                          navigationLabels: elements.length,
                          navigationRetained: retained.length,
                          adaptiveRoots: adaptiveRoots.length,
                          navigationTranslated: translated.length,
                          visibleNavigation: translated.filter(
                            hasVisibleArea
                          ).length,
                          navigationSamples: translated.slice(0, 24).map(
                            element => String(
                              element.textContent || ''
                            ).replace(/\\s+/g, ' ').trim().slice(0, 160)
                          )
                        };
                      }
                    });
                    return results[0]?.result
                      || { error: 'Navigation state injection returned no result' };
                  } catch (error) {
                    return { error: String(error) };
                  }
                }
                """
            )
            if isinstance(result, dict) and "error" not in result:
                return result
            last_error = result
        except Exception as error:
            last_error = str(error)
        time.sleep(0.1)

    return {"error": f"Navigation state is unavailable: {last_error}"}


def wait_for_page_pipeline(page, worker, url, expected_selectors, minimum=1, timeout=20):
    deadline = time.monotonic() + timeout
    observation = {}

    while time.monotonic() < deadline:
        translated = observe_translated_selectors(page, expected_selectors)
        translation_count = page.evaluate(
            "() => document.querySelectorAll('.oit-translation').length"
        )
        fab_translating = page.evaluate(
            """
            () => document.querySelector('.oit-fab-btn')
              ?.classList.contains('translating') || false
            """
        )
        try:
            content_state = get_page_content_state(worker, url, timeout=1)
        except Exception as error:
            content_state = {"error": str(error)}
        diagnostics = content_state.get("diagnostics", {})
        observation = {
            "translated": translated,
            "translationCount": translation_count,
            "fabTranslating": fab_translating,
            "sessionActive": content_state.get(
                "sessionActive", content_state.get("isTranslating")
            ),
            "pipelineBusy": content_state.get(
                "pipelineBusy", diagnostics.get("pipelineBusy")
            ),
            "state": {
                "processing": diagnostics.get("isProcessing"),
                "queue": diagnostics.get("queueLength"),
                "activeTranslations": diagnostics.get("activeTranslations"),
                "pending": diagnostics.get("pendingCount"),
                "translating": diagnostics.get("translatingCount"),
                "inflight": diagnostics.get("inflightCount"),
                "tasks": diagnostics.get("taskCount"),
                "bodyTranslatedCount": diagnostics.get("bodyTranslatedCount"),
                "recordCount": diagnostics.get("recordCount"),
                "dynamicMutationBatches": diagnostics.get("dynamicMutationBatches"),
                "dynamicRoots": diagnostics.get("dynamicRoots"),
                "dynamicScanRuns": diagnostics.get("dynamicScanRuns"),
                "dynamicCandidates": diagnostics.get("dynamicCandidates"),
                "dynamicBlocks": diagnostics.get("dynamicBlocks"),
                "dynamicRootSamples": diagnostics.get("dynamicRootSamples"),
                "dynamicIgnoredMutations": diagnostics.get("dynamicIgnoredMutations"),
                "dynamicMutationSamples": diagnostics.get("dynamicMutationSamples"),
            },
        }
        idle = (
            not observation["pipelineBusy"]
            and not observation["fabTranslating"]
            and observation["state"]["processing"] is False
            and observation["state"]["queue"] == 0
            and observation["state"]["activeTranslations"] == 0
            and observation["state"]["pending"] == 0
            and observation["state"]["translating"] == 0
            and observation["state"]["inflight"] == 0
            and observation["state"]["tasks"] == 0
        )
        translated_expected = sum(translated.values()) >= minimum
        if idle and translated_expected:
            break
        page.wait_for_timeout(200)

    return observation


def append_idle_failures(label, observation, failures):
    if observation.get("sessionActive") is not True:
        failures.append(
            f"{label} translation session stopped observing dynamic content: "
            f"{observation.get('sessionActive')!r}"
        )
    if observation.get("pipelineBusy"):
        failures.append(f"{label} translation pipeline remained busy")
    if observation.get("fabTranslating"):
        failures.append(f"{label} translation left the floating button spinning")

    expected = {
        "processing": False,
        "queue": 0,
        "activeTranslations": 0,
        "pending": 0,
        "translating": 0,
        "inflight": 0,
        "tasks": 0,
    }
    state = observation.get("state", {})
    for key, value in expected.items():
        if state.get(key) != value:
            failures.append(
                f"{label} translation state.{key} is {state.get(key)!r}, expected {value!r}"
            )


def verify_generic_page_translation(context, worker, extension_id, server_port):
    failures = []
    url = f"http://127.0.0.1:{server_port}/generic"
    expected = [
        "#generic-home-label",
        "#generic-create-label",
        "#generic-copy",
        "#generic-email-label",
        "#generic-save-label",
    ]
    configure_page_translation(worker, "full")
    calls_before = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.set_viewport_size({"width": 1280, "height": 900})

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=10000)
        page.wait_for_selector(".oit-fab-btn", timeout=5000)
        page.locator(".oit-fab-btn").click(force=True)
        observation = wait_for_page_pipeline(
            page,
            worker,
            url,
            expected,
            minimum=len(expected),
        )

        missing = [selector for selector, translated in observation["translated"].items()
                   if not translated]
        if missing:
            failures.append(f"generic full translation missed selectors: {missing}")
        protected = observe_translation_hosts(
            page,
            [
                "#generic-home-badge",
                "#generic-home-control",
                "#generic-create-control",
                "#generic-save-control",
            ],
        )
        translated_protected = [selector for selector, translated in protected.items()
                                if translated]
        if translated_protected:
            failures.append(
                f"generic full translation modified composite controls/badges: "
                f"{translated_protected}"
            )
        append_idle_failures("generic", observation, failures)

        page.evaluate("() => document.querySelector('#generic-save-control').click()")
        click_count = page.evaluate("() => window.__genericSaveClicks")
        if click_count != 1:
            failures.append(
                f"generic translated control click listener fired {click_count} times"
            )

        calls_after = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
        if calls_after <= calls_before:
            failures.append("generic page translation never called the provider transport")
        failures.extend(f"generic page error: {error}" for error in page_errors)
    except Exception as error:
        failures.append(f"generic page translation contract failed: {error}")
    finally:
        page.close()

    return failures


def verify_x_like_page_translation(context, worker, extension_id, server_port):
    failures = []
    url = f"http://127.0.0.1:{server_port}/x-like"
    protected_selectors = [
        "#x-like-home-badge",
        "#x-like-account",
        "#x-like-display-name",
        "#x-like-handle",
        "#x-like-time",
        "#x-like-reply-action",
        "#x-like-reply-count",
        "#x-like-like-action",
        "#x-like-like-count",
    ]

    configure_page_translation(worker, "smart")
    calls_before = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
    expected_smart = [
        "#x-like-home-label",
        "#x-like-explore-label",
        "#x-like-notifications-label",
        "#x-like-messages-label",
        "#x-like-more-label",
        "#x-like-rail-home-label",
        "#x-like-rail-explore-label",
        "#x-like-rail-notifications-label",
        "#x-like-rail-messages-label",
        "#x-like-rail-bookmarks-label",
        "#x-like-rail-jobs-label",
        "#x-like-post-body",
    ]
    smart_page = context.new_page()
    smart_errors = []
    smart_page.on("pageerror", lambda error: smart_errors.append(str(error)))
    smart_page.set_viewport_size({"width": 1280, "height": 900})

    try:
        smart_page.goto(url, wait_until="domcontentloaded", timeout=10000)
        smart_page.wait_for_selector(".oit-fab-btn", timeout=5000)
        smart_page.locator(".oit-fab-btn").click(force=True)
        smart_observation = wait_for_page_pipeline(
            smart_page,
            worker,
            url,
            expected_smart,
            minimum=len(expected_smart),
        )
        missing_smart = [
            selector
            for selector, translated in smart_observation["translated"].items()
            if not translated
        ]
        if missing_smart:
            failures.append(f"X-like smart translation missed selectors: {missing_smart}")
        smart_protected = observe_translation_hosts(
            smart_page,
            [
                *protected_selectors,
            ],
        )
        smart_modified = [selector for selector, translated in smart_protected.items()
                          if translated]
        if smart_modified:
            failures.append(
                f"X-like smart scope modified metadata or badges: {smart_modified}"
            )
        append_idle_failures("X-like smart", smart_observation, failures)

        smart_calls = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
        if smart_calls <= calls_before:
            failures.append("X-like smart translation never called the provider transport")

        hidden_menu_state = observe_translated_selectors(
            smart_page,
            ["#x-like-lists-label", "#x-like-bookmarks-label"],
        )
        if any(hidden_menu_state.values()):
            failures.append("X-like smart translated a hidden menu before it was revealed")

        smart_page.locator("#x-like-more-control").click()
        revealed_expected = ["#x-like-lists-label", "#x-like-bookmarks-label"]
        revealed_observation = wait_for_page_pipeline(
            smart_page,
            worker,
            url,
            revealed_expected,
            minimum=len(revealed_expected),
        )
        missing_revealed = [
            selector
            for selector, translated in revealed_observation["translated"].items()
            if not translated
        ]
        if missing_revealed:
            revealed_dom = smart_page.evaluate(
                """
                () => ({
                  hidden: document.querySelector('#x-like-more-menu')?.hidden,
                  expanded: document.querySelector('#x-like-more-control')
                    ?.getAttribute('aria-expanded'),
                  labels: Array.from(document.querySelectorAll(
                    '#x-like-lists-label, #x-like-bookmarks-label'
                  )).map(label => ({
                    id: label.id,
                    text: label.textContent,
                    host: label.matches('.oit-translated-host'),
                    translationCount: label.querySelectorAll('.oit-translation').length,
                    ancestors: (() => {
                      const chain = [];
                      let current = label;
                      while (current && chain.length < 6) {
                        chain.push({
                          tag: current.tagName,
                          id: current.id,
                          className: current.className
                        });
                        current = current.parentElement;
                      }
                      return chain;
                    })()
                  }))
                })
                """
            )
            failures.append(
                f"X-like smart translation missed revealed menu selectors: "
                f"{missing_revealed}; state={revealed_observation['state']!r}; "
                f"dom={revealed_dom!r}"
            )
        append_idle_failures("X-like smart revealed menu", revealed_observation, failures)

        calls_after_reveal = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
        if calls_after_reveal <= smart_calls:
            failures.append("revealed X-like menu was not translated dynamically")
        failures.extend(f"X-like smart page error: {error}" for error in smart_errors)
    except Exception as error:
        failures.append(f"X-like smart translation contract failed: {error}")
    finally:
        smart_page.close()

    configure_page_translation(worker, "full")
    calls_before = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
    full_page = context.new_page()
    full_errors = []
    full_page.on("pageerror", lambda error: full_errors.append(str(error)))
    full_page.set_viewport_size({"width": 1280, "height": 900})
    expected = [
        "#x-like-home-label",
        "#x-like-explore-label",
        "#x-like-notifications-label",
        "#x-like-messages-label",
        "#x-like-more-label",
        "#x-like-rail-home-label",
        "#x-like-rail-explore-label",
        "#x-like-rail-notifications-label",
        "#x-like-rail-messages-label",
        "#x-like-rail-bookmarks-label",
        "#x-like-rail-jobs-label",
        "#x-like-post-body",
    ]

    try:
        full_page.goto(url, wait_until="domcontentloaded", timeout=10000)
        full_page.wait_for_selector(".oit-fab-btn", timeout=5000)
        full_page.locator(".oit-fab-btn").click(force=True)
        full_observation = wait_for_page_pipeline(
            full_page,
            worker,
            url,
            expected,
            minimum=len(expected),
        )
        missing = [selector for selector, translated in full_observation["translated"].items()
                   if not translated]
        if missing:
            failures.append(f"X-like full translation missed selectors: {missing}")
        full_protected = observe_translation_hosts(
            full_page,
            protected_selectors,
        )
        full_modified = [selector for selector, translated in full_protected.items()
                         if translated]
        if full_modified:
            failures.append(
                f"X-like full scope modified protected metadata: {full_modified}"
            )
        append_idle_failures("X-like full", full_observation, failures)
        failures.extend(f"X-like full page error: {error}" for error in full_errors)

        calls_after = worker.evaluate("() => globalThis.__oitPageFetchCalls.length")
        if calls_after <= calls_before:
            failures.append("X-like full translation never called the provider transport")
        if full_observation["state"].get("bodyTranslatedCount", 0) < len(expected):
            failures.append(
                f"X-like full body translation count is "
                f"{full_observation['state'].get('bodyTranslatedCount')}"
            )
    except Exception as error:
        failures.append(f"X-like full translation contract failed: {error}")
    finally:
        full_page.close()

    return failures


def verify_local_page_translation(context, worker, extension_id, server_port):
    failures = []
    install_page_provider_mock(worker, "Local translation")
    try:
        failures.extend(
            verify_generic_page_translation(
                context,
                worker,
                extension_id,
                server_port,
            )
        )
        failures.extend(
            verify_x_like_page_translation(
                context,
                worker,
                extension_id,
                server_port,
            )
        )
    finally:
        worker.evaluate(
            """
            () => {
              globalThis.fetch = globalThis.__oitPageOriginalFetch;
              delete globalThis.__oitPageOriginalFetch;
              delete globalThis.__oitPageFetchCalls;
            }
            """
        )
    return failures


def observe_x_timeline(page):
    return page.evaluate(
        """
        () => {
          const hasVisibleArea = element => {
            const rect = element?.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
              return false;
            }
            let visible = {
              top: Math.max(0, rect.top),
              right: Math.min(window.innerWidth, rect.right),
              bottom: Math.min(window.innerHeight, rect.bottom),
              left: Math.max(0, rect.left)
            };
            let current = element.parentElement;
            while (current) {
              const style = getComputedStyle(current);
              if (['hidden', 'clip'].includes(style.overflow)
                  || ['hidden', 'clip'].includes(style.overflowY)) {
                const clip = current.getBoundingClientRect();
                visible = {
                  top: Math.max(visible.top, clip.top),
                  right: Math.min(visible.right, clip.right),
                  bottom: Math.min(visible.bottom, clip.bottom),
                  left: Math.max(visible.left, clip.left)
                };
              }
              current = current.parentElement;
            }
            return visible.right > visible.left
              && visible.bottom > visible.top;
          };
          const normalizeText = value => String(value || '')
            .replace(/\\s+/g, ' ')
            .trim();
          const sourceText = element => {
            const clone = element.cloneNode(true);
            clone.querySelectorAll('.oit-translation').forEach(node => node.remove());
            return normalizeText(clone.textContent);
          };
          const bodies = Array.from(document.querySelectorAll(
            'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]'
          )).filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const translatedBodies = bodies.filter(element => (
            element.matches('.oit-translated-host')
            || element.querySelector('.oit-translation')
          ));
          const visibleTranslatedBodies = translatedBodies.filter(element => {
            const translation = element.matches('.oit-translation')
              ? element
              : element.querySelector('.oit-translation');
            return hasVisibleArea(translation);
          });
          const scrollingElement = document.scrollingElement
            || document.documentElement;
          return {
            sourceKeys: bodies.map(sourceText).filter(Boolean),
            translatedSourceKeys: translatedBodies
              .map(sourceText)
              .filter(Boolean),
            visibleTranslatedSources: visibleTranslatedBodies
              .map(sourceText)
              .filter(Boolean)
              .slice(0, 12),
            bodyCount: bodies.length,
            translatedBodyCount: translatedBodies.length,
            visibleTranslatedBodyCount: visibleTranslatedBodies.length,
            translationCount: document.querySelectorAll('.oit-translation').length,
            scrollY: Math.round(window.scrollY),
            scrollHeight: Math.round(scrollingElement.scrollHeight),
            viewportHeight: Math.round(window.innerHeight)
          };
        }
        """
    )


def scroll_x_timeline(page):
    return page.evaluate(
        """
        () => {
          const scrollingElement = document.scrollingElement
            || document.documentElement;
          const before = {
            scrollY: scrollingElement.scrollTop,
            scrollHeight: scrollingElement.scrollHeight
          };
          const distance = Math.max(700, Math.round(window.innerHeight * 0.9));
          scrollingElement.scrollTop = Math.min(
            scrollingElement.scrollHeight,
            scrollingElement.scrollTop + distance
          );
          window.dispatchEvent(new Event('scroll'));
          return {
            before,
            after: {
              scrollY: scrollingElement.scrollTop,
              scrollHeight: scrollingElement.scrollHeight
            }
          };
        }
        """
    )


def inject_x_dynamic_post(page):
    return page.evaluate(
        """
        () => {
          document.querySelector('#oit-live-dynamic-post')?.remove();
          const article = document.createElement('article');
          article.id = 'oit-live-dynamic-post';
          article.setAttribute('role', 'article');
          article.style.cssText = 'display:block;width:600px;min-height:180px;';
          article.innerHTML = `
            <div data-testid="User-Name" style="display:block;min-height:24px">
              Dynamic account
            </div>
            <div id="oit-live-dynamic-body"
                 data-testid="tweetText"
                 lang="en"
                 dir="auto"
                 style="display:block;min-height:72px">
              A newly appended timeline post must be translated immediately.
            </div>
          `;
          const main = document.querySelector('main, [role="main"]')
            || document.body;
          main.append(article);
          const rect = article.getBoundingClientRect();
          return {
            inserted: article.isConnected,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        }
        """
    )


def observe_x_dynamic_post(page):
    return page.evaluate(
        """
        () => {
          const article = document.querySelector('#oit-live-dynamic-post');
          const body = document.querySelector('#oit-live-dynamic-body');
          const translation = body?.querySelector('.oit-translation');
          const translationRect = translation?.getBoundingClientRect?.();
          return {
            connected: Boolean(article?.isConnected && body?.isConnected),
            translated: Boolean(
              body?.matches('.oit-translated-host') || translation
            ),
            translationText: String(translation?.textContent || '')
              .replace(/\\s+/g, ' ')
              .trim(),
            translationVisible: Boolean(
              translationRect
              && translationRect.width > 0
              && translationRect.height > 0
            )
          };
        }
        """
    )


def verify_x_page_translation(context, worker, extension_id, live_result=None):
    failures = []

    worker.evaluate(
        """
        async () => {
          await chrome.storage.sync.set({
            globalConfig: {
              provider: 'custom',
              sourceLang: 'en',
              targetLang: 'zh-CN',
              translationStyle: 'accurate',
              translationScope: 'smart',
              showOriginal: true,
              autoDetect: false,
              customPrompt: '',
              maxTokens: 512,
              temperature: 0,
              maxConcurrent: 3,
              uiLanguage: 'en'
            },
            providerConfigs: {
              custom: {
                endpoint: 'https://provider.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model'
              }
            }
          });
          await chrome.runtime.sendMessage({ action: 'clearTranslationCache' });
        }
        """
    )

    worker.evaluate(
        """
        () => {
          globalThis.__oitXOriginalFetch = globalThis.fetch;
          globalThis.__oitXFetchCalls = [];
          globalThis.fetch = async (url, options = {}) => {
            const requestBody = String(options.body || '');
            globalThis.__oitXFetchCalls.push({ url, body: requestBody });

            let userPrompt = '';
            try {
              const payload = JSON.parse(requestBody);
              userPrompt = payload.messages?.find(
                message => message.role === 'user'
              )?.content || '';
            } catch (error) {
              userPrompt = requestBody;
            }

            const targets = Array.from(
              userPrompt.matchAll(/<target(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/target>/g)
            ).map(match => match[1]);
            const translations = (targets.length ? targets : ['']).map((target, index) => {
              const tokens = target.match(
                /\\[\\[OIT-[A-Z0-9]+:(?:OPEN|CLOSE|ATOM):\\d+\\]\\]/g
              ) || [];
              return tokens.length
                ? `X 正文译文 ${index + 1}${tokens.join('')}`
                : `X 正文译文 ${index + 1}`;
            });

            await new Promise(resolve => setTimeout(resolve, 120));
            return new Response(
              JSON.stringify({
                choices: [{
                  message: { content: JSON.stringify(translations) }
                }]
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          };
        }
        """
    )

    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.set_viewport_size({"width": 1280, "height": 1000})
    cdp = context.new_cdp_session(page)
    cdp.send(
        "Network.setUserAgentOverride",
        {
            "userAgent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "acceptLanguage": "en-US,en;q=0.9",
            "platform": "MacIntel",
        },
    )

    try:
        page.goto(
            f"chrome-extension://{extension_id}/popup/popup.html",
            wait_until="domcontentloaded",
            timeout=10000,
        )
        open_live_x_page(page, "https://x.com/jack/status/20")
        page.wait_for_timeout(1200)
        scanner_diagnostics = get_x_scanner_diagnostics(worker)

        before = page.evaluate(
            """
            () => {
              const bodies = Array.from(document.querySelectorAll(
                'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]'
              )).filter(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              const isVisible = element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              };
              const guestSurface = Boolean(
                document.querySelector('a[href*="/i/jf/onboarding/web?mode=login"]')
                && document.querySelector('a[href*="/i/jf/onboarding/web?mode=signup"]')
                && /Log in or sign up/i.test(document.body.innerText)
              );
              const authenticatedEvidence = !guestSurface && Boolean(
                Array.from(document.querySelectorAll(
                  '[data-testid="SideNav_AccountSwitcher_Button"], '
                    + '[data-testid="SideNav_NewTweet_Button"], '
                    + '[aria-label="Account menu"]'
                )).some(isVisible)
              );
              const navigationExpected = Boolean(document.querySelector(
                '[data-testid="SideNav"], [data-testid="AppTabBar"], '
                  + 'nav, [role="navigation"]'
              ));
              return {
                articles: document.querySelectorAll('article, [role="article"]').length,
                bodies: bodies.length,
                texts: bodies.map(element => element.textContent.trim()).filter(Boolean),
                hasFab: Boolean(document.querySelector('.oit-fab-btn')),
                guestSurface,
                authenticatedEvidence,
                navigationExpected
              };
            }
            """
        )

        if before["bodies"] < 3:
            failures.append(
                f"X public status exposed only {before['bodies']} body elements: "
                f"{before['texts']}"
            )
        if not before["hasFab"]:
            failures.append("X page did not inject the extension floating button")
        if "error" in scanner_diagnostics:
            failures.append(
                f"live X scanner diagnostics failed: {scanner_diagnostics['error']}"
            )
            scanner_diagnostics = {
                "total": 0,
                "visible": 0,
                "navigationLabels": 0,
                "controls": 0,
                "bodyCandidates": 0,
                "otherVisible": 0,
                "adaptiveUiRootsFound": 0,
                "adaptiveUiRootsAccepted": 0,
                "adaptiveUiRootsRejected": 0,
                "adaptiveUiRootSources": {},
                "adaptiveUiRootSamples": [],
                "navigationSamples": [],
                "samples": [],
                "error": scanner_diagnostics["error"],
            }
        scanner_navigation_labels = scanner_diagnostics["navigationLabels"]
        navigation_expected = (
            before["navigationExpected"]
            or before["authenticatedEvidence"]
            or scanner_navigation_labels > 0
        )
        expected_navigation_translations = (
            min(3, scanner_navigation_labels)
            if navigation_expected
            else 0
        )
        before["navigationExpected"] = navigation_expected
        before["navigationControls"] = scanner_navigation_labels
        before["navigationSamples"] = scanner_diagnostics["navigationSamples"]
        before["navigationLabels"] = [
            sample["text"]
            for sample in scanner_diagnostics["navigationSamples"]
            if sample.get("text")
        ]
        if navigation_expected and scanner_navigation_labels < 3:
            failures.append(
                "live X scanner discovered fewer than 3 navigation candidates: "
                f"{scanner_navigation_labels}; "
                f"navigationSamples={scanner_diagnostics['navigationSamples']}"
            )
        if (
            not navigation_expected
            and not before["guestSurface"]
            and not before["authenticatedEvidence"]
        ):
            failures.append(
                "live X surface could not be classified as authenticated navigation "
                "or guest view; navigation coverage remains unverified"
            )
        if scanner_diagnostics["visible"] < 3:
            failures.append(
                "live X scanner discovered fewer than 3 visible content candidates: "
                f"{scanner_diagnostics['visible']}; "
                f"samples={scanner_diagnostics['samples']}"
            )
        if live_result is not None:
            if before["authenticatedEvidence"]:
                live_result["navigationCoverage"] = "authenticated"
            elif before["guestSurface"]:
                live_result["navigationCoverage"] = "guest"
            elif before["navigationExpected"]:
                live_result["navigationCoverage"] = "navigation-only-unverified"
            else:
                live_result["navigationCoverage"] = "unclassified"
            live_result["scannerCandidates"] = scanner_diagnostics["total"]
            live_result["scannerVisibleCandidates"] = scanner_diagnostics["visible"]
            live_result["scannerNavigationCandidates"] = scanner_navigation_labels
            live_result["scannerControlCandidates"] = scanner_diagnostics["controls"]
            live_result["scannerBodyCandidates"] = scanner_diagnostics["bodyCandidates"]
            live_result["scannerOtherVisibleCandidates"] = (
                scanner_diagnostics["otherVisible"]
            )
            live_result["adaptiveUiRootsFound"] = (
                scanner_diagnostics["adaptiveUiRootsFound"]
            )
            live_result["adaptiveUiRootsAccepted"] = (
                scanner_diagnostics["adaptiveUiRootsAccepted"]
            )
            live_result["adaptiveUiRootsRejected"] = (
                scanner_diagnostics["adaptiveUiRootsRejected"]
            )
            live_result["adaptiveUiRootSources"] = (
                scanner_diagnostics["adaptiveUiRootSources"]
            )
            live_result["scannerSamples"] = scanner_diagnostics["samples"]
            live_result["scannerNavigationSamples"] = (
                scanner_diagnostics["navigationSamples"]
            )

        if before["hasFab"]:
            page.locator(".oit-fab-btn").click(force=True)

        state = {}
        translated = {
            "bodies": before["bodies"],
            "translatedBodies": 0,
            "translations": 0,
            "nonBodyTranslated": 0,
            "fabTranslating": False,
            "navigationLabels": scanner_navigation_labels,
            "navigationRetained": 0,
            "adaptiveRoots": 0,
            "navigationTranslated": 0,
            "navigationSamples": [],
            "visibleBodies": 0,
            "visibleNavigation": 0,
        }
        max_queue_depth = 0
        max_pending_count = 0
        max_active_translations = 0
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            translated = page.evaluate(
                """
                () => {
                  const hasVisibleArea = element => {
                    const rect = element?.getBoundingClientRect?.();
                    if (!rect || rect.width <= 0 || rect.height <= 0) {
                      return false;
                    }
                    let visible = {
                      top: Math.max(0, rect.top),
                      right: Math.min(window.innerWidth, rect.right),
                      bottom: Math.min(window.innerHeight, rect.bottom),
                      left: Math.max(0, rect.left)
                    };
                    let current = element.parentElement;
                    while (current) {
                      const style = getComputedStyle(current);
                      if (['hidden', 'clip'].includes(style.overflow)
                          || ['hidden', 'clip'].includes(style.overflowY)) {
                        const clip = current.getBoundingClientRect();
                        visible = {
                          top: Math.max(visible.top, clip.top),
                          right: Math.min(visible.right, clip.right),
                          bottom: Math.min(visible.bottom, clip.bottom),
                          left: Math.max(visible.left, clip.left)
                        };
                      }
                      current = current.parentElement;
                    }
                    return visible.right > visible.left
                      && visible.bottom > visible.top;
                  };
                  const hasVisibleTranslation = host => {
                    const translation = host?.matches?.('.oit-translation')
                      ? host
                      : host?.querySelector?.('.oit-translation');
                    return Boolean(translation && hasVisibleArea(translation));
                  };
                  const bodies = Array.from(document.querySelectorAll(
                    'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]'
                  )).filter(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                  });
                  const translatedBodies = bodies.filter(element =>
                    element.matches('.oit-translated-host')
                    || element.querySelector('.oit-translation')
                  );
                  const nonBodySelectors = [
                    '[data-testid="User-Name"]',
                    'time',
                    '[data-testid="reply"]',
                    '[data-testid="retweet"]',
                    '[data-testid="like"]'
                  ];
                  const nonBodyTranslated = nonBodySelectors.flatMap(selector =>
                    Array.from(document.querySelectorAll(selector)).filter(element =>
                      element.matches('.oit-translated-host')
                      || element.querySelector('.oit-translation')
                    )
                  ).length;
                  return {
                    bodies: bodies.length,
                    translatedBodies: translatedBodies.length,
                    visibleBodies: bodies.filter(hasVisibleTranslation).length,
                    translations: document.querySelectorAll('.oit-translation').length,
                    nonBodyTranslated,
                    fabTranslating: document.querySelector('.oit-fab-btn')
                      ?.classList.contains('translating') || false
                  };
                }
                """
            )
            navigation_state = get_x_scanner_navigation_state(worker)
            if "error" in navigation_state:
                failures.append(
                    f"X navigation translation state failed: {navigation_state['error']}"
                )
                navigation_state = {
                    "navigationLabels": scanner_navigation_labels,
                    "navigationRetained": 0,
                    "adaptiveRoots": 0,
                    "navigationTranslated": 0,
                    "navigationSamples": [],
                    "visibleNavigation": 0,
                }
            translated.update(navigation_state)
            content_state = get_x_content_state(worker)
            diagnostics = content_state.get("diagnostics", {})
            state = {
                "sessionActive": content_state.get(
                    "sessionActive", content_state.get("isTranslating")
                ),
                "pipelineBusy": content_state.get(
                    "pipelineBusy", diagnostics.get("pipelineBusy")
                ),
                "stopped": diagnostics.get("isStopped"),
                "processing": diagnostics.get("isProcessing"),
                "queue": diagnostics.get("queueLength"),
                "activeTranslations": diagnostics.get("activeTranslations"),
                "pending": diagnostics.get("pendingCount"),
                "translating": diagnostics.get("translatingCount"),
                "inflight": diagnostics.get("inflightCount"),
                "tasks": diagnostics.get("taskCount"),
                "bodyTranslatedCount": diagnostics.get("bodyTranslatedCount"),
                "recordCount": diagnostics.get("recordCount"),
            }
            max_queue_depth = max(max_queue_depth, state["queue"] or 0)
            max_pending_count = max(max_pending_count, state["pending"] or 0)
            max_active_translations = max(
                max_active_translations,
                state["activeTranslations"] or 0,
            )
            if (
                translated["visibleBodies"] >= 3
                and translated["visibleNavigation"]
                    >= expected_navigation_translations
                and not translated["fabTranslating"]
                and not state["pipelineBusy"]
                and state["queue"] == 0
                and state["inflight"] == 0
                and state["tasks"] == 0
            ):
                break
            page.wait_for_timeout(200)

        if translated["translatedBodies"] < 3:
            failures.append(
                f"only {translated['translatedBodies']} of {translated['bodies']} "
                "X bodies received translations"
            )
        if translated["visibleBodies"] < 3:
            failures.append(
                f"only {translated['visibleBodies']} of {translated['bodies']} "
                "X bodies had a visibly rendered translation"
            )
        if translated["nonBodyTranslated"]:
            failures.append(
                f"{translated['nonBodyTranslated']} X metadata/action nodes were translated"
            )
        if translated["navigationLabels"] != before["navigationControls"]:
            failures.append(
                f"X scanner navigation label count changed from "
                f"{before['navigationControls']} to {translated['navigationLabels']}"
            )
        if navigation_expected and translated["adaptiveRoots"] < 1:
            failures.append(
                "X navigation translations had no scanner-discovered adaptive root "
                f"to validate ({translated['navigationRetained']} original labels retained)"
            )
        if translated["visibleNavigation"] < expected_navigation_translations:
            failures.append(
                f"only {translated['visibleNavigation']} of "
                f"{translated['navigationLabels']} visible X navigation labels were "
                "translated and visibly rendered; expected at least "
                f"{expected_navigation_translations}"
            )
        if before["navigationExpected"] and translated["translatedBodies"] >= 3:
            if translated["visibleNavigation"] == 0:
                failures.append("X navigation and body translations were not both rendered")
        if translated["fabTranslating"]:
            failures.append("X translation left the floating button spinning")
        expected_idle_state = {
            "sessionActive": True,
            "pipelineBusy": False,
            "processing": False,
            "queue": 0,
            "activeTranslations": 0,
            "pending": 0,
            "translating": 0,
            "inflight": 0,
            "tasks": 0,
        }
        for key, expected in expected_idle_state.items():
            if state.get(key) != expected:
                failures.append(
                    f"X translation state.{key} is {state.get(key)!r}, expected {expected!r}"
                )
        if state.get("bodyTranslatedCount", 0) < 3:
            failures.append(
                f"X body translation count is {state.get('bodyTranslatedCount')}"
            )
        if state.get("recordCount", 0) < 3:
            failures.append(f"X translation record count is {state.get('recordCount')}")
        minimum_records = 3 + expected_navigation_translations
        if state.get("recordCount", 0) < minimum_records:
            failures.append(
                f"X translation record count is {state.get('recordCount')}; "
                f"expected at least {minimum_records} for body and navigation content"
            )

        provider_targets = worker.evaluate(
            """
            () => {
              const targets = [];
              for (const call of globalThis.__oitXFetchCalls || []) {
                let userPrompt = '';
                try {
                  const payload = JSON.parse(String(call.body || ''));
                  userPrompt = payload.messages?.find(
                    message => message.role === 'user'
                  )?.content || '';
                } catch (error) {
                  userPrompt = String(call.body || '');
                }
                targets.push(
                  ...Array.from(
                    userPrompt.matchAll(
                      /<target(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/target>/g
                    )
                  ).map(match => match[1])
                );
              }
              const uniqueTargets = Array.from(new Set(targets));
              return {
                count: uniqueTargets.length,
                samples: uniqueTargets.slice(0, 40).map(target => (
                  String(target).replace(/\\s+/g, ' ').trim().slice(0, 180)
                ))
              };
            }
            """
        )
        fetch_calls = worker.evaluate("() => globalThis.__oitXFetchCalls.length")
        if fetch_calls < 1:
            failures.append("X page translation never called the provider transport")
        if provider_targets["count"] < 3:
            failures.append(
                f"X provider received only {provider_targets['count']} unique targets: "
                f"{provider_targets['samples']}"
            )

        timeline_before = observe_x_timeline(page)
        baseline_content_state = get_x_content_state(worker)
        baseline_diagnostics = baseline_content_state.get("diagnostics", {})
        initial_sources = set(timeline_before["sourceKeys"])
        scroll_attempts = 0
        scroll_progressed = False
        timeline_after = timeline_before
        scroll_sources = set()
        scroll_translated_sources = set()

        for attempt in range(6):
            scroll_state = scroll_x_timeline(page)
            scroll_attempts += 1
            made_progress = (
                scroll_state["after"]["scrollY"] > scroll_state["before"]["scrollY"]
                or scroll_state["after"]["scrollHeight"]
                    > scroll_state["before"]["scrollHeight"]
            )
            scroll_progressed = scroll_progressed or made_progress

            for _ in range(5):
                page.wait_for_timeout(400)
                timeline_after = observe_x_timeline(page)
                scroll_sources = (
                    set(timeline_after["sourceKeys"]) - initial_sources
                )
                scroll_translated_sources = (
                    set(timeline_after["translatedSourceKeys"]) - initial_sources
                )
                if scroll_translated_sources:
                    break

            if scroll_translated_sources or not made_progress or attempt >= 1:
                break

        if scroll_sources and not scroll_translated_sources:
            failures.append(
                "X scrolling loaded new post bodies but none received a translation: "
                f"newSources={len(scroll_sources)}"
            )

        injection = inject_x_dynamic_post(page)
        dynamic_post = {}
        for _ in range(40):
            dynamic_post = observe_x_dynamic_post(page)
            if dynamic_post["translated"] and dynamic_post["translationVisible"]:
                break
            page.wait_for_timeout(250)

        if not injection["inserted"] or injection["width"] < 1 or injection["height"] < 1:
            failures.append(
                "could not inject a visible dynamic X post for the live observer test: "
                f"{injection}"
            )
        if not dynamic_post.get("translated"):
            failures.append(
                "the live X MutationObserver did not translate a newly appended post: "
                f"{dynamic_post}"
            )
        elif not dynamic_post.get("translationVisible"):
            failures.append(
                "the live X dynamic post received a translation that is not visible: "
                f"{dynamic_post}"
            )

        dynamic_idle_state = {}
        malformed_dynamic_state_reported = False
        dynamic_idle_deadline = time.monotonic() + 15
        while time.monotonic() < dynamic_idle_deadline:
            dynamic_content_state = get_x_content_state(worker)
            diagnostics = dynamic_content_state.get("diagnostics", {})
            if (
                not isinstance(diagnostics, dict)
                or "isProcessing" not in diagnostics
            ) and not malformed_dynamic_state_reported:
                failures.append(
                    "X dynamic translation state returned malformed diagnostics: "
                    f"{compact_diagnostic(dynamic_content_state)}"
                )
                malformed_dynamic_state_reported = True
            if not isinstance(diagnostics, dict):
                diagnostics = {}
            dynamic_idle_state = {
                "sessionActive": dynamic_content_state.get(
                    "sessionActive", dynamic_content_state.get("isTranslating")
                ),
                "pipelineBusy": dynamic_content_state.get(
                    "pipelineBusy", diagnostics.get("pipelineBusy")
                ),
                "processing": diagnostics.get("isProcessing"),
                "queue": diagnostics.get("queueLength"),
                "activeTranslations": diagnostics.get("activeTranslations"),
                "pending": diagnostics.get("pendingCount"),
                "translating": diagnostics.get("translatingCount"),
                "inflight": diagnostics.get("inflightCount"),
                "tasks": diagnostics.get("taskCount"),
                "fabTranslating": page.evaluate(
                    """
                    () => document.querySelector('.oit-fab-btn')
                      ?.classList.contains('translating') || false
                    """
                ),
                "bodyTranslatedCount": diagnostics.get("bodyTranslatedCount"),
                "recordCount": diagnostics.get("recordCount"),
                "dynamicMutationBatches": diagnostics.get(
                    "dynamicMutationBatches"
                ),
                "dynamicCandidates": diagnostics.get("dynamicCandidates"),
                "dynamicBlocks": diagnostics.get("dynamicBlocks"),
            }
            if (
                dynamic_idle_state["sessionActive"] is True
                and dynamic_idle_state["pipelineBusy"] is False
                and dynamic_idle_state["processing"] is False
                and dynamic_idle_state["queue"] == 0
                and dynamic_idle_state["activeTranslations"] == 0
                and dynamic_idle_state["pending"] == 0
                and dynamic_idle_state["translating"] == 0
                and dynamic_idle_state["inflight"] == 0
                and dynamic_idle_state["tasks"] == 0
                and dynamic_idle_state["fabTranslating"] is False
            ):
                break
            page.wait_for_timeout(250)

        dynamic_batches_delta = (
            dynamic_idle_state.get("dynamicMutationBatches", 0)
            - baseline_diagnostics.get("dynamicMutationBatches", 0)
        )
        dynamic_candidates_delta = (
            dynamic_idle_state.get("dynamicCandidates", 0)
            - baseline_diagnostics.get("dynamicCandidates", 0)
        )

        if not scroll_progressed:
            failures.append("X timeline did not scroll, so lazy content was not exercised")
        if dynamic_batches_delta < 1:
            failures.append("X scrolling did not reach the dynamic mutation pipeline")
        if dynamic_candidates_delta < 1:
            failures.append(
                "the live X dynamic mutation pipeline discovered no candidates"
            )
        append_idle_failures(
            "X dynamic scroll",
            {
                "sessionActive": dynamic_idle_state.get("sessionActive"),
                "pipelineBusy": dynamic_idle_state.get("pipelineBusy"),
                "fabTranslating": dynamic_idle_state.get("fabTranslating"),
                "state": dynamic_idle_state,
            },
            failures,
        )

        if live_result is not None:
            live_result.update({
                "guestSurface": before["guestSurface"],
                "authenticatedEvidence": before["authenticatedEvidence"],
                "navigationExpected": before["navigationExpected"],
                "navigationLabels": before["navigationControls"],
                "providerRequests": fetch_calls,
                "providerTargets": provider_targets["count"],
                "providerTargetSamples": provider_targets["samples"],
                "translatedBodies": translated["translatedBodies"],
                "visibleBodies": translated["visibleBodies"],
                "translatedNavigation": translated["navigationTranslated"],
                "visibleNavigation": translated["visibleNavigation"],
                "navigationSamples": translated["navigationSamples"],
                "navigationAdaptiveRoots": translated["adaptiveRoots"],
                "navigationOriginalLabelsRetained": translated["navigationRetained"],
                "maxQueueObserved": max_queue_depth,
                "maxPendingObserved": max_pending_count,
                "maxActiveTranslationsObserved": max_active_translations,
                "pipelineBusy": state.get("pipelineBusy"),
                "sessionActive": state.get("sessionActive"),
                "dynamicScrollAttempts": scroll_attempts,
                "dynamicScrollProgressed": scroll_progressed,
                "dynamicScrollNewSources": len(scroll_sources),
                "dynamicScrollNewTranslatedSources": len(scroll_translated_sources),
                "dynamicObserverTranslated": dynamic_post.get("translated"),
                "dynamicObserverTranslationVisible": dynamic_post.get(
                    "translationVisible"
                ),
                "dynamicMutationBatchesDelta": dynamic_batches_delta,
                "dynamicCandidatesDelta": dynamic_candidates_delta,
                "dynamicPipelineBusy": dynamic_idle_state.get("pipelineBusy"),
                "dynamicSessionActive": dynamic_idle_state.get("sessionActive"),
            })
        failures.extend(f"X page error: {error}" for error in page_errors)
    except Exception as error:
        failures.append(f"X page translation contract failed: {error}")
    finally:
        worker.evaluate(
            """
            () => {
              globalThis.fetch = globalThis.__oitXOriginalFetch;
              delete globalThis.__oitXOriginalFetch;
              delete globalThis.__oitXFetchCalls;
            }
            """
        )
        page.close()

    return failures


def verify_x_google_smoke(context, worker, extension_id):
    failures = []

    worker.evaluate(
        """
        async () => {
          await chrome.storage.sync.set({
            globalConfig: {
              provider: 'google',
              sourceLang: 'en',
              targetLang: 'zh-CN',
              translationStyle: 'accurate',
              translationScope: 'smart',
              showOriginal: true,
              autoDetect: false,
              customPrompt: '',
              maxTokens: 512,
              temperature: 0,
              maxConcurrent: 3,
              uiLanguage: 'en'
            },
            providerConfigs: {}
          });
          await chrome.runtime.sendMessage({ action: 'clearTranslationCache' });
        }
        """
    )

    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.set_viewport_size({"width": 1280, "height": 1000})
    cdp = context.new_cdp_session(page)
    cdp.send(
        "Network.setUserAgentOverride",
        {
            "userAgent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "acceptLanguage": "en-US,en;q=0.9",
            "platform": "MacIntel",
        },
    )

    try:
        page.goto(
            f"chrome-extension://{extension_id}/popup/popup.html",
            wait_until="domcontentloaded",
            timeout=10000,
        )
        open_live_x_page(page, "https://x.com/jack/status/20")
        page.wait_for_timeout(1200)

        before = page.evaluate(
            """
            () => {
              const bodies = Array.from(document.querySelectorAll(
                'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]'
              )).filter(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              return {
                bodies: bodies.length,
                hasFab: Boolean(document.querySelector('.oit-fab-btn'))
              };
            }
            """
        )
        if before["bodies"] < 1:
            failures.append("Google smoke: X page exposed no visible post bodies")
        if not before["hasFab"]:
            failures.append("Google smoke: X page did not inject the floating button")
            return failures

        page.locator(".oit-fab-btn").click(force=True)
        deadline = time.monotonic() + 45
        observed = {}
        content_state = {}

        while time.monotonic() < deadline:
            observed = page.evaluate(
                """
                () => {
                  const bodies = Array.from(document.querySelectorAll(
                    'article [lang][dir="auto"], [role="article"] [lang][dir="auto"]'
                  )).filter(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                  });
                  const translatedBodies = bodies.filter(element =>
                    element.matches('.oit-translated-host')
                    || element.querySelector('.oit-translation')
                  );
                  const translations = Array.from(
                    document.querySelectorAll('.oit-translation')
                  ).map(element => ({
                    source: element.parentElement
                      ?.querySelector('.oit-original')
                      ?.textContent?.trim() || '',
                    text: element.textContent?.trim() || ''
                  }));
                  return {
                    bodies: bodies.length,
                    translatedBodies: translatedBodies.length,
                    translations,
                    fabTranslating: document.querySelector('.oit-fab-btn')
                      ?.classList.contains('translating') || false
                  };
                }
                """
            )
            try:
                content_state = get_x_content_state(worker, timeout=1)
            except Exception as error:
                content_state = {"error": str(error)}
            diagnostics = content_state.get("diagnostics", {})
            pipeline_busy = content_state.get(
                "pipelineBusy", diagnostics.get("pipelineBusy")
            )
            if (
                observed["translatedBodies"] >= 1
                and not observed["fabTranslating"]
                and not pipeline_busy
                and diagnostics.get("queueLength") == 0
                and diagnostics.get("inflightCount") == 0
                and diagnostics.get("taskCount") == 0
            ):
                break
            page.wait_for_timeout(300)

        diagnostics = content_state.get("diagnostics", {})
        if observed.get("translatedBodies", 0) < 1:
            failures.append(
                f"Google smoke: no X body received a rendered translation: "
                f"{observed.get('translations', [])}"
            )
        translated_texts = [
            item.get("text", "")
            for item in observed.get("translations", [])
            if item.get("text")
        ]
        if not any(re.search(r"[\u3400-\u9fff]", text) for text in translated_texts):
            failures.append(
                f"Google smoke: rendered translations contain no Chinese text: "
                f"{translated_texts[:5]}"
            )
        if observed.get("fabTranslating"):
            failures.append("Google smoke: floating button remained in loading state")
        if content_state.get("sessionActive") is not True:
            failures.append(
                f"Google smoke: completed pipeline stopped observing X: {content_state}"
            )
        if content_state.get("pipelineBusy", diagnostics.get("pipelineBusy")):
            failures.append(
                f"Google smoke: pipeline did not settle: {diagnostics}"
            )
        expected_idle = {
            "queueLength": 0,
            "activeTranslations": 0,
            "pendingCount": 0,
            "translatingCount": 0,
            "inflightCount": 0,
            "taskCount": 0,
        }
        for key, expected in expected_idle.items():
            if diagnostics.get(key) != expected:
                failures.append(
                    f"Google smoke: state.{key} is {diagnostics.get(key)!r}, "
                    f"expected {expected!r}"
                )
        failures.extend(f"Google smoke page error: {error}" for error in page_errors)
    except Exception as error:
        failures.append(f"Google smoke contract failed: {error}")
    finally:
        page.close()

    return failures


def verify_service_worker_cache(popup, worker):
    failures = []
    worker.evaluate(
        """
        () => {
          globalThis.__oitOriginalFetch = globalThis.__oitOriginalFetch || globalThis.fetch;
          globalThis.__oitFetchCalls = [];
          const response = (body, status = 200) => new Response(
            JSON.stringify(body),
            { status, headers: { 'Content-Type': 'application/json' } }
          );

          globalThis.fetch = async (url, options = {}) => {
            const body = String(options.body || '');
            globalThis.__oitFetchCalls.push({ url, body });

            if (body.includes('Cancel hello')) {
              return new Promise((resolve, reject) => {
                const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
                if (options.signal?.aborted) {
                  rejectAbort();
                } else {
                  options.signal?.addEventListener('abort', rejectAbort, { once: true });
                }
              });
            }

            if (body.includes('Fail hello')) {
              return response({ error: { message: 'mock provider failure' } }, 503);
            }

            await new Promise(resolve => setTimeout(resolve, 250));
            return response({
              choices: [{ message: { content: '["共享译文"]' } }]
            });
          };
          return true;
        }
        """
    )

    config = {
        "provider": "custom",
        "apiEndpoint": "https://provider.test/v1/chat/completions",
        "apiKey": "test-key",
        "modelName": "test-model",
        "sourceLang": "en",
        "targetLang": "zh-CN",
        "translationStyle": "accurate",
        "autoDetect": False,
        "customPrompt": "",
        "maxTokens": 128,
        "temperature": 0,
        "maxConcurrent": 4,
    }

    shared = popup.evaluate(
        """
        async config => {
          const request = requestId => chrome.runtime.sendMessage({
            action: 'translate',
            texts: ['Shared hello'],
            config,
            context: { scene: 'selection' },
            requestId
          });

          const first = request('extension-cache-a');
          const second = request('extension-cache-b');
          await new Promise(resolve => setTimeout(resolve, 75));
          const abort = await chrome.runtime.sendMessage({
            action: 'abortRequest',
            requestId: 'extension-cache-a'
          });
          const concurrent = await Promise.all([first, second]);
          const beforeHit = await chrome.runtime.sendMessage({
            action: 'getTranslationCacheStats'
          });
          const cached = await request('extension-cache-c');
          const afterHit = await chrome.runtime.sendMessage({
            action: 'getTranslationCacheStats'
          });
          return { abort, concurrent, beforeHit, cached, afterHit };
        }
        """,
        config,
    )
    fetch_calls = worker.evaluate("() => globalThis.__oitFetchCalls.length")

    if not shared["abort"].get("success"):
        failures.append("service worker did not abort one shared cache waiter")
    if not shared["concurrent"][0].get("cancelled"):
        failures.append("cancelled cache waiter did not report cancellation")
    if shared["concurrent"][1].get("translations") != ["共享译文"]:
        failures.append("remaining shared waiter did not receive the translation")
    if shared["cached"].get("translations") != ["共享译文"]:
        failures.append("translation cache did not serve a repeated request")
    if fetch_calls != 1:
        failures.append(f"shared cache contract used {fetch_calls} provider requests")
    before_stats = shared["beforeHit"].get("stats", {})
    after_stats = shared["afterHit"].get("stats", {})
    if before_stats.get("loads") != 1 or before_stats.get("shared") != 1:
        failures.append(f"unexpected shared cache stats: {before_stats}")
    if after_stats.get("hits") != 1 or after_stats.get("size") != 1:
        failures.append(f"unexpected cache-hit stats: {after_stats}")

    popup.evaluate(
        "() => chrome.runtime.sendMessage({ action: 'clearTranslationCache' })"
    )

    failure_result = popup.evaluate(
        """
        async config => {
          const response = await chrome.runtime.sendMessage({
            action: 'translate',
            texts: ['Fail hello'],
            config,
            context: { scene: 'selection' },
            requestId: 'extension-cache-failure'
          });
          const stats = await chrome.runtime.sendMessage({
            action: 'getTranslationCacheStats'
          });
          return { response, stats };
        }
        """,
        config,
    )
    if "mock provider failure" not in failure_result["response"].get("error", ""):
        failures.append(
            f"provider failure did not reach the content caller: {failure_result['response']}"
        )
    if failure_result["stats"].get("stats", {}).get("size") != 0:
        failures.append("failed provider request polluted the translation cache")

    cancelled_result = popup.evaluate(
        """
        async config => {
          const request = chrome.runtime.sendMessage({
            action: 'translate',
            texts: ['Cancel hello'],
            config,
            context: { scene: 'selection' },
            requestId: 'extension-cache-cancel'
          });
          await new Promise(resolve => setTimeout(resolve, 75));
          await chrome.runtime.sendMessage({
            action: 'abortRequest',
            requestId: 'extension-cache-cancel'
          });
          const response = await request;
          const stats = await chrome.runtime.sendMessage({
            action: 'getTranslationCacheStats'
          });
          return { response, stats };
        }
        """,
        config,
    )
    if not cancelled_result["response"].get("cancelled"):
        failures.append(
            f"fully cancelled provider request did not report cancellation: "
            f"{cancelled_result['response']}"
        )
    if cancelled_result["stats"].get("stats", {}).get("size") != 0:
        failures.append("fully cancelled provider request polluted the translation cache")

    worker.evaluate(
        """
        () => {
          globalThis.fetch = globalThis.__oitOriginalFetch;
          delete globalThis.__oitOriginalFetch;
          delete globalThis.__oitFetchCalls;
        }
        """
    )
    return failures


def verify_subtitle_workspace(context, popup, worker, extension_id):
    failures = []

    popup.evaluate(
        """
        async () => {
          await chrome.storage.sync.set({
            globalConfig: {
              provider: 'custom',
              sourceLang: 'en',
              targetLang: 'zh-CN',
              translationStyle: 'accurate',
              translationScope: 'smart',
              showOriginal: true,
              autoDetect: false,
              customPrompt: '',
              maxTokens: 256,
              temperature: 0,
              maxConcurrent: 4,
              uiLanguage: 'en'
            },
            providerConfigs: {
              custom: {
                endpoint: 'https://provider.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model'
              }
            }
          });
          await chrome.runtime.sendMessage({ action: 'clearTranslationCache' });
        }
        """
    )

    worker.evaluate(
        """
        () => {
          globalThis.__oitSubtitleOriginalFetch = globalThis.fetch;
          globalThis.__oitSubtitleFetchCalls = [];
          globalThis.fetch = async (url, options = {}) => {
            globalThis.__oitSubtitleFetchCalls.push({
              url,
              body: String(options.body || '')
            });
            await new Promise(resolve => setTimeout(resolve, 250));
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: '["字幕译文"]' } }]
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          };
        }
        """
    )

    subtitle_page = context.new_page()
    subtitle_errors = []
    subtitle_page.on("pageerror", lambda error: subtitle_errors.append(str(error)))
    subtitle_page.set_viewport_size({"width": 1280, "height": 800})

    try:
        subtitle_page.goto(
            f"chrome-extension://{extension_id}/subtitle/subtitle.html",
            wait_until="domcontentloaded",
        )
        subtitle_page.wait_for_timeout(300)

        initialized = subtitle_page.evaluate(
            """
            () => ({
              core: typeof OITSubtitleCore,
              controller: typeof OITSubtitleController,
              config: typeof OITExtensionConfig,
              provider: document.querySelector('#providerName')?.textContent || ''
            })
            """
        )
        if (
            initialized["core"] != "object"
            or initialized["controller"] != "object"
            or initialized["config"] != "object"
        ):
            failures.append(f"subtitle shared scripts did not initialize: {initialized}")

        expect(subtitle_page.locator("#providerName")).to_have_text("自定义 API", timeout=3000)

        try:
            with context.expect_page(timeout=5000) as settings_page_info:
                subtitle_page.locator("#settingsBtn").click()
            settings_page = settings_page_info.value
            settings_page.wait_for_url(
                re.compile(r"/popup/popup\.html#settings$"),
                wait_until="domcontentloaded",
                timeout=5000,
            )
            expect(settings_page.locator("#settingsPanel")).to_be_visible(timeout=3000)
            settings_page.close()
        except Exception as error:
            failures.append(f"subtitle settings navigation failed: {error}")

        with TemporaryDirectory(prefix="oit-subtitle-") as fixture_dir:
            fixture = Path(fixture_dir) / "sample.srt"
            fixture.write_text(
                "1\n00:00:01,000 --> 00:00:03,000\nHello subtitle.\n",
                encoding="utf-8",
            )
            subtitle_page.locator("#fileInput").set_input_files(str(fixture))
            subtitle_page.wait_for_selector("#workspace:not([hidden])", timeout=3000)
            if subtitle_page.locator(".cue-row").count() != 1:
                failures.append("subtitle importer did not render the parsed cue")

            subtitle_page.locator("#translateBtn").click()
            subtitle_page.wait_for_timeout(75)
            if not subtitle_page.locator(".cue-translation").is_disabled():
                failures.append("subtitle translations remain editable during translation")
            expect(subtitle_page.locator(".cue-translation")).to_have_value(
                "字幕译文",
                timeout=5000,
            )
            cue_state = subtitle_page.locator(".cue-state").text_content()
            if cue_state != "Translated":
                failures.append(f"subtitle cue state is misleading: {cue_state}")

            export_control = subtitle_page.locator("#exportSrtBtn")
            with subtitle_page.expect_download() as download_info:
                export_control.click()
            download = download_info.value
            download_path = download.path()
            exported = Path(download_path).read_text(encoding="utf-8") if download_path else ""
            if not download.suggested_filename.endswith(".bilingual.srt"):
                failures.append(
                    f"subtitle export filename is incorrect: {download.suggested_filename}"
                )
            if "Hello subtitle." not in exported or "字幕译文" not in exported:
                failures.append("subtitle export omitted bilingual cue content")

        overflow = subtitle_page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth"
        )
        if overflow:
            failures.append("subtitle workspace has horizontal overflow")
        subtitle_page.set_viewport_size({"width": 390, "height": 844})
        subtitle_page.wait_for_timeout(200)
        mobile_overflow = subtitle_page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth"
        )
        if mobile_overflow:
            failures.append("subtitle workspace overflows on mobile width")

        fetch_calls = worker.evaluate("() => globalThis.__oitSubtitleFetchCalls.length")
        if fetch_calls != 1:
            failures.append(f"subtitle translation used {fetch_calls} provider requests")
        failures.extend(f"subtitle page error: {error}" for error in subtitle_errors)
    except Exception as error:
        failures.append(f"subtitle workspace contract failed: {error}")
    finally:
        worker.evaluate(
            """
            () => {
              globalThis.fetch = globalThis.__oitSubtitleOriginalFetch;
              delete globalThis.__oitSubtitleOriginalFetch;
              delete globalThis.__oitSubtitleFetchCalls;
            }
            """
        )
        subtitle_page.close()

    return failures


def verify_popup_navigation(context, extension_id):
    failures = []
    popup = context.new_page()

    try:
        popup.goto(
            f"chrome-extension://{extension_id}/popup/popup.html",
            wait_until="domcontentloaded",
        )
        with context.expect_page(timeout=5000) as subtitle_page_info:
            popup.locator("#subtitleBtn").click()
        subtitle_page = subtitle_page_info.value
        subtitle_page.wait_for_url(
            re.compile(r"/subtitle/subtitle\.html$"),
            wait_until="domcontentloaded",
            timeout=5000,
        )
        if not subtitle_page.url.endswith("/subtitle/subtitle.html"):
            failures.append(
                f"subtitle popup action opened the wrong URL: {subtitle_page.url}"
            )
        subtitle_page.close()
    except Exception as error:
        failures.append(f"subtitle popup action failed: {error}")
    finally:
        if not popup.is_closed():
            popup.close()

    settings_popup = context.new_page()
    try:
        settings_popup.goto(
            f"chrome-extension://{extension_id}/popup/popup.html#settings",
            wait_until="domcontentloaded",
        )
        expect(settings_popup.locator("#settingsPanel")).to_be_visible(timeout=3000)
        if settings_popup.locator("#mainContent").is_visible():
            failures.append("settings deep link left the main popup panel visible")
    except Exception as error:
        failures.append(f"settings deep link failed: {error}")
    finally:
        settings_popup.close()

    return failures


def verify_extension_version_contract(
    context,
    extension_id,
    page_url,
):
    failures = []
    manifest_version = None
    popup = context.new_page()

    try:
        popup.goto(
            f"chrome-extension://{extension_id}/popup/popup.html",
            wait_until="domcontentloaded",
        )
        manifest_version = popup.evaluate(
            "() => chrome.runtime.getManifest().version"
        )
        version_badge = popup.locator("#extensionVersion")
        expect(version_badge).to_be_visible(timeout=3000)
        observed_version = version_badge.text_content()
        expected_version = f"v{manifest_version}"
        if observed_version != expected_version:
            failures.append(
                f"popup version badge is {observed_version!r}, "
                f"expected {expected_version!r}"
            )
        version_in_viewport = version_badge.evaluate(
            """
            element => {
              const rect = element.getBoundingClientRect();
              return (
                rect.width > 0
                && rect.height > 0
                && rect.top >= 0
                && rect.bottom <= window.innerHeight
              );
            }
            """
        )
        if not version_in_viewport:
            failures.append(
                "popup version badge is outside the initial viewport"
            )
    except Exception as error:
        failures.append(f"popup version display failed: {error}")

    try:
        ping = popup.evaluate(
            """
            async pattern => {
              const tabs = await chrome.tabs.query({ url: pattern });
              if (!tabs.length || !tabs[0].id) {
                return { error: `No matching tab found: ${pattern}` };
              }
              try {
                return await chrome.tabs.sendMessage(
                  tabs[0].id,
                  { action: 'ping' }
                );
              } catch (error) {
                return { error: String(error) };
              }
            }
            """,
            f"{page_url}*",
        )
        if ping.get("pong") is not True:
            failures.append(f"content-script ping failed: {ping!r}")
        elif ping.get("version") != manifest_version:
            failures.append(
                f"content-script runtime version is {ping.get('version')!r}, "
                f"expected {manifest_version!r}"
            )
    except Exception as error:
        failures.append(f"content-script runtime version check failed: {error}")
    finally:
        popup.close()

    return failures


def read_popup_lifecycle_state(popup):
    return popup.evaluate(
        """
        () => {
          const button = document.querySelector('#translatePageBtn');
          const icon = document.querySelector('#statusCard .status-icon');
          const restore = document.querySelector('#restoreBtn');
          return {
            buttonI18n: button?.querySelector('[data-i18n]')?.getAttribute('data-i18n'),
            buttonBusy: button?.classList.contains('translating') || false,
            buttonSessionActive: button?.classList.contains('session-active') || false,
            statusType: Array.from(icon?.classList || [])
              .find(className => className !== 'status-icon') || '',
            statusDescription: document.querySelector('#statusCard .status-desc')
              ?.textContent || '',
            restoreVisible: restore ? getComputedStyle(restore).display !== 'none' : false
          };
        }
        """
    )


def verify_popup_lifecycle_contract(context, worker, extension_id):
    failures = []
    cases = [
        {
            "name": "busy",
            "message": {
                "action": "translationStateChanged",
                "status": "translating",
                "pipelineBusy": True,
                "sessionActive": True,
                "phase": "scanning",
                "hasTranslations": False,
            },
            "expected": {
                "buttonI18n": "stopTranslate",
                "buttonBusy": True,
                "buttonSessionActive": True,
                "statusType": "working",
                "restoreVisible": False,
            },
        },
        {
            "name": "completed after reopen",
            "message": {
                "action": "translationComplete",
                "count": 2,
                "pipelineBusy": False,
                "sessionActive": True,
                "phase": "completed",
                "hasTranslations": True,
            },
            "expected": {
                "buttonI18n": "stopTranslate",
                "buttonBusy": False,
                "buttonSessionActive": True,
                "statusType": "success",
                "restoreVisible": True,
            },
        },
        {
            "name": "provider failure after reopen",
            "message": {
                "action": "translationError",
                "error": "provider unavailable",
                "translatedCount": 0,
                "sessionActive": True,
                "phase": "failed",
                "hasTranslations": False,
            },
            "expected": {
                "buttonI18n": "stopTranslate",
                "buttonBusy": False,
                "buttonSessionActive": True,
                "statusType": "error",
                "restoreVisible": False,
                "statusDescription": "provider unavailable",
            },
        },
        {
            "name": "no content after reopen",
            "message": {
                "action": "translationError",
                "error": "No translatable page content was found",
                "translatedCount": 0,
                "sessionActive": True,
                "phase": "failed",
                "hasTranslations": False,
            },
            "expected": {
                "buttonI18n": "stopTranslate",
                "buttonBusy": False,
                "buttonSessionActive": True,
                "statusType": "error",
                "restoreVisible": False,
                "statusDescription": "No translatable page content was found",
            },
        },
        {
            "name": "stopped",
            "message": {
                "action": "translationStateChanged",
                "status": "stopped",
                "pipelineBusy": False,
                "sessionActive": False,
                "phase": "stopped",
                "hasTranslations": False,
            },
            "expected": {
                "buttonI18n": "translatePage",
                "buttonBusy": False,
                "buttonSessionActive": False,
                "statusType": "idle",
                "restoreVisible": False,
            },
        },
    ]

    for case in cases:
        popup = context.new_page()
        popup_errors = []
        popup.on("pageerror", lambda error: popup_errors.append(str(error)))
        try:
            popup.goto(
                f"chrome-extension://{extension_id}/popup/popup.html",
                wait_until="domcontentloaded",
            )
            popup.wait_for_timeout(250)
            worker.evaluate(
                """
                message => {
                  chrome.runtime.sendMessage(message).catch(() => {});
                }
                """,
                case["message"],
            )
            popup.wait_for_timeout(100)
            observed = read_popup_lifecycle_state(popup)
            for key, expected in case["expected"].items():
                if observed.get(key) != expected:
                    failures.append(
                        f"popup {case['name']} state.{key} is "
                        f"{observed.get(key)!r}, expected {expected!r}"
                    )
            failures.extend(
                f"popup {case['name']} page error: {error}"
                for error in popup_errors
            )
        except Exception as error:
            failures.append(f"popup {case['name']} lifecycle failed: {error}")
        finally:
            popup.close()

    return failures


def verify_reinjection_asset_contract(popup):
    failures = []
    try:
        contract = popup.evaluate(
            """
            () => {
              const assets = OITContentScriptInjection.resolveContentScriptAssets(
                chrome.runtime.getManifest()
              );
              return {
                scripts: assets.scripts,
                css: assets.css
              };
            }
            """
        )
        scripts = contract.get("scripts", [])
        css = contract.get("css", [])
        required_scripts = {
            "shared/content-signals.js",
            "shared/translation-core.js",
            "shared/page-scanner.js",
            "shared/translation-session.js",
            "shared/translation-scheduler.js",
            "shared/translation-source-state.js",
            "content/content.js",
        }
        missing = sorted(required_scripts.difference(scripts))
        if missing:
            failures.append(
                f"stale-tab injection bundle is missing shared assets: {missing}"
            )
        if scripts[-1:] != ["content/content.js"]:
            failures.append(
                "stale-tab injection bundle must execute content/content.js last"
            )
        if "styles/content.css" not in css:
            failures.append("stale-tab injection bundle is missing content CSS")
    except Exception as error:
        failures.append(f"stale-tab injection asset contract failed: {error}")

    return failures


def verify_package_boundary():
    failures = []
    forbidden_parts = {
        ".git",
        "docs",
        "node_modules",
        "scripts",
        "tests",
        "thirdparty",
    }
    text_suffixes = {".css", ".html", ".js", ".json", ".svg"}

    for path in EXTENSION.rglob("*"):
        relative = path.relative_to(EXTENSION)
        if forbidden_parts.intersection(relative.parts):
            failures.append(f"extension package contains forbidden path: {relative}")
            continue
        if not path.is_file() or path.suffix.lower() not in text_suffixes:
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        if path.suffix.lower() == ".css" and re.search(
            r"@import\s+(?:url\()?['\"]?https?://", content, re.IGNORECASE
        ):
            failures.append(
                f"extension CSS contains a network-blocking remote import: {relative}"
            )
        for identifier in ("OnlyTranslate", "airhunter"):
            if identifier in content:
                failures.append(
                    f"extension package contains reference identifier "
                    f"{identifier!r}: {relative}"
                )

    required = {
        Path("manifest.json"),
        Path("subtitle/subtitle.html"),
        Path("subtitle/subtitle.js"),
        Path("shared/subtitle-core.js"),
        Path("shared/subtitle-controller.js"),
    }
    missing = sorted(str(path) for path in required if not (EXTENSION / path).is_file())
    if missing:
        failures.append(f"extension package is missing subtitle files: {missing}")

    return failures


def main():
    run_x_e2e = "--x-e2e" in sys.argv[1:]
    run_x_google_e2e = "--x-google-e2e" in sys.argv[1:]
    x_live_result = {"navigationCoverage": "not-run"}

    if not (EXTENSION / "manifest.json").exists():
        print("Built extension not found; run `npm run build` first.", file=sys.stderr)
        return 2

    server = ThreadingHTTPServer(("127.0.0.1", 0), SmokePageHandler)
    server_thread = Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    failures = verify_package_boundary()
    try:
        with sync_playwright() as playwright:
            executable = find_chromium(playwright)
            if not executable:
                print("No Playwright Chromium executable found.", file=sys.stderr)
                return 2

            with TemporaryDirectory(prefix="oit-extension-") as profile:
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    executable_path=executable,
                    headless=True,
                    args=[
                        f"--disable-extensions-except={EXTENSION}",
                        f"--load-extension={EXTENSION}",
                        "--no-first-run",
                        "--no-default-browser-check",
                    ],
                )

                page = context.pages[0] if context.pages else context.new_page()
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                cdp = context.new_cdp_session(page)
                execution_contexts = []
                cdp.on(
                    "Runtime.executionContextCreated",
                    lambda event: execution_contexts.append(event["context"]),
                )
                cdp.send("Runtime.enable")
                page.goto(
                    f"http://127.0.0.1:{server.server_port}/",
                    wait_until="domcontentloaded",
                )

                try:
                    page.wait_for_selector(".oit-fab-btn", timeout=5000)
                except Exception:
                    failures.append("content script did not inject its floating button")

                scanner_initialized = False
                for execution_context in reversed(execution_contexts):
                    if execution_context.get("auxData", {}).get("type") != "isolated":
                        continue
                    try:
                        result = cdp.send(
                            "Runtime.evaluate",
                            {
                                "expression": "typeof OITPageScanner",
                                "contextId": execution_context["id"],
                                "returnByValue": True,
                            },
                        )
                    except Exception:
                        continue
                    if result.get("result", {}).get("value") == "object":
                        scanner_initialized = True
                        break
                if not scanner_initialized:
                    failures.append("content script page scanner did not initialize")

                worker = wait_for_service_worker(context)
                if not worker:
                    failures.append("MV3 service worker did not start")

                if page_errors:
                    failures.extend(f"page error: {error}" for error in page_errors)

                extension_id = ""
                if worker:
                    match = re.match(r"chrome-extension://([^/]+)/", worker.url)
                    extension_id = match.group(1) if match else ""
                    if "background/service-worker.js" not in worker.url:
                        failures.append(f"unexpected service worker URL: {worker.url}")

                if extension_id:
                    try:
                        failures.extend(
                            verify_extension_version_contract(
                                context,
                                extension_id,
                                f"http://127.0.0.1:{server.server_port}/",
                            )
                        )
                    except Exception as error:
                        failures.append(
                            f"extension version contract failed: {error}"
                        )
                    popup = context.new_page()
                    popup_errors = []
                    popup.on("pageerror", lambda error: popup_errors.append(str(error)))
                    popup.goto(
                        f"chrome-extension://{extension_id}/popup/popup.html",
                        wait_until="domcontentloaded",
                    )
                    popup.wait_for_timeout(500)
                    core_type = popup.evaluate("typeof OITTranslationCore")
                    provider_core_type = popup.evaluate("typeof providerTranslationCore")
                    if core_type != "object" or provider_core_type != "object":
                        failures.append("popup shared translation scripts did not initialize")
                    if not popup.locator("#translationScope").count():
                        failures.append("popup translation scope control is missing")
                    failures.extend(f"popup error: {error}" for error in popup_errors)
                    failures.extend(verify_reinjection_asset_contract(popup))
                    try:
                        failures.extend(verify_popup_navigation(context, extension_id))
                    except Exception as error:
                        failures.append(f"popup navigation contract failed: {error}")
                    if worker:
                        try:
                            failures.extend(
                                verify_popup_lifecycle_contract(
                                    context,
                                    worker,
                                    extension_id,
                                )
                            )
                        except Exception as error:
                            failures.append(f"popup lifecycle contract failed: {error}")
                        try:
                            failures.extend(verify_service_worker_cache(popup, worker))
                        except Exception as error:
                            failures.append(f"service worker cache contract failed: {error}")
                        try:
                            failures.extend(
                                verify_subtitle_workspace(
                                    context,
                                    popup,
                                    worker,
                                    extension_id,
                                )
                            )
                        except Exception as error:
                            failures.append(f"subtitle workspace setup failed: {error}")
                        try:
                            failures.extend(
                                verify_local_page_translation(
                                    context,
                                    worker,
                                    extension_id,
                                    server.server_port,
                                )
                            )
                        except Exception as error:
                            failures.append(f"local page translation setup failed: {error}")
                        if run_x_e2e:
                            try:
                                failures.extend(
                                    verify_x_page_translation(
                                        context,
                                        worker,
                                        extension_id,
                                        x_live_result,
                                    )
                                )
                            except Exception as error:
                                failures.append(f"X page translation setup failed: {error}")
                        if run_x_google_e2e:
                            try:
                                failures.extend(
                                    verify_x_google_smoke(
                                        context,
                                        worker,
                                        extension_id,
                                    )
                                )
                            except Exception as error:
                                failures.append(
                                    f"live X + Google translation setup failed: {error}"
                                )

                context.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print(f"Extension loaded: {extension_id}")
    print("Content script, service worker, and popup initialized")
    print("Generic and X-like page translation contracts passed")
    if run_x_e2e:
        coverage = x_live_result.get("navigationCoverage")
        if coverage == "authenticated":
            print("Live X page translation contract passed, including authenticated navigation")
        elif coverage == "guest":
            print(
                "Live X page translation contract passed for the guest surface; "
                "authenticated navigation remains unverified"
            )
        elif coverage == "navigation-only-unverified":
            print(
                "Live X page translation contract passed for navigation-visible content; "
                "the session could not be proven authenticated"
            )
        else:
            print(f"Live X page translation contract passed with coverage={coverage}")
        print(
            "Live X diagnostics: "
            f"scanner={x_live_result.get('scannerCandidates', 0)} "
            f"(visible={x_live_result.get('scannerVisibleCandidates', 0)}, "
            f"navigation={x_live_result.get('scannerNavigationCandidates', 0)}), "
            f"providerTargets={x_live_result.get('providerTargets', 0)}, "
            f"translatedBodies={x_live_result.get('translatedBodies', 0)} "
            f"(visible={x_live_result.get('visibleBodies', 0)}), "
            f"translatedNavigation={x_live_result.get('translatedNavigation', 0)} "
            f"(visible={x_live_result.get('visibleNavigation', 0)}), "
            f"maxQueue={x_live_result.get('maxQueueObserved', 0)}, "
            f"pipelineBusy={x_live_result.get('pipelineBusy')}"
        )
    if run_x_google_e2e:
        print("Live X page + real Google Translate contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
