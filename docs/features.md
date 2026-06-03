# Oncobase Feature Overview

This page is the public, reader-first inventory of the Oncobase platform. It links to the deeper app specs where the implementation contract matters.

## Platform Summary

Oncobase publishes an Obsidian-style markdown vault as a hosted, searchable, collaborative wiki. It combines:

- a multi-site publishing backend in the [Next.js app](../apps/web/README.md)
- a standalone [Vite + LiveStore reader](../apps/wiki-vite/README.md)
- an `oncobase` CLI for vault sync, checks, publishing, and skill sync
- reusable packages for [content](../packages/wiki-content/README.md), [markdown](../packages/wiki-markdown/README.md), [wiki shell UI](../packages/wiki-shell/README.md), [comments](../packages/wiki-comments/README.md), [chat](../packages/chat/README.md), and [smart tables](../packages/smart-table/README.md)

Diana TNBC is the first production site and remains the default operational example in some app-level docs. The platform model is site-scoped and reusable; see the [multi-site contract](../apps/web/specs/multi-site.md).

## Content Publishing

Oncobase treats the vault as the authoring source and Convex plus Blob storage as the serving source.

- `oncobase init` writes site configuration for a vault.
- `oncobase sync` reconciles remote content back into the vault and writes review artifacts for conflicts.
- `oncobase check` performs a dry-run publish against the server protocol.
- `oncobase publish` uploads changed markdown documents, assets, embeddings, and tombstones stale records when confirmed.
- `oncobase assets:backfill-hashes` repairs missing asset content hashes without requiring a full republish.

The publish protocol is documented in [architecture: publishing](../apps/web/docs/architecture/04-publishing.md), and the CLI behavior is documented in [`@oncobase/oncobase`](../packages/oncobase/README.md).

## Multi-Site Hosting

The production app hosts multiple sites in one deployment. Each request resolves a site slug from the host, preview hostname, local fixture, or configured fallback. Downstream document, search, comments, chat, and asset reads are scoped to that site.

Core invariants:

- the proxy overwrites incoming site headers
- Convex access goes through site-aware helpers
- Blob keys are site-prefixed
- comments require per-site Liveblocks credentials unless a migration fallback applies
- public and session content are cached separately

Read the full [multi-site spec](../apps/web/specs/multi-site.md) and [data model overview](../apps/web/docs/architecture/03-data-model.md).

## Wiki Browsing

The wiki surface supports the common reading loop for dense research notes:

- `/` renders the vault index page
- `/:slug` renders markdown and MDX-like wiki pages
- PDF and markdown URL variants redirect to the canonical route
- sidebar navigation follows the file tree
- mobile navigation uses a bottom-sheet file tree
- active directories expand automatically
- PDF entries route through `/api/file`
- tags render as linked pills
- source links, copy actions, breadcrumbs, page footer, and not-found states come from shared page chrome

The reusable chrome lives in [`@oncobase/wiki-shell`](../packages/wiki-shell/README.md). The current app feature inventory lives in [apps/web/specs/features.md](../apps/web/specs/features.md).

## Markdown Rendering

Oncobase markdown supports both server-rendered pages and client-rendered/streamed contexts.

Features include:

- GitHub-flavored markdown
- heading IDs and route-aware anchor links
- Obsidian wikilinks, including aliases
- relative markdown link cleanup
- PDF link chips and file proxying
- citation preprocessing
- KaTeX math
- Mermaid fallback rendering and lazy client rendering
- image theater support
- marked image-list slides viewer for compact step-through image sets
- PII redaction before display, search, chat, copy, and downloads
- smart-table enhancement for wide or dense tables

The shared runtime is [`@oncobase/wiki-markdown`](../packages/wiki-markdown/README.md). PII behavior is specified in [PII redaction](../apps/web/specs/pii-redaction.md).

## Smart Tables

Research vaults tend to contain wide, prose-heavy tables. Oncobase ships a dedicated smart-table layer rather than relying on basic overflow wrappers.

Smart-table behavior includes:

- first-paint horizontal overflow wrappers
- content-aware column sizing
- manual header-cell resize handles
- optional overlay expansion on larger screens
- persistence keys for manual widths
- right-edge overflow fade
- host-provided layout adapters for sidebars and right rails
- shared CSS variables so host apps do not need Tailwind scanning for package source

See [`@oncobase/smart-table`](../packages/smart-table/README.md) and the detailed [table expansion spec](../apps/web/specs/table-expansion.md).

## Search

The platform has both text and AI search surfaces.

Text search:

- searches markdown content
- groups results by page
- shows line numbers and highlighted snippets
- handles loading, empty, no-result, and error states

AI search:

- combines lexical candidates with vector search
- ranks and summarizes candidate pages
- falls back to vector discovery when text search finds no candidates
- respects site scope and access/sensitivity rules

The architecture is covered in [chat and search](../apps/web/docs/architecture/05-chat-and-search.md). Shared search chrome lives in [`@oncobase/wiki-shell`](../packages/wiki-shell/README.md).

