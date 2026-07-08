# Packages

Reusable Oncobase code lives at the repository top level under `packages/`. Apps should depend on these packages instead of copying framework-neutral behavior.

| Package | Purpose |
| --- | --- |
| [`@oncobase/diagnostics`](diagnostics/README.md) | Shared diagnostics timeline UI, timeline data shaping, and diagnostic study metadata helpers. |
| [`@oncobase/oncobase`](oncobase/README.md) | CLI for vault initialization, sync, check, publish, skills, and asset hash backfills. |
| [`@oncobase/wiki-content`](wiki-content/README.md) | Content API contracts, file-tree helpers, client fetch helpers, chat tool helpers, PII utilities, and embeddings. |
| [`@oncobase/wiki-markdown`](wiki-markdown/README.md) | Shared markdown renderer, wikilinks, citations, math, Mermaid, image theater, and smart-table integration. |
| [`@oncobase/wiki-shell`](wiki-shell/README.md) | Navigation, header, page chrome, search, command palettes, chat shell, right rail, and layout primitives. |
| [`@oncobase/wiki-comments`](wiki-comments/README.md) | Liveblocks-backed document comments, page timeline helpers, and thread metadata utilities. |
| [`@oncobase/smart-table`](smart-table/README.md) | Adaptive markdown/prose tables with sizing, resize handles, and overlay expansion. |
| [`@oncobase/chat`](chat/README.md) | Configurable full-stack chat UI, route helpers, runtime provider, and Convex persistence adapters. |

## Boundary Rule

Packages should own reusable contracts and UI primitives. Apps should own framework routing, generated Convex references, deployment-specific environment variables, and site-specific copy.

When a package still imports from an app, document that dependency in the package README and keep it visible as a follow-up extraction target.
