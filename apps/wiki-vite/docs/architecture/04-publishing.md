# 4. Publishing

Authors publish a configured vault with `oncobase publish`. Application deployment and content publication are separate operations.

## Content publication

The CLI in `packages/oncobase` plans the vault's markdown and assets, compares content hashes with the remote manifest, and sends the reviewed changes through the same-origin `/api/publish/*` protocol in `server/publish-api.ts`.

The server validates the site and publish token, acquires the site publish lock, applies site-specific redaction, updates Convex content and asset metadata, and finishes or fails the publish transaction. Blob object keys remain scoped under `sites/<siteSlug>/`. Hash matches avoid unnecessary writes; removed paths must be reviewed before tombstoning.

The finish response retains `postPublishRunId: null` for client compatibility. It does not start a background workflow. Readers synchronize the current manifest through their existing cache-validation path.

## Application deployment

Root `vercel.json` invokes `scripts/build-vercel.ts`. Production deploys the shared Convex functions from this app, builds the publisher CLI types needed by operator tools, then builds Vite and its API functions. Preview builds do not deploy Convex.

There is no `/api/post-deploy` workflow endpoint. The former Vite placeholders only logged completion and have been deleted. Scoped download archives are assembled by `/api/download` for each authorized request. Description and embedding maintenance is available through explicit operator scripts; it is not implied by a successful frontend deploy or publish response.

## Operator tools

Retained tools live in `scripts/admin` and `scripts/publish`:

- Site creation, publish-token management, archive/restore, and stuck-lock recovery.
- Account password reset using the same hashing implementation as the live API.
- Hash and site-ID backfills, with their explicit targeting and confirmation requirements.
- Vault bootstrapping, file/DICOM uploads, descriptions, embeddings, and diagnostic seed maintenance.

Use the app's `wiki:*` scripts for the named commands. Backend deployment and source movement do not authorize publishing a vault, bulk backfilling data, or deleting clinical records.

Continue to [Chat and search](05-chat-and-search.md).
