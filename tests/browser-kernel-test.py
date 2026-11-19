#!/usr/bin/env python3
"""Run the translation kernel in a real Chrome DOM."""

from pathlib import Path
import os
import sys

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def run_page(page, filename, runner):
    page_errors = []
    on_page_error = lambda error: page_errors.append(str(error))
    page.on("pageerror", on_page_error)
    failures = []

    try:
        page.goto((ROOT / "tests" / filename).as_uri())
        has_runner = page.evaluate(f"() => typeof window.{runner} === 'function'")
        if not has_runner:
            failures.append({
                "name": f"{filename}: runner",
                "error": f"window.{runner} is unavailable",
            })
        else:
            result = page.evaluate(f"() => window.{runner}()")
            failures.extend(result["failures"])
            for failure in result["failures"]:
                print(f"FAIL: {failure['name']}\n{failure['error']}\n", file=sys.stderr)
            print(
                f"{filename}: {result['total'] - len(result['failures'])}/{result['total']} passed"
            )
    except Exception as error:
        failures.append({"name": f"{filename}: execution", "error": str(error)})
    finally:
        page.remove_listener("pageerror", on_page_error)

    for error in page_errors:
        failure = {"name": f"{filename}: page error", "error": error}
        failures.append(failure)
        print(f"FAIL: {failure['name']}\n{failure['error']}\n", file=sys.stderr)
    if page_errors:
        print(f"{filename}: {len(page_errors)} page error(s)", file=sys.stderr)
    return failures


def main():
    if not Path(CHROME).exists():
        print(f"Chrome executable not found: {CHROME}", file=sys.stderr)
        return 2

    failures = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROME, headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        failures.extend(run_page(page, "content-signals.html", "runContentSignalsTests"))
        failures.extend(run_page(
            page,
            "content-unitizer.html",
            "runContentUnitizerTests",
        ))
        failures.extend(run_page(
            page,
            "content-ui-policy.html",
            "runContentUiPolicyTests",
        ))
        failures.extend(run_page(page, "content-filter.html", "runContentFilterTests"))
        failures.extend(run_page(
            page,
            "content-unit-classifier.html",
            "runContentUnitClassifierTests",
        ))
        failures.extend(run_page(
            page,
            "content-root-detector.html",
            "runContentRootDetectorTests",
        ))
        failures.extend(run_page(page, "prompt-policy.html", "runPromptPolicyTests"))
        failures.extend(run_page(page, "model-policy.html", "runModelPolicyTests"))
        failures.extend(run_page(
            page,
            "extension-config.html",
            "runExtensionConfigTests",
        ))
        failures.extend(run_page(page, "subtitle-core.html", "runSubtitleCoreTests"))
        failures.extend(run_page(
            page,
            "subtitle-controller.html",
            "runSubtitleControllerTests",
        ))
        failures.extend(run_page(
            page,
            "request-timeout.html",
            "runRequestTimeoutTests",
        ))
        failures.extend(run_page(page, "rate-limiter.html", "runRateLimiterTests"))
        failures.extend(run_page(
            page,
            "provider-transport.html",
            "runProviderTransportTests",
        ))
        failures.extend(run_page(
            page,
            "translation-service.html",
            "runTranslationServiceTests",
        ))
        failures.extend(run_page(page, "request-cache.html", "runRequestCacheTests"))
        failures.extend(run_page(page, "translation-core.html", "runKernelTests"))
        failures.extend(run_page(
            page,
            "translation-retry-policy.html",
            "runTranslationRetryPolicyTests",
        ))
        failures.extend(run_page(
            page,
            "translation-session.html",
            "runTranslationSessionTests",
        ))
        failures.extend(run_page(
            page,
            "translation-scheduler.html",
            "runTranslationSchedulerTests",
        ))
        failures.extend(run_page(
            page,
            "translation-source-state.html",
            "runTranslationSourceStateTests",
        ))
        failures.extend(run_page(
            page,
            "content-script-injection.html",
            "runContentScriptInjectionTests",
        ))
        failures.extend(run_page(page, "page-scanner.html", "runPageScannerTests"))
        failures.extend(run_page(
            page,
            "x-twitter-content.html",
            "runXTwitterContentTests",
        ))
        failures.extend(run_page(page, "content-collection.html", "runCollectionTests"))
        failures.extend(run_page(page, "content-integration.html", "runContentIntegrationTests"))
        browser.close()

    if failures:
        print(f"{len(failures)} browser kernel test(s) failed", file=sys.stderr)
        return 1
    print("All browser kernel tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
