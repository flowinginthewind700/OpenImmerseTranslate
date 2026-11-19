# Reference Project Evaluation

## Purpose

This document records the external reference used during the translation-kernel
rewrite so future commercial maintenance can audit provenance and licensing.
It is not a claim that the reference project has been copied or that this
project is a fork of it.

## Verified Source

- Repository: `https://github.com/airhunter/OnlyTranslate.git`
- Local audit checkout: `thirdparty/OnlyTranslate-git`
- Evaluated commit: `91cbe76c062668d8655b1fdeacab845205a7bdae`
- Commit date: `2026-11-10T20:22:31+08:00`
- Reference version: `1.15.0` in its `package.json`
- Reference license: GNU GPL v3.0
- This project: MIT

The local checkout is excluded by `.gitignore`, is not copied by
`scripts/build.js`, and must not be included in extension packages.

## License Boundary

OnlyTranslate is GPLv3-licensed. Its source code, tests, copy, images, and
other assets must not be copied into this MIT project. This evaluation only
uses non-expressive architectural observations, publicly documented behavior,
and general software-engineering patterns.

The implementation under `background/` and the tested `shared/` kernels were
written for this repository against its existing message protocol, DOM model,
cache policy, and provider configuration. They are not line-by-line ports of
the reference project. Any future contributor who wants to reuse reference
code or assets must first resolve the resulting GPLv3 obligations; a reference
to this document is not a license grant.

This is an engineering provenance record, not legal advice.

## Evaluated Design Areas

The following observations were verified in the checked-out reference and
were used only as design input:

1. Translation requests use bounded retry with exponential delay, retry only
   transient failures, and make the backoff aware of cancellation.
2. Batch translation validates result count and protected placeholders, then
   falls back to single-item work when a batch response is unusable.
3. Translation cache identity includes output-affecting policy, provider,
   model, language, and prompt-context inputs.
4. In-flight work is deduplicated, while independently cancellable callers
   must not cancel work still needed by another caller.
5. Content detection is layered into collection, filtering/classification,
   unitization, root selection, and dynamic scanning rather than one flat list
   of site-specific selectors.
6. Dependency directions are explicit: transport, scheduling, validation,
   cache policy, and UI lifecycle have separate ownership boundaries.
7. Regression tests cover cancellation, retry classification, fallback,
   cache identity, protected-token validation, and DOM lifecycle behavior.

### Content-Detection Audit

The content-detection review covered these verified reference paths:

- `entrypoints/main/translationTarget/collect.ts`
- `entrypoints/main/translationTarget/decision.ts`
- `entrypoints/main/translationTarget/dynamic.ts`
- `entrypoints/main/translationTarget/scanContext.ts`
- `entrypoints/main/translationTarget/unitizer.ts`
- `entrypoints/main/siteProfiles/x.ts`
- `docs/architecture/content-detection.md`

The useful architectural input is the explicit
`collect -> decision -> dynamic -> ScanContext -> unitizer` separation,
budgeted scanning, smart/root/body fallback, mutation-root merging, and
visibility/classification caches.

This project does not use the reference X profile as a navigation algorithm.
At the audited commit, that profile selects post text and explicitly excludes
`nav`, `[role="navigation"]`, `header`, and interactive controls through its
`UI_SELECTOR`. Its X profile is therefore post-only and cannot satisfy this
project's persistent-navigation requirement. The local site profile and
navigation budget policy are original implementations tested against this
repository's own fixtures.

## Local Implementation

The local implementation adapts the underlying engineering ideas to this
project's existing contracts:

- `background/rate-limiter.js`: cancellable concurrency queue, minimum request
  interval, retry classification, exponential backoff, and abort-aware sleep.
- `background/provider-transport.js`: provider-specific request envelopes,
  bounded fetch/body/JSON deadlines, response parsing, and transport errors.
- `background/translation-service.js`: cache coordination, batch validation,
  single-request fallback, context alignment, retry, and cancellation.
- `background/service-worker.js`: MV3 runtime wiring, messages, tab state, and
  lifecycle concerns only.
- `shared/request-cache.js`: bounded TTL/LRU cache, in-flight deduplication, and
  waiter-isolated cancellation.
- `shared/request-timeout.js`: cancellable deadline ownership shared by content
  and provider boundaries, including independent settlement when the wrapped
  task ignores its abort signal.
- `shared/translation-source-state.js`: per-element source generations and
  fingerprints that reject provider responses when a framework changed the
  source after the request started.
- `shared/extension-config.js`: normalized runtime configuration loaded from
  `chrome.storage.sync`, including safe provider fallback.
