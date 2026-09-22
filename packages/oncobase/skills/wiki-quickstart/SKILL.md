---
name: wiki-quickstart
description: Use when setting up or orienting inside an Oncobase vault, including vault structure, publish configuration, and the first sync/check/publish loop.
---

# Oncobase Wiki Quickstart

Use this skill when a user is setting up a vault, moving around an unfamiliar Oncobase vault, or asking how to publish content for the first time.

## Start Here

1. Find the vault root and confirm it contains markdown content.
2. Check for `.wiki-site.json` or the configured site file in `~/.config/wiki`.
3. Confirm the site slug and publish URL before running publish commands.
4. Prefer dry-run checks before publishing content.

## Standard Commands

```sh
npx oncobase init --site <slug> --vault . --publish-url https://<host>/api/publish
npx oncobase sync --site <slug>
npx oncobase check --site <slug>
npx oncobase publish --site <slug>
```

## Routine edits after setup

With a CLI/backend supporting scoped publishing (after npm version 0.1.4), use a
reviewed JSON list such as `["wiki/home.md"]` outside the vault. Carry identical
scope and policy arguments from the dry-run to the publish:

```sh
npx @oncobase/oncobase@0.2.0 publish --site <slug> --files-from /tmp/release.json --assets referenced --dry-run
npx @oncobase/oncobase@0.2.0 publish --site <slug> --files-from /tmp/release.json --assets referenced
```

Prefer `--assets none` for edits known to change only Markdown. Scoped publishing
skips implicit sync and does not infer tombstones. Add `--sync-first` for an
intentional pull before a real publish. `--embeddings skip` trades fresher search
vectors for lower latency; it does not queue work. Timing profiles are automatic.
Inspect the printed effective policy and any skipped-embedding notice.

## Vault Shape

Oncobase expects ordinary markdown and assets. Common directories are:

- `about/` for site entry points and evergreen context
- `wiki/` for authored knowledge pages
- `sources/` for source documents and supporting evidence

Keep generated editor state, dependency folders, and review artifacts out of published content.

## Publishing Safety

- Run `oncobase check` before `oncobase publish`.
- Keep the vault working tree clean unless the user explicitly accepts `--allow-dirty`.
- Use `--dry-run` for risky publish changes.
- Use `--confirm-tombstone` only when removed remote pages/assets are expected.
- Use `--sync-first` when remote edits may have landed since the last local sync.

## Documentation

- Oncobase repo docs: `README.md`
- CLI docs: `packages/oncobase/README.md`
- Feature overview: `docs/features.md`
