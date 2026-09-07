# HTML-first reader experiment — September 7, 2026

The experiment makes a first visit readable about **4–6 times sooner**, with native links available immediately. In a paired local comparison, the current home article appeared in 260–318 ms instead of 1,416–1,671 ms. The full app still took approximately 1.4–1.8 seconds to start. This improves immediate reading and navigation without pretending that SQLite and the rest of the application have become instant.

This is an opt-in local experiment, not a production release. It is on branch `codex/initial-page-performance`, based on `57fe635a8df512faf8f326099c9cc869dd4bcd11`. It includes the earlier titleless-home snapshot fix in both comparison modes. No remote content, deployment settings, or production cache policy were changed.

## Results

Medians from three fresh Chromium contexts per CPU setting and mode, with one cold browser visit and one reload in each context: 24 loads total. Desktop viewport 1440 × 1000; unthrottled network; CPU settings are normal and 4× slowdown. The server process and rendering cache were warm. All final samples used the same current home revision, `index:831515f095d851bb`.

| Visit | CPU | Normal: article available | HTML-first: article available | Normal: live article ready | HTML-first: live article ready |
|---|---|---:|---:|---:|---:|
| First visit | Normal | 1,416 ms | **318 ms** | 1,416 ms | 1,421 ms |
| Reload | Normal | 200 ms | **194 ms** | 1,178 ms | 1,124 ms |
| First visit | 4× slowdown | 1,671 ms | **260 ms** | 1,671 ms | 1,773 ms |
| Reload | 4× slowdown | **219 ms** | 281 ms | 1,458 ms | 1,509 ms |

HTML-first first contentful paint was 340 ms at normal CPU and 276 ms at 4× slowdown. The normal reader's earlier FCP of 236/232 ms painted its loading shell, so FCP alone misses the improvement. Article availability is a DOM milestone; FCP is the browser's paint milestone. The experiment does not claim that every enhanced control is ready at the article-ready milestone. A separate browser check clicked and opened the real outline while the manifest was still held.

All 24 loads had zero page errors and `Cache-Control: private, no-store`. The HTML-first samples recorded zero cumulative layout shift. Normal-reader maximum CLS was 0.0026. Current home HTML grew from 2,936 to 5,289 bytes when measured with gzip, approximately **2.3 KiB extra**. This is calculated compression size; the loopback Bun server does not simulate a production CDN's transfer compression.

The comparison uses a local production build against the live public backend, not a production deployment. The current home is shorter than the home used in the earlier investigation. Do not compare these timings directly with that earlier production table. The final A/B uses identical code, backend, and content revision; three observations per cell are directional evidence, not a production latency guarantee. Network/backend variance explains why the slow-CPU HTML-first median can be lower than its normal-CPU median. This does not measure an empty server process, a fresh edge region, a mobile radio, or an authenticated account reader.

## What changed

`WIKI_HTML_FIRST_EXPERIMENT=1` enables the server path. With the flag absent, the current reader remains the default. `?html-first=off` selects the normal reader even when the server experiment is enabled.

The server reuses the document lookup already performed for metadata, applies the existing API PII redaction, then renders an explicitly public, versioned page into the initial HTML. Restricted and unversioned documents retain the normal reader. The actual password gate runs before the shell handler. The generated HTML inherits existing private response headers; nothing becomes a public CDN cache entry.

Rendered bodies are cached in process, with a limit of eight entries and 512,000 bytes per entry. The key hashes the site, slug, and **redacted content bytes**, rather than relying on the source content hash alone. Visibility and the document are looked up before a cached rendering is reused. Redaction policy retrieval retains the API's existing 15-second configuration cache. A failed redaction/render step falls back to the normal reader.

The early article has working native anchors, a small Home/Search navigation, and an “Open interactive reader” escape link. Application JavaScript starts normally behind it. Handoff requires an actual rendered article with the matching slug and revision, independently of manifest completion. It preserves scroll position and keyboard link focus, avoids a swap during pointer interaction or text selection, and keeps the hidden app out of keyboard navigation with `inert`. A fresh server page supersedes the older persisted snapshot.

The shared markdown renderer permits richer markup than is appropriate to insert directly into an HTML document. The experiment therefore sanitizes the final rendered output with a parsed allowlist, after all transformations, using [hast-util-sanitize](https://github.com/syntax-tree/hast-util-sanitize). It also removes image button semantics until the app owns those controls. This intentionally limits early SVG/math/widget fidelity; those need broader renderer parity work before a general rollout.

## Verification

- 35 unit tests passed, including the existing app-shell gate suite, HTML sanitization, redacted-byte cache keys, PII failure fallback, opt-out behavior, exclusion of restricted content even with an authorized account session, and titleless-home snapshots.
- Browser verification with agent-browser: readable article, working links, successful handoff, no error overlay or page errors.
- JavaScript disabled: complete home article and a native link to a second server-rendered article.
- At 1440 px and 390 px: scripts held while HTML remained readable; the entire manifest held while handoff completed; article horizontal geometry within 2 px and scroll position preserved. Desktop outline opened successfully before manifest release.
- Keyboard focus transferred to the corresponding live article link. Text selection deferred handoff until selection cleared.
- A deliberately different revision retained the early article; its normal-reader escape link worked.
- Failed body API retained readable HTML and the escape link.
- WebKit completed server-to-client handoff.
- TypeScript, production build, focused ESLint, existing bundle ceilings, and whitespace checks passed. The LiveStore shell remains within its 16 KiB gzip ceiling.

Safe aggregate results are in `html-first-experiment-2026-09-07.json`. Per-load timing data and screenshots are ignored by Git under `.playwright/html-first/`. No document text or session cookies are included in the aggregate report.

## Try and reproduce

From the repository root, with a production app build present:

```sh
bun apps/app/scripts/serve-html-first-experiment.ts
```

Open `http://127.0.0.1:62009/__experiment/start`. This loopback-only harness issues a synthetic local gate session; it never sends that token to production. It disables optional prefetch mutations and backend tracing. **Do not deploy this harness.** Its convenience unlock route is separate from the application handler.

Compare `/` with `/?html-first=off`. Run all failure probes and the paired benchmark:

```sh
bun apps/app/scripts/profile-html-first.ts
```

`HTML_FIRST_CHECKS_ONLY=1` runs only the browser checks; `HTML_FIRST_PROFILE_ONLY=1` runs only the performance samples. The normal gate and HTML renderer unit tests run with:

```sh
bun test apps/app/server/app-shell.test.ts apps/app/server/html-first-experiment.test.ts apps/app/src/livestore/first-frame-snapshot.test.ts
```

## Decision

Proceed with HTML-first as the next performance direction. It removes the app startup dependency from reading the page, and the bounded experiment avoids the original prototype's 4–6-second inert-overlay problem.

Before production, add an initial page payload that the live reader can consume directly; this experiment still fetches and renders the article again during app startup. Broaden parity to long documents, math, diagrams, saved layouts, fragment navigation and rich metadata. Define reconciliation when a document changes during startup: this experiment deliberately retains the original readable revision and escape link instead of swapping to an unexpected revision. Then measure a protected preview on realistic network conditions and server cold starts. Account-only HTML requires its own access and cache design and remains outside this experiment.
