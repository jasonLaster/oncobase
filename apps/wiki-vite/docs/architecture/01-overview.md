# 1. Overview

Oncobase is a multi-site wiki and AI assistant. Authors publish an Obsidian-style vault through the `oncobase` CLI; readers use the Vite application.

| Component | Responsibility |
| --- | --- |
| `src` | React Router pages, LiveStore cache, navigation and interactive UI |
| `server` | Same-origin content, auth, publishing, search, chat, comments and file APIs |
| `convex` | Site-scoped durable content, accounts, permissions, conversations and metadata |
| Vercel Blob | Published file bytes; site-prefixed upload keys |
| Liveblocks | Comment threads and collaboration |
| Shared packages | Rendering, content/security contracts, diagnostics, chat and publishing CLI |

Vercel Functions and the standalone Bun server use the same HTTP handlers. There is no Next runtime or separate content-source web app.

Continue to [request flow](02-request-flow.md), [data model](03-data-model.md), [publishing](04-publishing.md), or [chat and search](05-chat-and-search.md).
