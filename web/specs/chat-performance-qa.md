# Chat Performance — Measured QA Results

Per-phase measurement log for the chat performance plan ([chat-performance.md](./chat-performance.md), [chat-performance-plan.md](./chat-performance-plan.md), [chat-performance-testing.md](./chat-performance-testing.md)).

This is a **living document**. Each phase appends a row with the metrics captured by `bun playwright test e2e/chat-perf.spec.ts` and `bun scripts/chat-bench.ts --baseline`.

## How to capture

Local (against `bun dev`):

```sh
# 1. Server-side bench (TTFB + bytes/sec on /api/chat)
bun scripts/chat-bench.ts --baseline

# 2. Browser perf scenarios (writes web/e2e/.perf/P0-*.json)
bun playwright test e2e/chat-perf.spec.ts --project=tests
```

CI: `e2e/chat-perf.spec.ts` runs with `web/e2e/.perf/baseline.json` as the gate. Failures land in `web/e2e/__diff_output__/`.

## Phase 0 baseline

Status: **awaiting first run.** The instrumentation infrastructure landed in this phase (`web/src/lib/chat/perf.ts`, `web/scripts/chat-bench.ts`, `web/e2e/chat-perf.spec.ts`). Numbers below are filled in by the next person to run the suite against a live env.

| Scenario | TTFB (ms) | Tokens/s | FPS (steady) | Commits/s | Recovery (ms) | Captured at |
| -------- | --------- | -------- | ------------ | --------- | ------------- | ----------- |
| P0-A empty thread, short answer        | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-B empty thread, tool-heavy          | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-C 50-message follow-up              | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-D 200-message follow-up             | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-E slow 3G                           | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-F refresh mid-stream                | TBD | n/a | n/a | n/a | TBD  | TBD |
| P0-G abort + resend                    | TBD | n/a | n/a | n/a | n/a  | TBD |

Once captured, paste the JSON dumps from `web/e2e/.perf/` here and update the Phase 0 row in the table.

## Per-phase results

Each phase appends the same scenario rows after running the suite. Format matches the table above. Diff vs baseline is computed by `bun scripts/chat-bench.ts --compare`.

### Phase 1 — server cadence

Pending.

### Phase 2 — native parts in Convex

Pending.

### Phase 3 — useChat over SSE

Pending.

### Phase 4 — memoized message tree

Pending.

### Phase 5 — Streamdown

Pending.

### Phase 6 — ai-elements

Pending.

### Phase 7 — server caching + idempotency

Pending.

### Phase 8 — hardening + polish

Pending.

## Notes / gotchas worth remembering between phases

(empty until something surprises us)
