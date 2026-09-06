# 5. Chat and Search

## Search

The page palette searches the local manifest for navigation. Full text search is served by `/api/search`; it uses the site-scoped corpus and records completeness and latency. The existing text-search budget is 30 seconds. Session-scoped search never shares a sensitive corpus cache with public requests.

[ai-search.ts](../../server/ai-search.ts) owns query embedding, candidate retrieval, relevance scoring and safe result summaries. Provider success and deliberately injected empty/error UI states are different kinds of test evidence.

## Chat

[chat-route.ts](../../server/chat-route.ts) validates requests, loads the owned site-scoped conversation, supplies retrieval tools and streams model output. The framework-independent `@oncobase/chat` package owns reusable React UI and persistence helpers; the host owns routing, tools and prompts.

Convex persists message parts so reloads retain responses. Each active run has an ID; cancellation and persistence checks prevent a stopped run from overwriting a newer one. The real-backend story verifies response persistence, Stop, reload, archive and restore before deleting the exact owned fixture.

## Data handling

Shared content helpers apply site-specific PII policy before retrieved text is sent to the model. Keep account permissions, authored sensitivity and PII redaction distinct. Publishing and later retrieval must both honor the relevant boundaries.

See the [real chat regression](../../parity-e2e/chat-live.spec.ts), [search regressions](../../parity-e2e/search.spec.ts), and [PII specification](../../specs/pii-redaction.md).
