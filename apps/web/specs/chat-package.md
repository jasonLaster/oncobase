# Chat Package Boundary

`packages/chat` contains the reusable full-stack chat feature. It should be
portable to another Next.js app without carrying Diana-specific knowledge.

## Package owns

- Chat UI composition, composer behavior, streaming message rendering, and
  conversation actions.
- AI SDK client transport setup for the configured chat API path.
- Convex persistence wiring through host-provided function references.
- Generic route helpers for a host-defined chat base path.
- Generic fallback markdown, tool-call, and source-link rendering.
- Small helpers for streaming flushes, system-prompt caching, and perf events.

## Web app owns

- Generated Convex imports such as `@convex/_generated/api`.
- `/api/chat` prompt construction, model choice, tool definitions, embeddings,
  search/read behavior, and PII redaction.
- Product copy, suggested prompts, route metadata, and chat enablement flags.
- Wiki-specific markdown transforms, including wikilinks, citations, math, and
  smart-table rendering.
- Wiki-specific tool UI and source extraction for `read_page` and
  `search_wiki`.

## Portability checks

`packages/chat/src/generic-boundary.test.ts` scans package source for
host-specific terms and generated Convex aliases. Add new host integrations in
`apps/web/src/components/*` or the target app, not in `packages/chat/src`.

Convex codegen belongs to the host app unless this package grows a standalone
example app with its own Convex deployment.
