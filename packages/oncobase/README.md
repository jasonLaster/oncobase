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
- `oncobase transcription record --site <slug> --context <file>` records audio until Ctrl-C, then transcribes and drafts an enriched note with Vercel AI Gateway.
- `oncobase transcription transcribe --site <slug> --audio <file> --context <file>` transcribes an existing recording and drafts the note after the fact.

## Transcription

Transcription uses the Vercel AI Gateway by default with `openai/gpt-realtime-2`. Set `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` before running it. The recording command requires `ffmpeg`.

```sh
npx oncobase transcription record --site acme --context ./call-context.md --title "Partner call"
npx oncobase transcription transcribe --site acme --audio ./meeting.mp3 --context ./call-context.md --wiki wiki/people
```

Useful options:

- `--context <file>` adds explicit context files; repeat it or pass comma-separated paths.
- `--wiki <slug-or-path>` adds specific wiki pages from the configured vault.
- `--wiki-all` includes wiki page bodies until `--max-context-chars` is reached.
- `--model <id>` overrides the default Gateway model.
- `--output`, `--transcript-output`, and `--note-output` choose output files.

## Bundled Skills

The CLI ships two default skills:

- [`wiki-quickstart`](skills/wiki-quickstart/SKILL.md) for first-time vault setup and the initial sync/check/publish loop.
- [`check`](skills/check/SKILL.md) for safe pre-publish validation.
