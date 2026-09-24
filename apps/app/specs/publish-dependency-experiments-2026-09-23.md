# Dependency-aware publish strategy comparison

Adopted in CLI 0.2.2 and backend commit `87580729`: a content-validated local
dependency index, capability-negotiated combined completion, immediate scheduling
after scoped finish, and incremental public-document manifest updates. Metadata
validation remains an explicit faster option. No clinical content was changed.

## Measurements

| Scenario | Control median | Adopted median | Evidence boundary |
| --- | ---: | ---: | --- |
| Real-vault mixed scan, 1 document / 7 assets | 748 ms | 411 ms | Seven rotated comparisons; output equality required |
| Same mixed scan, optional metadata validation | 748 ms | 236 ms | Faster policy trusts filesystem change indicators |
| Real-vault document-only selection, 16 documents | 474 ms | 103 ms | No asset dependencies; selected bodies read fresh |
| Synthetic one-document edit, complete publish | 7.144 s | 1.925 s | Local HTTP gateway, real isolated cloud database, three samples |
| Synthetic 100-document edit, eight workers | 11.379 s | 7.455 s | Same worker limit on both sides; three samples |
| Actual Diana local command, production no-op | 2.260 s | 1.157 s | Previous experiment versus this rollout; not an alternating control |

Production no-op samples were **1.392, 1.157 and 1.117 seconds**. The actual
`bun run wiki:publish` command used Diana's vendored 0.2.2 package, default content
cache/automatic coordination, 16 selected documents, `--assets none`, and
`--embeddings skip`. A transport guard prohibited all content/asset writes,
rejected changed plans, and allowed completion only for an owned no-op. Stored
content and actual reader-snapshot bytes were still verified. This does not
establish sub-second publishing or production content-write latency.

Final synthetic one-document samples with combined completion were 1.955, 1.925
and 1.735 seconds. The separate-step samples on the same incremental backend were
3.085, 2.580 and 2.267 seconds. Synthetic fixtures contained 7,011 remote documents
and 11,000 PDF metadata records; embeddings and uploads were excluded. These use a
local gateway, not the hosted production API, and are not interchangeable with
production wall times. Worker count was 16 for small edits and eight for the
matched bulk comparison.

## Independent strategies and decisions

The control checkout was pinned to `875c6727`. A second checkout changed only
owned-finish scheduling from a one-second delay to immediate scheduling. The
candidate checkout additionally implemented incremental manifests. The standalone scheduling variant is preserved as an
[patch against the control](publish-immediate-scheduling-experiment.patch)
(apply with `git apply --unidiff-zero` in a checkout of `875c6727`).
Client `--coordination steps|auto` separately controls the completion protocol. Cache
strategies use separate cache directories during their rotated local comparison.

- **Persistent content-validated dependencies — default.** Freshly hash source
  bytes, reuse unchanged reference/visibility metadata, and reparse changes.
  Refresh inventory and ignore rules every time. Store no bodies or credentials;
  use vault-keyed 0600 files, integrity/version checks and atomic replacement.
  Selected Markdown and asset bytes are always read fresh. Tests cover an outside
  private owner, same-size edits with restored mtime, rename, deletion, ignore
  changes, ambiguous asset names and corrupt/unwritable caches.
- **Metadata-validated dependencies — opt-in.** `--cache metadata` compares
  device, inode, size, nanosecond mtime and ctime. It saved a further 175 ms in the
  mixed scan, but trusts filesystem change indicators. Content validation is the
  default because outside-owner sensitivity affects permissions. `off` and
  `refresh` provide explicit diagnosis/recovery paths.
- **Combined completion — default when supported.** `scoped/complete`
  authenticates once, verifies the entire declared scope using at most two bounded
  state queries in flight, finishes, and checks reader readiness. Older servers
  retain the old protocol; `--coordination steps` forces it. Begin and actual
  uploads remain separate: this is fewer client round trips, not an unordered or
  atomic whole-publish transaction. Lost responses are not blindly retried.
