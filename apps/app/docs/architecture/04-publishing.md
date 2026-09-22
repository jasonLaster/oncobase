# 4. Publishing

Authors publish a configured vault with `oncobase publish`. Application deployment and content publication are separate operations.

## Content publication

The CLI in `packages/oncobase` plans the vault's markdown and assets, compares content hashes with the remote manifest, and sends the reviewed changes through the same-origin `/api/publish/*` protocol in `server/publish-api.ts`.

The server validates the site and publish token, acquires the site publish lock, applies site-specific redaction, updates Convex content and asset metadata, and finishes or fails the publish transaction. Blob object keys remain scoped under `sites/<siteSlug>/`. Hash matches avoid unnecessary writes; removed paths must be reviewed before tombstoning.

The finish response retains `postPublishRunId: null` for client compatibility. It does not start a background workflow. Readers synchronize the current manifest through their existing cache-validation path.

## Routine local publishing (CLI 0.2.0)

Use the matching CLI/backend release for narrow edits instead of temporary
publishers that scan full manifests and page through every document to verify a
handful of changes. Keep a reviewed JSON path list outside the vault and preserve
the same scope and asset policy between planning and execution:

```sh
npx @oncobase/oncobase@0.2.0 publish --site <slug> --vault /path/to/release-worktree --files-from /tmp/release.json --assets referenced --dry-run
npx @oncobase/oncobase@0.2.0 publish --site <slug> --vault /path/to/release-worktree --files-from /tmp/release.json --assets referenced
```

The version pin prevents an older CLI from silently ignoring the new arguments.
`--assets none` skips attachment work for known document-only edits; use
`referenced` when links or visibility change. Embedding, verification, worker
concurrency, and timeout policies are explicit CLI choices. Profiles are saved
automatically. The source tree contains repeatable read-only benchmarks; those
timings do not include writes or prove end-to-end completion.

Scoped runs use separate `/scoped/begin`, `/scoped/finish`, and `/scoped/abort`
endpoints, preventing unsafe fallback to an older server's unowned lock API.
Every database write checks the run's owner, lease and declared scope. Omitted
rows cannot become tombstones. Workers avoid updating shared manifest state on
every write; finish or abort invalidate it once, with expiry recovery for crashes.

`/state` performs bounded indexed reads and computes digests from stored raw
content, checks the redacted reader copy, and verifies asset metadata. Uploaded
asset bytes are read back before registration under content-based object paths.
After commit, `/status` verifies current reader snapshot bytes and selected
public inclusions/sensitive exclusions. The CLI reports a committed-but-unconfirmed
failure if that check does not complete. A browser rendering check remains a
separate release verification step.

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
