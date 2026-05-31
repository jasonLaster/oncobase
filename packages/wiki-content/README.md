# @oncobase/wiki-content

Shared content contracts and server-safe helpers for Oncobase wiki apps.

This package is the data boundary between apps and durable wiki behavior. It does not render UI. It defines the structures and helpers that let the Next app, the Vite reader, chat tools, and tests agree on what a wiki page, manifest, asset, session, and content reconciliation result look like.

## Main Features

- file tree and compact file tree types
- manifest, page, asset, and session response contracts
- browser content client helpers
- hidden-file-tree filtering
- manifest/page API response builders
- chat page-reading helpers
- shared wiki chat request schema and search-pattern generation
- PII redaction helpers
- embedding preparation, token counting, chunking, and mean pooling

## Entry Points

- `@oncobase/wiki-content` - shared types, compact tree helpers, client utilities, and reconciliation helpers
- `@oncobase/wiki-content/server` - server response helpers for wiki manifest, page, asset, and session APIs
- `@oncobase/wiki-content/chat-tools` - read-page helpers for chat tools, including unavailable-sensitive-page handling
- `@oncobase/wiki-content/chat-route` - shared chat request schema, tool-result compaction, system-prompt base, and query expansion
- `@oncobase/wiki-content/pii` - PII pattern and redaction utilities
- `@oncobase/wiki-content/embeddings` - embedding text prep, chunking, pooling, and adapter-friendly orchestration

## Package Boundary

This package may depend on TypeScript, Zod, and server-safe utility libraries. It should not depend on React, Next, Vite, LiveStore, Convex generated APIs, app routes, or site-specific copy. Hosts supply database gateways, fetch implementations, auth/session lookups, and model/provider adapters.

## Related Docs

- [Feature overview](../../docs/features.md)
- [Chat and search architecture](../../apps/web/docs/architecture/05-chat-and-search.md)
- [PII redaction spec](../../apps/web/specs/pii-redaction.md)
- [Vite reader README](../../apps/wiki-vite/README.md)
