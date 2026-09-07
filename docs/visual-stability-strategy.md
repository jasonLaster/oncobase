# Page flashing and layout stability

## Contract

Readable content should survive background work. A new document should replace
the previous document when its body is ready, without an intervening blank or
skeleton. A saved first frame should use current layout preferences and hand
over to a ready reader in one step. Images and other delayed content must reserve
their space. These are separate requirements from the browser's CLS score.

Intentional navigation can replace text. User resizing can change geometry.
Logout, revoked access, and deleted content must remove unavailable content even
if that breaks continuity. Never retain an obsolete private DOM to improve a
visual metric. Tests for these transitions assert the appropriate terminal state.

## Confirmed causes in this investigation

| Cause | Observed failure before fix | Root change |
| --- | --- | --- |
| Automatic identity resolution mounted a public reader optimistically | Delayed session identity removed heading, body, navigation, both links, and right rail together | Select identity before mounting the reader; keep the read-only public snapshot until the selected reader is ready; never persist session HTML into public snapshot storage |
| Saved HTML contained old pane preferences | Sidebar changed from 256px to 192px and article moved 32px horizontally | Apply current validated sidebar and outline preferences before exposing saved HTML |
| A deferred route slug did not defer the asynchronous body request | Slow navigation removed the markdown body after the click | Keep querying the displayed page until the destination query contains its own body or terminal result; verify the returned row's slug before switching |
| Pending navigation used the destination route to choose the old page's layout | Leaving home inserted a header and moved the retained body from y=64 to y=132 before the destination body arrived | Retain the displayed route together with its body, including home and index-alias layout rules |
| A transient stale-content notice participated in document flow | Body moved from y=132 to y=185.5 and back | Position refresh status outside document flow |
| Dimensionless markdown images had no reserved preview space | Text below a delayed figure moved 450px | Reserve a preview frame using supplied dimensions, or 16:9 when absent; contain the full figure without cropping; retain full-size theater access |

The earlier stylesheet fix remains in place: cached HTML must not become visible
before its stylesheet. The new tests reproduced the failures above with synthetic
data. That establishes causal mechanisms, not proof of the exact network/session
state during the original production report.

## Observability

`apps/app/src/visual-stability.ts` is the shared browser observer used by the app
and tests. On a build containing these changes, add `?paintDebug=1` (or
`&paintDebug=1`) to enable it. It has no visible panel and sends nothing anywhere.
Inspect or export the local report in DevTools:

```js
window.__WIKI_VISUAL_STABILITY__.report()
copy(JSON.stringify(window.__WIKI_VISUAL_STABILITY__.report(), null, 2))
window.__WIKI_VISUAL_STABILITY__.reset() // start an explicit experiment
window.__WIKI_VISUAL_STABILITY__.stop()  // detach observers and frame sampling
```

The report includes:

- Region appearances, disappearances, reappearances, empty-content transitions,
  and before/after geometry on animation frames, including CSS opacity/visibility.
- Snapshot/loading/live surface transitions and application identity, sync, and
  snapshot-dismissal events on the same `performance.now()` clock.
- Native layout-shift source regions and rectangles; CLS as the largest session
  window, using the 1-second gap and 5-second duration rules. Input-associated
  shifts are still recorded even though excluded from CLS.
- Resource completion categories and duration (identity, manifest, body, images,
  CSS, JS, fonts, WASM), font readiness, long tasks, maximum sampled frame gap,
  viewport changes, visibility changes, and user input timing.
- Explicit capability reporting: unsupported CLS is `null`, never a fabricated
  zero. Cross-browser geometry/continuity checks remain active.
- A bounded 250-event history, dropped-event count, and lifetime counters that
  survive history truncation, plus a frozen context window around the first
  incident. Test gates use counters, not only the recent ring.

The observer does not store text, HTML, slugs, URLs, cookies, request bodies, or
DOM IDs/classes. Region names and resource categories are fixed. Diagnostic
sampling is opt-in because reading layout each frame has a cost. The recorder
loads lazily when requested; buffered performance events recover earlier native
shifts, but cannot recover an earlier disappearance. Playwright installs the
same observer before any app script to cover the saved first paint too.

CLS alone is inadequate: a disappearance can score zero, and bad transitions
within 500ms of a click may be excluded. Frame sampling is also not a pixel-level
proof: it does not directly measure occlusion, glyph/font rasterization changes,
compositor-only flashes, or activity while the tab is hidden. Use a trace/filmstrip
and a visual screenshot review to resolve those cases. Scroll-caused coordinate
changes are classified separately; a viewport resize establishes a new baseline.

