# Reader perf lab

A repeatable measurement of the reader (`apps/app`) on a fully local stack with
a synthetic 2,312-page vault. Use it to judge a change against `main` (run both,
compare the medians), and as a regression gate on three numbers.

```sh
cd apps/app
bun run perf:lab            # full run, about 11 minutes on a laptop
bun run perf:lab --quick    # 1 iteration of loads and interactions, no polling, about 3 minutes
bun run perf:lab check      # re-check the last results against budgets.json
```

Results go to `.local-stack/perf-lab/results.json` (everything, including each
sample) and `results.md` (the summary table). Change these with `--out` and
`--summary`. The header of `index.ts` lists every flag (`--only`, `--profiles`,
`--iterations`, `--interaction-iterations`, `--poll-seconds`, `--no-build`,
`--base`, `--report-only`).

## What a run does

1. `local:stack` up: local Convex and Blob, with the reader dist **rebuilt from
   your working tree** (`--build`; skip with `--no-build`). Ports come from
   `LOCAL_STACK_*_PORT`. The gzip proxy listens on `PERF_LAB_PROXY_PORT`,
   which defaults to the app port + 1.
2. The standalone server (`local:stack serve`) starts. The synthetic vault
   (`vault.ts`, seeded, byte-identical every run) is published through it,
   which **replaces the stack's fixture content**. Run `bun run local:stack`
   to get the fixture back.
3. Prefetch visit history (`pageVisitStats`) is cleared. Prefetch priorities
   come from recorded visits, so without this one run's loads would change
   what the next run prefetches.
4. A gzip proxy goes in front of the server so transfer sizes look like
   production. The standalone server sends assets uncompressed.
5. One unmeasured warm-up load, then the scenarios. Then everything the lab
   started is stopped. A local stack that was already running stays up.

## What it measures

| Group | Scenario | Numbers |
| --- | --- | --- |
| Loads | `signed-in-cold`, `signed-in-warm`: care-team user opening `wiki/treatment/treatment-note-1`. `landing-cold`, `landing-warm`: signed-out `/` | time to article (first `.wiki-markdown p` in the DOM), time to tree (first tree row in the DOM; on mobile the sidebar is a closed drawer), FCP, LCP, longest task, request count, bytes by type, and **bytes received before the article first appeared** (partial bodies included; for landing, before LCP) |
| Interactions | Signed-in desktop at 1× and 4× CPU: four folder expands, tree clicks to five ~6–11 KB pages, a tree click to the 279 KB page with 30 tables, the command palette opening, and 12 palette keystrokes | duration from the first `pointerdown`/`keydown` to the end state plus two frames, the longest task in that window, and Event Timing duration per keystroke |
| Polling | Signed-in desktop tab, visible and idle, for 120 s | manifest requests (count, per minute, how many were 304). The policy is expected to change, so this is reported and never asserted |

Profiles:

- **desktop**: 1440×900, no throttling.
- **mobile**: 390×844 at DPR 3, 4× CPU slowdown, 1.6 Mbps down, 750 Kbps up and
  150 ms RTT (CDP emulation).

A cold load uses a fresh browser context, so the HTTP cache and storage are
empty. A warm load is a second page in the same context. After each ready
signal the lab waits a fixed settle window (4 s desktop, 8 s mobile). It never
waits for `networkidle`: polling, telemetry and prefetch keep the network
busy.

**Iterations: 5 for loads, 3 for interactions.** A median of 5 still holds
when two samples are outliers, which matters most for the mobile cold load
that the gate uses. Each interaction iteration already repeats its actions
(5 small-page navigations, 4 expands, 12 keystrokes) and takes the median
inside the iteration, so 3 iterations are enough. Its spread across iterations
was under 10% on a laptop. More iterations add about 2 minutes per load
iteration and 1.5 minutes per interaction iteration.

## Reading the output

Each cell of the summary is `median <sub>min–max</sub>`. `results.json` has
every metric as `{ median, min, max, n, samples }` under a flat key:
`load.<profile>.<scenario>.<field>`, `interaction.cpu<1|4>.<field>`, or
`polling.<field>`. Compare two runs by key. `failedSamples` lists any sample
that never became ready. A failed sample makes the run exit non-zero, even
with `--report-only`.

## Budgets

`budgets.json` gates exactly three numbers:

| Metric | Why |
| --- | --- |
| `load.mobile.signed-in-cold.articleMs` | time to the article on the phone profile: the content-first boot work targets this |
| `load.mobile.signed-in-cold.bytesBeforeArticle` | what that load has to download first: the bundle split targets this |
| `interaction.cpu4.navLargeLongestTaskMs` | main-thread blocking when a large page renders on a slow CPU |

Each budget is the laptop median at the time it was set, plus headroom. That
is enough to catch a regression today. Tighten a budget (and its `baseline`)
when a fix lands. A missing value (a scenario that never became ready) fails
the check. A value whose scenario was not run (`--only`, `--profiles`) is
reported as skipped. CI runs the check report-only until CI-hardware budgets
are calibrated. See `.github/workflows/perf-lab.yml`.

## Known limits

- **The server is on loopback.** There is no real network, CDN, TLS or
  production Convex latency. Absolute numbers are optimistic, desktop numbers
  especially. Treat them as relative: this tree against `main` on the same
  machine.
- CDP network and CPU throttling apply to the page. Requests from a shared
  worker are not seen, and workers may not be CPU-throttled the same way.
- The 279 KB navigation is a first visit. Prefetch history is cleared, so the
  body is fetched over loopback during the navigation. A page the prefetcher
  has already stored renders faster.
- Headless Chromium keeps the tab `visible` (`bringToFront` on another page does
  not hide it), so hidden-tab polling is not measured.
- The care-team role does not see arbitrary `sensitive: true` pages, so no
  scenario depends on a sensitive page.
- `--base <url>` measures a server that is already running and already
  published. It does no stack set-up and does not clear visit history.
- Other load on the machine moves the numbers. On a shared laptop, compare
  runs taken close together.
