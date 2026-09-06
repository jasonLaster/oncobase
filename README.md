# Oncobase

Oncobase is an open-source wiki publishing platform for research-heavy knowledge bases. It turns an Obsidian-style vault into a multi-site web wiki with search, AI-assisted reading, comments, access controls, downloadable archives, and a reusable React component/package layer.

Diana TNBC is the first production site on the platform. The repository is now organized as a monorepo so the platform pieces can be reused outside that first deployment.

## Documentation Map

- [Feature overview](docs/features.md) - the readable product inventory and best starting point for contributors.
- [Architecture](apps/wiki-vite/docs/architecture/README.md) - request flow, data model, publishing, chat, and search.
- [Implemented skills](docs/skills.md) - checked-in agent skills and the `oncobase skills` workflow.
- [Applications](apps/README.md) - the production Vite app and shared backend.
- [Packages](packages/README.md) - reusable workspace packages and public package boundaries.
- [Operations runbook](apps/wiki-vite/specs/operator-runbook.md) - publishing, previews, and production recovery notes.
- [Vite cutover QA](docs/vite-cutover-qa-2026-09-05.md) - production promotion, verification evidence, and rollback boundaries.

## Repository Layout

| Path | Purpose |
| --- | --- |
| [`apps/wiki-vite`](apps/wiki-vite/README.md) | Production app, same-origin backend, Convex schema/functions, operator tools and end-to-end tests. |
| [`packages/oncobase`](packages/oncobase/README.md) | CLI for vault init, sync, check, publish, and skill sync. |
| [`packages/wiki-content`](packages/wiki-content/README.md) | Shared content contracts, API helpers, chat tool helpers, PII utilities, and embeddings. |
| [`packages/wiki-markdown`](packages/wiki-markdown/README.md) | Shared markdown rendering, wikilinks, citations, math, Mermaid, image theater, and smart-table integration. |
| [`packages/wiki-shell`](packages/wiki-shell/README.md) | Shared wiki chrome: navigation, header, page chrome, palette, search, chat shell, right rail, and layout primitives. |
| [`packages/wiki-comments`](packages/wiki-comments/README.md) | Liveblocks-backed comments rail and thread helpers. |
| [`packages/smart-table`](packages/smart-table/README.md) | Adaptive markdown/prose table rendering and overlay expansion. |
| [`packages/chat`](packages/chat/README.md) | Configurable full-stack chat UI and Convex-backed runtime helpers. |
| [`obsidian-2`](obsidian-2/README.md) | Example/starter vault shape for published content. |
| [`api`](api/README.md) | Vercel function metadata shim for root-level API bundling. |

## Quick Start

Install dependencies from the repository root:

```sh
bun install
```

Run Diana's production frontend locally:

```sh
bun run dev:wiki-vite
```

Run the main verification commands:

```sh
bun run typecheck
bun run test:unit
bun run lint
bun run build
```

Run the Vite verification gates:

```sh
bun run verify:wiki-vite
bun run verify:wiki-vite:server
```

## Publishing A Vault

The `@oncobase/oncobase` CLI publishes Obsidian-style markdown vaults into an Oncobase site.

```sh
npx oncobase init --site acme --vault . --publish-url https://wiki.example.com/api/publish
npx oncobase sync --site acme
npx oncobase check --site acme
npx oncobase publish --site acme
```

See [packages/oncobase](packages/oncobase/README.md) and the [publishing architecture](apps/wiki-vite/docs/architecture/04-publishing.md) for the full protocol.

## License

Oncobase is released under the [MIT License](LICENSE).
