# Reader and publisher observability

The production Vite application explicitly initializes `@vercel/otel` inside its Node API and HTML functions. This is native Vercel tracing, not an OTLP exporter pointed at an absent localhost collector. Vercel's request context supplies the infrastructure parent and flushes spans after the response. Local development keeps the existing opt-in OTLP exporter.

## Coverage and correlation

| Source | What is recorded | Join key |
| --- | --- | --- |
| Browser | Identity, storage, LiveStore boot/handoff, first ready render, sync transitions, session/manifest/page fetch-to-headers durations, provisional/304 flags, summed server RPC time | Random per-page `traceId` / `oncobase.client.trace_id` |
| API | Fixed route, HTTP status, Convex RPC spans, existing publisher phases, manifest fallback phases, snapshot hit, readiness reason, revision, queue age, active writer, mismatch counts | Native Vercel request trace; browser/CLI ID retained as `clientTraceId` |
| Scheduled Convex builder | Queue delay, build duration, incremental/full mode, phase durations, install outcome, failure stage | Finish API's native trace ID propagated as `clientTraceId`; revision and queue timestamp |

Browser and Convex measurements are relayed through small Vercel API requests. Vercel request-trace retrieval omitted historical spans preceding the receiving request in a live test, even though the SDK exported them. Therefore remote measurements appear as `observation.reader.*` and `observation.manifest.*` receipt-time spans, with the real start timestamp and duration in `measurement.start_unix_ms` and `measurement.duration_ms`, and in the JSON logs. The native span duration is relay processing, **not browser/build latency**. Their parent in Vercel is the **relay request**, not a fabricated continuous browser-to-job trace. Search the shared correlation ID to assemble the trajectory. Client clocks can differ from the server: compare local durations; do not infer network latency by subtracting timestamps from different machines.

Backend summaries (`oncobase.backend`), browser batches (`oncobase.reader`), and builder summaries (`oncobase.manifest`) are also written to Vercel runtime logs. These remain useful independently of native trace sampling. Native spans and log summaries have different retention policies.

## Querying

Use Vercel CLI 60 or newer. The older globally installed CLI does not have `traces`.

```sh
bunx vercel@60.0.1 traces config ls
bunx vercel@60.0.1 curl --trace /api/wiki/session --deployment <deployment-url>
bunx vercel@60.0.1 traces get <request-id> --json
bunx vercel@60.0.1 traces get <request-id> --open --view=waterfall

vercel logs --environment production --no-branch --no-follow \
  --since <ISO-start> --until <ISO-end> --query oncobase.reader --limit 50 --json
vercel logs --environment production --no-branch --no-follow \
  --since <ISO-start> --until <ISO-end> --query <client-trace-id> --limit 50 --json
```

`curl --trace` creates its own response-header capture; do not override it with `--dump-header`. API responses include `X-Oncobase-Trace-Id`. The request ID for `traces get` is Vercel's request ID, **not** the OTel trace ID. Use runtime logs or the tracing curl command to get it.

The dashboard's Logs view supports text search for the event names and IDs above. Select a request's Trace to view native spans. For historical summaries, export bounded log windows before retention expires; do not treat a 50-row query as an exhaustive population.

## Configuration

- On Vercel, instrumentation is on unless `WIKI_BACKEND_TRACING=0`. The kill switch stops custom backend/browser telemetry. Native platform sampling is managed separately.
- `WIKI_TELEMETRY_ORIGIN=https://diana-tnbc.com` in the production Convex environment sends sanitized builder events to `/api/telemetry/manifest` using the existing shared `WIKI_PREFETCH_SECRET`. No credentials enter the payload or logs. This is a service-authenticated endpoint.
- Vercel sampling rules should cover `/api/publish/`, `/api/wiki/`, and `/api/telemetry/` at 100% for this low-volume diagnostic workload; HTML can be sampled at 10%. First matching rule wins. Save/read back rules and measure actual usage. CLI 60.0.1 created rules without `destination: "internal"`, which its own `config ls` then omitted. We patched the project tracing object via the documented project API, preserving its other fields, and verified all four rules read back. Do not trust the `config set` success message alone.
- The Vercel SDK's default fetch instrumentation is disabled. A sampler only accepts spans explicitly marked by our instrumentation. A processor removes SDK-added referrer, user agent, host, and matched-path attributes from our spans. Application telemetry does not include page names, paths, queries, content, identities, credentials, raw errors, or storage URLs. Vercel's own infrastructure logs/spans follow Vercel's separate metadata policy.

## Bounds and failure behavior

Browser payloads are allowlisted, limited to 16 KiB and 32 spans/batch, with a 256-span budget per page load. Startup marks stop after five minutes. Uploads flush after two seconds or on page hide; they have a two-second timeout and no retries. Anonymous browser events are untrusted measurements. The collector requires same-origin JSON and has a per-instance token bucket (120-batch burst, two batches/second); this is not a distributed abuse limit.

Builder export happens after install/failure handling and adds at most two seconds to action tail time, not manifest readiness. Failed delivery emits a fixed warning in Convex; there is no durable retry queue. Phase totals can overlap and are stored as attributes, not invented sequential spans. Existing queued jobs without new fields remain compatible.

## Retention and remaining limits

Vercel's September 2026 documentation specifies **one day** of native always-on trace retention on Pro. Observability Plus provides **30 days of runtime logs** and dashboard Query, billed by event usage; it does not document 30-day native trace retention. An external drain exports out of Vercel and is not required for native ingestion.

Sources: [Always-on tracing](https://vercel.com/docs/tracing/always-on-tracing), [Observability Plus](https://vercel.com/docs/observability/observability-plus), [Instrumentation](https://vercel.com/docs/tracing/instrumentation).

Known gaps: CLI phase profiles are still saved locally, although their requests correlate to backend logs. Process death/offline browsers can lose their last batch. Cross-origin API clients deliberately do not receive a tracing header. Coalesced builds may have been scheduled before the finish request and lack its correlation ID. Reader-ready means the first fresh body has committed and reached the next animation frame; it does not measure image completion or full visual stability. Browser fetch spans end at response headers; parsing and rendering must be read alongside sync/ready marks. None of these partial measurements should be reported as complete end-to-end latency.

## Experiment gate

Before optimizing, verify native API spans and an actual browser batch can be retrieved from Vercel, and verify a real scheduled builder event reaches the relay. Then compare cold/warm browser startup, current/stale snapshots, small document-only changes, asset changes, and overlapping writers. Preserve the full publish attempt/retry/reader-ready trajectory and stratify failures; do not average only successful commands.

## Verification record (2026-09-25)

- Preview native backend request: `z49zj-1790353530087-dfd3af7b5144`; `wiki /api/wiki/session` retrieved through `vercel traces get`.
- Preview native browser observation: `chmfw-1790353944723-6a286c81fda6`; `observation.reader.request-manifest` retained the synthetic measured duration of 123 ms. This is collector verification, not a reader performance benchmark.
- Production sampling configuration read back successfully: publish/wiki/telemetry 100%, remaining production requests 10%.
- 397 unit tests passed before the added immutable-redirect regression test; that regression and the focused tracing tests also passed. Typecheck, lint (existing warnings), build, and bundle budgets passed. The HTML entry imports 143.9 KiB against its 200 KiB limit; native SDK initialization is measured explicitly in `telemetry.init_ms`.
