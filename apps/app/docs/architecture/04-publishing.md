# 4. Publishing

Authors publish a configured vault with `oncobase publish`. Application deployment and content publication are separate operations.

## Content publication

The CLI in `packages/oncobase` plans the vault's markdown and assets, compares content hashes with the remote manifest, and sends the reviewed changes through the same-origin `/api/publish/*` protocol in `server/publish-api.ts`.

The server validates the site and publish token, acquires the site publish lock, applies site-specific redaction, updates Convex content and asset metadata, and finishes or fails the publish transaction. Blob object keys remain scoped under `sites/<siteSlug>/`. Hash matches avoid unnecessary writes; removed paths must be reviewed before tombstoning.

The finish response retains `postPublishRunId: null` for client compatibility. It does not start the removed post-publish workflow. Changed scoped runs queue a manifest snapshot rebuild; unchanged runs reuse a current verified snapshot. Readers synchronize the current manifest through their existing cache-validation path.

## Routine local publishing (CLI 0.2.1)

Use the matching CLI/backend release for narrow edits instead of temporary
publishers that scan full manifests and page through every document to verify a
handful of changes. Keep a reviewed JSON path list outside the vault and preserve
the same scope and asset policy between planning and execution:

```sh
oncobase publish --site <slug> --vault /path/to/release-worktree --files-from /tmp/release.json --assets referenced --dry-run
oncobase publish --site <slug> --vault /path/to/release-worktree --files-from /tmp/release.json --assets referenced
```

Use a pinned project-local CLI dependency and confirm its version in the same command context. Diana currently uses a reviewed vendored 0.2.1 tarball while the public npm release awaits authentication. A newer global CLI does not upgrade a vault-local dependency.
`--assets none` skips attachment work for known document-only edits; use
`referenced` when links or visibility change. Embedding, verification, worker
concurrency, and timeout policies are explicit CLI choices. Profiles are saved
automatically. The source tree contains repeatable read-only benchmarks; those
timings do not include writes or prove end-to-end completion.

Scoped runs use separate `/scoped/begin`, `/scoped/finish`, and `/scoped/abort`
endpoints, preventing unsafe fallback to an older server's unowned lock API.
Every database write checks the run's owner, lease and declared scope. Omitted
rows cannot become tombstones. Workers avoid updating shared manifest state on
every write. The first actual manifest-affecting mutation marks the owned run changed in the same transaction; subsequent workers only read that flag. Finish or abort invalidates once when changes occurred, with expiry recovery for crashes. Missing change-tracking state from older runs is treated conservatively as changed. A no-op retains the revision and snapshot, but still acquires its lock and verifies remote content and reader readiness. Missing, stale, wrong-format or missing-blob snapshots queue a repair even on no-op finish.

`/state` performs bounded indexed reads and computes digests from stored raw
content, checks the redacted reader copy, and verifies asset metadata. Uploaded
asset bytes are read back before registration under content-based object paths.
After commit, `/status` verifies current reader snapshot bytes and selected
public inclusions/sensitive exclusions. The CLI reports a committed-but-unconfirmed
failure if that check does not complete. A browser rendering check remains a
separate release verification step.

## Automatic local scan reuse

A publish invocation inventories and parses the vault once, sharing that snapshot
between document selection and asset ownership resolution. All owners, including
those outside a selected scope, contribute sensitivity and visibility. The next
invocation scans again, so edits, deletions and changed ignore rules are observed.
No disk cache, timestamp shortcuts or additional flags are involved. Profiles
include `parsedDocuments` and `reusedDocuments` counts. Selected asset bytes are
still hashed and uploads are still checked against their planned hash.

Compare the old separate scans with shared parsing without any network calls:

```sh
bun apps/app/scripts/benchmark-publish-scan.ts --vault /path/to/vault \
  --files-from /tmp/reviewed-files.json --repeat 7 --output /tmp/new-scan-results.json
```

The benchmark alternates order and requires identical document/asset output for
each pair. OS filesystem cache state is uncontrolled; it does not claim cold-disk
timings. See `specs/publish-cache-experiments-2026-09-23.md` for measured results.

## Application deployment

Root `vercel.json` invokes `scripts/build-vercel.ts`. Production deploys the shared Convex functions from this app, builds the publisher CLI types needed by operator tools, then builds Vite and its API functions. Preview builds do not deploy Convex.

There is no `/api/post-deploy` workflow endpoint. The former Vite placeholders only logged completion and have been deleted. Scoped download archives are assembled by `/api/download` for each authorized request. Embedding maintenance is available through an explicit operator script; it is not implied by a successful frontend deploy or publish response. Existing stored descriptions are retained. The old local-vault description and zip generators were removed because their vault source no longer exists in this repository.

## Operator tools

Retained tools live in `scripts/admin` and `scripts/publish`:

- Site creation, publish-token management, archive/restore, and stuck-lock recovery.
- Account password reset using the same hashing implementation as the live API.
- Hash and site-ID backfills, with their explicit targeting and confirmation requirements.
- Vault bootstrapping, file/DICOM uploads, embeddings, and diagnostic seed maintenance.

Use the app's `wiki:*` scripts for the named commands. Backend deployment and source movement do not authorize publishing a vault, bulk backfilling data, or deleting clinical records.

Continue to [Chat and search](05-chat-and-search.md).
