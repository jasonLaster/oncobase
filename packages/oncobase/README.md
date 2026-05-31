# `@oncobase/oncobase`

Official Oncobase CLI for syncing, checking, and publishing Obsidian vaults.

```sh
npm install --save-dev @oncobase/oncobase
```

Configure a vault once:

```sh
npx oncobase init --site acme --vault . --publish-url https://wiki.example.com/api/publish
```

Then run the publish workflow from the vault:

```sh
npx oncobase sync --site acme
npx oncobase check --site acme
npx oncobase publish --site acme
```

The publish token can be provided with `WIKI_PUBLISH_TOKEN_<SITE>`, `WIKI_PUBLISH_TOKEN`, or `~/.config/wiki/<site>.token`.

## Commands

- `oncobase init --site <slug> --vault <path> --publish-url <url>` writes local site configuration.
- `oncobase sync --site <slug>` reconciles remote documents/assets into the vault and writes review artifacts for conflicts.
- `oncobase check --site <slug>` runs a dry-run publish and reports changed, unchanged, and stale records.
- `oncobase publish --site <slug>` uploads changed content, assets, embeddings, and confirmed tombstones.
- `oncobase skills --site <slug>` copies bundled vault skills into `<vault>/.claude/skills`.
- `oncobase assets:backfill-hashes --site <slug>` backfills asset hashes without a full content upload.

## Bundled Skills

The CLI ships two default skills:

- [`wiki-quickstart`](skills/wiki-quickstart/SKILL.md) for first-time vault setup and the initial sync/check/publish loop.
- [`check`](skills/check/SKILL.md) for safe pre-publish validation.