References: [CLS definition and session windows](https://web.dev/articles/cls),
[LayoutShift attribution and browser availability](https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift).

## Test strategy and release gates

The strategy covers each independent loading boundary and combines the riskier
pairs. An infinite cross-product of devices, network schedules, content, and
browser state is not a meaningful promise of exhaustiveness.

| Dimension | Deterministic coverage / required experiment |
| --- | --- |
| First visit | Empty browser storage, delayed body, four viewport widths: 360, 768, 1024, 1440 |
| Returning visit | Persisted body, actual saved HTML held visible with JS blocked, release to live reader |
| Refresh | Unchanged manifest, updated body, failed manifest; readable content and geometry preserved |
| Preferences | Default, narrow, collapsed, outline open with custom width; changed after snapshot capture |
| Identity | Explicit public, delayed automatic session resolution with public snapshot, session cache boundaries |
| Navigation | Warm and slow body, home and index-alias origins, browser back, lazy diagnostics shell; destination must be ready before replacing body |
| Content | Static meeting note, long wrapping title with tags, table, delayed image and downstream text anchor |
| Storage | Normal persisted profile and denied OPFS temporary fallback; existing startup/recovery suites cover stalls and retries |
| Engines | Production build in Chromium, Firefox, WebKit; unsupported native metrics do not disable geometry checks |
| Timing | Controlled network gates, 4x CPU Chromium, repeat runs with `--repeat-each` |
| Measurement controls | Injected ancestor opacity, empty body, geometry shift, restored final screen, ring overflow, reset/disconnect, privacy checks |

Additional release obligations for changes in their respective areas:

- Markdown/rendering: run image theater, table expansion, heading-anchor and
  renderer-parity tests; inspect portrait and landscape figure previews.
- Reader lifecycle: run manifest-cache, cache-retirement, session-recovery,
  access/revocation, navigation, and storage/startup suites. Visual continuity
  must not weaken authorization or make failures wait forever.
- Comments/chat/diagnostic viewers: exercise their own lazy loading, failure,
  interaction, and resource-readiness tests. Only the diagnostics navigation
  shell is covered by the new generic visual suite; decoded DICOM/canvas content
  and real comment writes require their dedicated fixtures.
- Fonts/theme/responsive changes: test delayed fonts, theme before first paint,
  zoom, orientation, scroll restoration and overlays. Current tests measure
  font readiness, but do not inject every font/theme permutation.
- Deployment/cache changes: test old assets, stale tabs, cache-version migration,
  failed imports, offline/reconnect and service-worker lifecycle with the existing
  recovery suites, then inspect a production filmstrip for the target commit.

Static loading experiments require zero disappearance/content-clear events,
zero unexpected tracked geometry changes over 1 CSS pixel, and CLS <= 0.01 where
supported. Navigation allows the intended title/body geometry change but requires
continuous readable content and stable navigation. Do not increase budgets or
enable retries merely to make a flaky test green; retain the first failure and
tie it to a lifecycle/resource event.

## Commands and automation

From `apps/app`, build once and run the dedicated synthetic suite:

```sh
bun run build
bunx playwright test --config playwright.stability.config.ts
PLAYWRIGHT_BROWSER=webkit bunx playwright test --config playwright.stability.config.ts
PLAYWRIGHT_BROWSER=firefox bunx playwright test --config playwright.stability.config.ts
VISUAL_CPU_RATE=4 bunx playwright test --config playwright.stability.config.ts
bunx playwright test --config playwright.stability.config.ts --repeat-each=3
```

Use a fresh `PLAYWRIGHT_PORT` and distinct `--output` directories for concurrent
runs. `VISUAL_SCREENSHOTS=1` retains final synthetic screenshots for manual review.
The suite attaches compact JSON histories. `.github/workflows/visual-stability.yml`
runs the production bundle on pull requests/main across the three engines plus
4x CPU Chromium, with zero retries. It uses synthetic API fixtures and requires
no production credentials. Live probes remain explicitly opt-in and outside
the public artifact workflow.

For an unexplained report: record the deployed SHA, route and approximate time
outside the redacted diagnostic JSON; identify cold/cached/session state; reproduce
with the same saved preferences; find the first disappearance or geometry event;
compare nearby identity/snapshot/resource events; hold the suspected boundary;
require a failing regression before the fix and the same test passing afterward.
Keep native scores, browser capabilities, and frame/filmstrip evidence together.

## Validation recorded on 2026-09-07

The final production bundle was built on main's `bb657454` backend changes in an
isolated worktree. All browser runs used zero retries.

| Check | Result |
| --- | --- |
| Chromium | 29 passed; 1 opt-in live test skipped |
| WebKit | 29 passed; 1 opt-in live test skipped |
| Firefox | 29 passed; 1 opt-in live test skipped |
| Chromium matrix with 4x CPU for the reader scenarios | 29 passed; 1 opt-in live test skipped |
| Existing reader, manifest, cache-retirement, scope/recovery, prefetch, navigation, image-theater, table and page-load checks | 82 scenarios passed across the related-suite run and scoped reruns; all 28 navigation/session tests rerun after the final navigation adjustment |
| Reader/cache and markdown unit tests | 69 passed |
| Production build, TypeScript, scoped ESLint, unchanged bundle budgets | Passed |
| Live production, five routes, cold and cached | 5 tests passed, covering 10 loading sequences |

The live routes were the Esserman overview, About Index, About Log, diagnosis,
and insurance. These were read-only probes of the deployment that existed before
this change was pushed, not evidence that these fixes are deployed. They recorded
zero tracked disappearances or geometry changes, with maximum native CLS about
0.00455. A clean result on those visits does not rule out an intermittent report
or the deterministically reproduced failures above.

Across the 15 static scenarios in each browser run, tracked disappearances and
geometry changes were zero. Chromium's maximum native CLS was about 0.00862;
small footer-container growth remains in the native records. WebKit and Firefox
reported native CLS as unsupported (`null`), while their geometry checks passed.
Intentional document replacement, error states, and leaving the reader for
Diagnostics are evaluated separately rather than misreported as zero events.

Passing and failing JSON reports are stored under each test's output directory.
Local evidence is under `apps/app/.playwright/stability-release-*`; CI retains its
synthetic reports for seven days. Landscape and portrait previews were also
inspected visually. Server-only redirect/archive-download contracts were excluded
from the static-preview client run; this change does not modify those handlers.
The additional obligations above remain applicable when their respective
features change; these results do not claim exhaustive pixel-level coverage of
all interactive viewers, fonts, themes, or devices.
