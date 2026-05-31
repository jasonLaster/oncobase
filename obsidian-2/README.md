# Wiki Vault

This directory is the source vault for your wiki. Open it in Obsidian
to read and edit locally. The hosted web app is optional; publishing
copies this content to the web.

## Local workflow

1. Edit markdown in `index.md`, `wiki/`, `sources/`, and `about/`.
2. Preview and navigate in Obsidian.
3. Commit changes with Git if you want history.

## Publish workflow

If a platform operator gave you a site slug, publish URL, and publish
token:

```sh
bun install
bun run wiki:init --site <slug> --publish-url https://<slug>.example.com/api/publish

mkdir -p ~/.config/wiki
printf '%s\n' '<wpt_ token>' > ~/.config/wiki/<slug>.token
chmod 600 ~/.config/wiki/<slug>.token

bun run wiki:check --site <slug>
bun run wiki:publish --site <slug>
```

The publisher excludes `.obsidian/`, `.claude/`, `node_modules/`, and
other local-only folders automatically.

## Sync

```sh
bun run wiki:sync --site <slug>
```

Sync only fills missing files. Divergent remote copies are placed under
`.wiki-sync-review/` for manual review so redacted web content never
overwrites local source notes.
