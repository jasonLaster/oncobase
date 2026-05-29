---
name: check
description: Use when validating an Oncobase vault or publish before release, including local hygiene, changed content, assets, tombstones, and publish readiness.
---

# Oncobase Check

Use this skill when a user asks whether a vault is ready to publish or asks for a safe validation pass before release.

## Default Flow

1. Inspect the vault status and note any unrelated dirty files.
2. Run the Oncobase dry-run publish check.
3. Review changed documents, changed assets, stale remote records, and hash-version notices.
4. Call out any tombstones, large asset batches, missing publish tokens, or dirty-tree blockers.

## Commands

```sh
git status --short
npx oncobase check --site <slug>
```

When the user explicitly accepts a dirty vault:

```sh
npx oncobase check --site <slug> --allow-dirty
```

## What To Report

- changed document count
- changed asset count
- stale documents/assets that would be tombstoned on publish
- missing token or publish URL errors
- any protocol-version error that requires updating `@oncobase/oncobase`

## Escalate Before Publish

Pause and ask before publishing if:

- many assets would upload unexpectedly
- many remote pages would be tombstoned
- the vault is dirty and the user did not approve `--allow-dirty`
- the publish protocol asks for an explicit confirmation flag

## Documentation

- CLI docs: `packages/oncobase/README.md`
- Publishing architecture: `apps/web/docs/architecture/04-publishing.md`