- `shared/content-*`, `shared/page-scanner.js`, and
  `shared/translation-core.js`: testable content-selection and translation
  policy kernels.
- `shared/subtitle-core.js`: independently tested SRT/WebVTT parsing, cue
  cleaning, segmentation, batching, timestamp formatting, and bilingual export.
- `shared/subtitle-controller.js`: ordered subtitle batches, result alignment,
  partial-failure continuation, cancellation, and progress events.
- `subtitle/`: the SRT/WebVTT workspace for import, provider configuration,
  translation, direct edits, and bilingual export.

The reference project advertises video subtitle, EPUB, and PDF workflows. This
repository currently implements subtitle files only. EPUB and PDF must not be
described as supported until each format has its own parser, controller,
import/export acceptance tests, and package-level integration tests.

The tests are owned by this project and use synthetic fixtures. No reference
test files, source files, copy, or visual assets are copied into this
repository.

## Regression Contract

`npm run test:browser` runs the dependency-free kernels in real Chromium.
`npm run test:extension` builds the package, loads the MV3 extension, and
checks content-script injection, stale-tab reinjection bundles, service-worker
startup, popup wiring, shared request deduplication, cache hits, cancellation,
and failure non-caching.
`npm run test:e2e:x` additionally verifies the built extension against a live
public X status page, including post-body selection, FAB completion, and
convergence of queue, pending, inflight, and translation task state. The live
page contract replaces the provider network call with a deterministic mock;
this proves extension-to-provider transport invocation, not the availability of
a production provider. `npm run test:e2e:x:google` performs the optional
network-dependent smoke test against the real Google Translate endpoint. Both
live checks are separate so the default suite remains deterministic.

## Site Coverage Boundary

The content kernel is generic rather than site-complete. Its registry falls
back to shared heuristics for unprofiled sites and delegates only bounded,
site-specific semantics to optional profiles. The profile contract is
documented in `docs/site-profiles.md`. It is tested against ordinary-page
fixtures, X/Twitter fixtures, open shadow roots, dynamic DOM mutation, and a
live anonymous X status page. The optional Google E2E loads the built extension,
translates the live X page through the real Google endpoint, and verifies that
Chinese translations render while the FAB, session, queue, inflight work, and
task state converge.

The following are not covered by the current automated contract and must not be
claimed as universally supported:

- Live, authenticated X/Twitter sessions and account-menu variants not
  represented by the redacted fixtures.
- Closed shadow roots, cross-origin iframe content, canvas-only text, and
  proprietary editors.
- Sites that block automation, require authentication, or change their DOM
  faster than the bounded scanner and adapter tests can be maintained.

New compatibility work should start with a captured, redacted DOM fixture and a
failing regression test. General selector widening is not a substitute for a
site adapter because it increases metadata and interface mistranslation risk.

Commercial changes to providers, prompts, cache keys, or cancellation
semantics must add a failing test first. Subtitle format changes follow the same
rule. Preserve these invariants:

- A cancelled waiter never receives cached data as a successful result.
- One waiter cancellation does not abort a request still needed by another.
- Cancelling all waiters aborts transport and does not write cache data.
- Batch output must match the input count and preserve protected tokens.
- Invalid batch output falls back to aligned single requests.
- Provider failures and cancellations are never cached.
- Retry backoff stops immediately on cancellation and releases scheduler
  capacity.
- A provider or runtime message that never settles must hit one bounded
  deadline, abort worker-side work, release content queue/concurrency/DOM
  bookkeeping, and leave the FAB reusable for a clean retry.
- A provider response may mutate the DOM only when its captured source
  generation and normalized source text still match the current element.
  `characterData`, child replacement, and plain-text in-place updates must all
  invalidate stale in-flight responses.
- Page, document-title, and selection requests own separate cancellation state;
  hiding or replacing a selection panel cannot apply a late response.
- SRT and WebVTT parsing tolerates BOM/CRLF input, multiline cues, entities,
  presentation tags, WebVTT metadata, and malformed blocks without losing later
  valid cues.
- Exported subtitle timestamps round-trip through the parser, carry correctly
  across second and minute boundaries, and skipped cues do not create numbering
  gaps.
- Subtitle batch result counts must align with input segments; partial failures
  retain successful translations, and cancellation cannot update a newer file.
- A real built extension must load the subtitle shared scripts and stored
  provider configuration, import a fixture, translate it, export bilingual
  output, open the workspace from the popup, and avoid horizontal overflow at
  desktop and mobile viewport widths.
