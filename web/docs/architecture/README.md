# Architecture Docs

Educational walkthrough of how the wiki is built. Read in order — each doc assumes the previous.

1. [Overview](01-overview.md) — the platform from 30,000 ft: what runs where, who talks to whom.
2. [Request flow & multi-tenancy](02-request-flow.md) — how a request becomes a rendered page, and how one codebase serves many sites.
3. [Data model](03-data-model.md) — Convex tables, indexes, and the `siteId` invariant.
4. [Publishing pipeline](04-publishing.md) — Obsidian vault → Convex + Blob → live site.
5. [Chat & search](05-chat-and-search.md) — the AI side: embeddings, retrieval, streaming.

> Diagrams are Mermaid. They render natively in the wiki UI (`mermaid-renderer.tsx`) and on GitHub.