## Chat With The Wiki

Oncobase includes a configurable AI chat experience backed by the AI SDK and Convex persistence.

User-facing behavior includes:

- new conversation and conversation permalink routes
- archived conversation management
- conversation list in desktop and mobile navigation
- starter prompts
- streaming responses
- stop generation
- stale-stream cleanup and resume behavior
- reasoning/tool-call display
- source pills extracted from tool results
- copy-as-markdown and copy-link actions

The wiki chat tools can search pages, read pages, list pages, list tags, and fetch pages by tag. The shared chat route helpers generate medical/research-friendly search patterns, compact large tool results before persistence, and keep citation rules consistent between apps.

Read [`@oncobase/chat`](../packages/chat/README.md), the [chat package spec](../apps/web/specs/chat-package.md), and the [chat pattern library](../apps/web/specs/chat-patterns/00-overview.md).

## Comments And Review

The current production comments system is Liveblocks-backed.

It supports:

- page-level comments
- selection-anchored comments
- per-document comment and outline rail
- global comments timeline
- authenticated and guest identities
- comment text extraction for copy/review surfaces
- per-site enablement and credential checks

The reusable package is [`@oncobase/wiki-comments`](../packages/wiki-comments/README.md). The product contract is in [comments.md](../apps/web/specs/comments.md).

## Access, Auth, And Identity

Oncobase uses two layers:

- a site password gate for broad access to a site
- optional account auth for identity, comments, admin, and role-based permissions

Role-based access is site-scoped and can combine path-prefix and tag filters. Public pages render before RBAC is consulted; protected pages return 404 unless the signed-in user has a matching role. Sensitive content handling remains separate from role restrictions so public educational material is not over-classified.

Read [role-based access](../apps/web/specs/role-based-access.md), [PII redaction](../apps/web/specs/pii-redaction.md), and the [implemented access-control skill](skills.md#diana-web-access-control).

## Downloads, Files, And Sharing

Oncobase exposes both individual assets and generated archives.

- `/api/file` serves supported PDFs, images, CSVs, and other configured assets.
- file serving rejects unsupported extensions and path traversal attempts.
- `/api/download?type=full` serves a full archive.
- `/api/download?type=markdown` serves a markdown-only archive.
- deployment workflows can prebuild and cache download archives.
- page markdown, chat markdown, chat URLs, and comment text can be copied from the UI.

See the [operator runbook](../apps/web/specs/operator-runbook.md) for production cache and recovery procedures.

## Vite + LiveStore Reader

The Vite reader is the standalone replacement path for the current Next reader surface. It consumes the same wiki APIs, stores public/session snapshots in LiveStore, and keeps offline-friendly local read state.

Implemented reader features include:

- public/session scope separation
- manifest-driven file tree, page index, and asset index
- current-route-first page fetches
- stale/missing/deleted content reconciliation
- standalone Bun server for Vercel function parity
- migrated Playwright coverage for reader-capable flows
- bundle-budget checks for entry, markdown, LiveStore, Effect, workers, and SQLite wasm chunks

Read [apps/wiki-vite](../apps/wiki-vite/README.md) and the [Vite reader plan](../plans/vite-livestore-wiki-reader.md).

## Operational Features

Operators have scripts and workflows for:

- site creation, archive, restore, and lock clearing
- publish-token management
- password reset for account auth
- site-id backfills
- content hash backfills
- post-deploy workflows for archives, descriptions, and embeddings
- preview and production smoke tests
- Vite reader static/unit/server/e2e checks

Start with [apps/web](../apps/web/README.md), the [operator runbook](../apps/web/specs/operator-runbook.md), and [scripts](../scripts/README.md).

## Package Feature Map

| Feature area | Package |
| --- | --- |
| Vault publishing CLI | [`@oncobase/oncobase`](../packages/oncobase/README.md) |
| Content API contracts, PII, chat tools, embeddings | [`@oncobase/wiki-content`](../packages/wiki-content/README.md) |
| Markdown rendering | [`@oncobase/wiki-markdown`](../packages/wiki-markdown/README.md) |
| Navigation, header, page chrome, search, palette, rail | [`@oncobase/wiki-shell`](../packages/wiki-shell/README.md) |
| Comments | [`@oncobase/wiki-comments`](../packages/wiki-comments/README.md) |
| Smart tables | [`@oncobase/smart-table`](../packages/smart-table/README.md) |
| Chat UI/runtime | [`@oncobase/chat`](../packages/chat/README.md) |

## Known Caveats

- Diana TNBC remains the first production deployment and appears in some workflow defaults, smoke URLs, and migration notes.
- `apps/web` is still the current production app and fallback target while `apps/wiki-vite` is being finalized.
- Some Liveblocks comments package code still imports app-local generated Convex and UI modules; that dependency is documented in the package README and should be removed before treating comments as fully framework-neutral.
- The file palette implementation listens for `Cmd/Ctrl+K` and `Cmd/Ctrl+O`; some older user-facing labels mention `Cmd/Ctrl+P`.