- **Immediate scoped scheduling — adopted.** Its isolated cohort reduced the
  one-document median to 4.221 s and the 100-document median to 8.209 s at 16
  workers. Server variability means the whole observed gain cannot be attributed
  to exactly one second of delay removal. Legacy/admin writes retain coalescing.
- **Incremental manifests — adopted with narrow eligibility.** Up to 128 existing
  public pages in a document-only declared scope can replace their metadata in
  the preceding verified snapshot. Database reads scale with selected documents.
  Additions, deletion, sensitive pages, asset scopes, stale bases and corrupt or
  missing snapshots use the complete builder. The navigation tree and assets are
  reused only when their relevant membership cannot change through this path.
  An active scoped writer prevents any builder from installing its result.

Captured successful incremental builds took approximately 446–822 ms, with bounded
metadata/base reads at 148–350 ms and snapshot storage at 244–413 ms. The full
snapshot is still parsed, hashed and stored; this is not a fully partitioned
change-sized storage protocol. Current authorization and visibility checks remain
in place, and completed row writes still cannot be rolled back by aborting.

## Failures retained and resolved

The first incremental cohort rejected every base because parsing reordered object
keys, while stored snapshot hashes depend on serialized key order. It correctly
fell back to a complete rebuild, adding work without the intended gain. We now
validate the original stored representation and preserve its field order. A
regression test reproduces Convex's key ordering, and live logs confirm
`incremental: true`. Initial measurements remain in the JSON evidence.

The corrected 16-worker bulk cohort hit the isolated deployment's 4 MiB/s write
quota on its second combined run. Publication failed, drained workers and aborted;
it was not reported as success. The partial failed run and preceding samples are
retained. The final matched bulk comparison uses `--doc-concurrency 8`: all six
runs passed. Global worker defaults remain unchanged; small samples do not justify
slowing every workload. Repeated large-body bulk updates should use the lower
worker limit on that deployment. No quota-sensitive result is presented as a
universal throughput guarantee.

## Reproduction and release

Local comparisons make no network requests or vault edits, isolate their caches,
and require byte-equivalent serialized publish selections:

```sh
bun apps/app/scripts/benchmark-publish-dependencies.ts --vault /path/to/vault \
  --files-from /tmp/reviewed-files.json --assets referenced --repeat 7 \
  --output /tmp/new-dependency-comparison.json
```

Repeat with `--assets none` and a document-only scope. The existing read-only
`benchmark-local-publish.ts` accepts `--cache content|metadata|off|refresh`; it
continues to prohibit locks, writes and finish, so it cannot measure completed
publication. Remote completion experiments must use an isolated synthetic site
or an enforced no-op transport guard. All samples, phases, failures and caveats
are in [the machine-readable evidence](publish-dependency-experiments-2026-09-23.json).

Production Convex (`youthful-cricket-560`) and the API were deployed from the
isolated release branch. The final API deployment is
`dpl_7ZAL3awNBMC3nhkbDm3pg9TZ5DNj` from `ae9e0dd9`, including the linear scope
lookup hardening. Its guarded production no-op smoke passed; the additional
sample is retained in the JSON release evidence. The isolated development backend was restored to
the adopted candidate after control comparisons. Diana's project-local dependency
is a reviewed vendored 0.2.2 tarball; installation with the frozen lockfile passed.
Public npm publication remains pending authentication. Changes remain in PR #64;
CI configuration and clinical content are unchanged.

Validation: 391 app unit tests and 40 CLI unit tests, app/CLI typechecking, CLI
build, frozen installs and targeted lint passed. React Doctor identified a
quadratic membership checks, changed to Sets, and intentional sequential loops
for bounded metadata reads and independent benchmark repetitions. These preserve
database pressure limits and experimental isolation; this is not represented as
a warning-free Doctor run.
