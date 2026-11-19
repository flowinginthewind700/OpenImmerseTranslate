# Site Profile Contract

Generic page translation is the default. A site profile is an optional module
for a site whose DOM hides stable content or navigation semantics that the
generic scanner cannot infer safely.

Profiles live in `shared/site-profiles/`. The registry in
`shared/content-site-adapters.js` selects the first profile whose `matches`
function accepts the current document. Unknown sites always use `generic`.

## Required Interface

Every profile must expose:

- `id`: a stable lowercase profile id.
- `matches(documentRef, locationRef)`: returns whether this profile applies.

Profiles may also expose:

- `semanticTargets`: selectors for site-specific semantic translation units.
- `getSemanticContentRole(element)`: returns a role such as `post-body`,
  `navigation-label`, or `metadata`.
- `getElementPolicy(element, scope)`: returns `keep`, `skip-self`, or
  `skip-subtree` when the generic classifier must be overridden.
- `findAdaptiveRoots(base, options)`: returns structurally identifiable
  navigation or menu roots.
- `diagnoseAdaptiveRoots(base, options)`: returns adaptive roots together with
  diagnostic sources, such as `x:route-cluster` or `x:sidenav-cluster`. The
  scanner uses this interface when available and falls back to wrapping
  `findAdaptiveRoots()` as `site:<profile-id>`.
- `getAdaptiveRoot(element, options)`: resolves the nearest adaptive root for a
  dynamic mutation.
- `findSupplementalRoots(base, options)`: returns visible secondary content
  regions, such as a right rail, whose content should still translate even
  when generic page-shell filtering would normally skip the container.
- `getSupplementalRoot(element, options)`: resolves the nearest supplemental
  root for a viewport or mutation scan.

Profiles do not own traversal, visibility, unitization, retry, caching, or
translation. Those stay in the shared kernel so profile changes have a bounded
blast radius.

## Adaptive Root Scope

The scanner combines generic adaptive roots with every matching profile's
adaptive roots. A mutation is relevant when it is inside an adaptive root, when
it contains an adaptive root, or when it is an ancestor that reveals one. This
outer-wrapper rule is required for SPA shells where a framework portal or
layout wrapper changes before the actual navigation root becomes visible.

Adaptive roots do not make a site profile the default translation strategy.
Unknown sites still use generic discovery, and profile code only contributes
site-specific semantic roles and root evidence.

## Supplemental Content Scope

Supplemental content is page content outside the primary reading root that
still has immediate user value, including trend cards, contextual headings, and
visible recommendation descriptions. It is not equivalent to "translate every
sidebar element": account names, handles, timestamps, badges, counts, and
interactive controls remain metadata or UI.

The scanner gives supplemental roots a separate traversal and candidate budget.
The content scheduler gives resulting translation units a `supplemental` lane
with reserved concurrency, so long body queues cannot starve a visible right
rail. Dynamic mutations inside or introducing a supplemental root re-resolve
that scope and can translate newly mounted cards.

This contract is generic at the kernel boundary. The X profile currently
supplies stable sidebar and trend evidence, while unknown websites continue to
use generic page heuristics. A future site profile should add only stable root
or semantic evidence that the generic scanner cannot infer safely.

## Navigation Evidence

Generic discovery recognizes semantic landmarks, then infers compact,
non-semantic control clusters from visible labels and layout. ARIA roles and
selection state such as `role="tab"`, `aria-selected`, and `aria-current`
strengthen that evidence, including two-control tab groups whose links resolve
to the same path. Article-local controls remain content interaction and are not
opened as persistent navigation.

Site profiles may add bounded evidence that generic code cannot infer safely,
such as known routes or stable framework attributes. X combines those signals
with common-ancestor grouping so a rail can retain profile, settings, and other
dynamic account links once a core navigation destination anchors the cluster.
The profile does not treat every internal link as navigation.

When a mutation introduces one item into an adaptive cluster, dynamic scanning
re-resolves the nearest root and scans that whole cluster. This translates
already-rendered siblings without requiring a later viewport pass, while the
adaptive-domain budget still bounds the work.

## Adaptive Root Diagnostics

The runtime `getTranslationState` response exposes scanner diagnostics under
`diagnostics`. Adaptive-root fields are:

- `adaptiveUiRootsFound`: total accepted and rejected root discoveries.
- `adaptiveUiRootsAccepted`: roots admitted to the adaptive UI scope.
- `adaptiveUiRootsRejected`: roots rejected because they were disconnected,
  invisible, or extension-owned.
- `adaptiveUiRootSources`: per-source discovery counts, including generic,
  site-profile, and nearest-root resolution paths.
- `adaptiveUiRootSamples`: bounded, non-HTML root samples with source, accepted
  state, rejection reason, tag, and id.

These fields distinguish a profile-selection failure from a visibility,
dynamic-rendering, or translation-pipeline failure. They are diagnostic data,
not a promise that every discovered root contains translatable text.

## Bounded Retry Contract

Failed translation units are tracked by the element's normalized source text,
not by scanner-derived metadata or extension-owned classes. This prevents a
new scanner pass from bypassing failure state when roles, site labels, or
protected token ids change without the source text changing.

The content kernel permits two automatic attempts for the same source text.
Failures enter a 30-second cooldown, then back off exponentially up to 120
seconds. A source-text change resets the attempt budget, and a successful
translation clears failure state. Stopping and explicitly restarting a
translation session also starts a fresh policy window.

Provider transports may perform their own bounded network retries. Content
retry state exists to stop scanner-driven request loops and to let the
translation pipeline settle with all queue, task, and in-flight counters at
zero even when content cannot be translated.

## Compatibility Rules

- Start every profile change with a redacted DOM fixture and a failing test.
- Prefer multiple independent signals: semantic landmarks, stable site
  attributes, known destinations, and bounded common-ancestor grouping.
- Do not treat one link, one numeric badge, or one broad container as
  navigation.
- Dynamic menus and portals must be reachable from a mutation root through
  `getAdaptiveRoot`.
- Generic heuristics remain the fallback for every unprofiled website.

## Coverage Boundary

The project does not claim that every page can be translated. Closed shadow
roots, cross-origin iframes, canvas-only text, protected editors, authenticated
DOM variants that have not been captured, and sites that block automation still
require separate compatibility work and acceptance tests.

The current live contract covers an anonymous public X page, including
persistent navigation discovered from adaptive roots. An authenticated X
session remains a separate acceptance target because authenticated DOM can add
account menus, composer surfaces, and virtualized navigation variants that are
not present in the anonymous page.

Supplemental translation support does not promise complete coverage for
cross-origin iframes, closed shadow roots, canvas-rendered text, protected
editors, content hidden behind unimplemented authenticated variants, or pages
that block extension execution. The presence of a site profile is a fallback
for stable DOM semantics, not a requirement for translating a new website.
