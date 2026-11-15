# WebMCP and knowledge-base discovery: review and proposal

_2026-11-14 · status: Phase 0 + Phase 1 implemented (uncommitted); Phase 2 partly; Phase 3 not started_

## Implementation status (2026-11-14)

- **Core:** `packages/wiki-shell/src/webmcp.ts` provides registration (supports `document.modelContext` and the legacy `navigator.modelContext`), unregister-on-unmount, `{ error }` results, telemetry hook, and the passage/heading/markdown helpers.
- **Reader** (`apps/app/src/webmcp/`), on every reader route:
  - Tools: `search_wiki` (text or AI, with tag and folder filters, deep-linked hits), `read_page` (section-scoped), `get_related_pages` (backlinks, outlinks, shared tags), `browse`, `list_tags`, `get_pages_by_tag`, `list_source_files`, `recent_pages`, `get_current_view`, `open_page`, `show_passage`, `open_search`, `open_tag`, `open_source_file`, `ask_wiki_chat`, `list_comments`.
  - Private pages are withheld until the palette toggle "Allow AI agents to read private pages" is on.
- **Education:**
  - `/education` in the app: `search_education`, `read_page`, `list_lessons`, `get_current_view`, `open_page`, `show_passage`.
  - OncoGuide adds the same set plus `read_section`, `lesson_sections` and `ask_tutor`.
- **Oncobase marketing pages:** `read_docs`, `get_current_view`, `open_page`.
- **Loading:** tool code loads only in browsers that expose WebMCP. The kill switch is `VITE_WEBMCP_ENABLED=false`. Origin-trial tokens go in `WEBMCP_ORIGIN_TRIAL_TOKENS`, comma-separated per origin, at build time; this applies to both the app and OncoGuide.
- **Phase 2 shipped without schema changes:**
  - Search filters, deep links and backlinks are computed client-side over the existing APIs.
  - `/chat?q=` prefill sends the question once.
  - Palette "Ask about this page".
  - Telemetry span `reader.webmcp-call` with a `reader.webmcp_tool` attribute.
- **Not done:**
  - Server-side search filters, and headings and dates in the manifest (these need Convex changes).
  - Tier 3: comment writes and clinical tools.
  - A remote MCP server.

## TL;DR

- **What WebMCP is.** A page registers tools with `document.modelContext.registerTool({name, description, inputSchema, execute})`. An agent running in the browser (Chrome's built-in agent, or an extension) can then call them. The tools run in the page with the user's own session. Agents stop scraping the DOM and use the page's own verbs instead.
- **The repo is closer than it looks.** Three pieces already exist:
  - `POST /api/tools` already has five agent tools: `search_wiki`, `read_page`, `list_pages`, `get_pages_by_tag` and `list_tags`.
  - The reader keeps the manifest (file tree, page index, tags, cached bodies) locally in LiveStore.
  - OncoGuide Talk already runs `search_education`, `read_section` and `open_page` as **browser-side** tools.
- **Recommendation.** Ship a small, flag-gated, read-and-navigate tool set first:
  - about 8 tools on the reader;
  - the existing Talk tools re-registered on education.
- All tool definitions live in one shared package, so chat, `/api/tools`, Talk and WebMCP cannot drift apart.
- **Discovery fixes.** The review found five gaps (§4) that weaken both agent tools and the human UI. Fix them alongside: search filters, headings and dates in the manifest, backlinks, deep-linked search hits, and chat prefill.
- **Platform status.** WebMCP is a Chrome **origin trial**, not a shipped standard:
  - The trial runs from Chrome 149; sources disagree on whether it ends at Chrome 156 or 162.
  - Chrome 150 renamed `navigator.modelContext` to `document.modelContext`.
- Treat it as an experiment that costs little because it reuses existing code. Don't build a platform on it yet.

## 1. What exists today (review)

| Area | Today | Where |
|---|---|---|
| Agent tools over HTTP | `/api/tools` exposes the same 5 tools as chat. Its `search_wiki` uses Convex text search only, 8 hits, with no vector search. | `apps/app/server/api/tools.ts:30-129` |
| Chat tools | Same 5 tools. `search_wiki` merges text and vector results (12 hits). `read_page` returns up to 8000 chars and `linked_pages`. | `apps/app/server/chat-route.ts:402-484`, `packages/wiki-content/src/chat-tools.ts` |
| Text search | Server-side literal regex over a redacted corpus. Hits are grouped by page with line numbers. **No tag, folder or date filter.** | `apps/app/server/api/search.ts:387` |
| AI search | Text and vector candidates, each scored 0-10 by an LLM, with summaries. Costs LLM quota (returns 402 when exhausted). | `apps/app/server/ai-search.ts:139` |
| Local data (no network) | LiveStore tables `fileTree`, `pageIndex` (slug, title, tags, description, sensitive), `pageContent` (markdown body when cached) and `assetIndex`. **No headings, no dates.** | `apps/app/src/livestore/schema.ts`, `queries.ts` |
| Palette | ⌘K modes: pages, outline, assets, tags, actions, debug. Fuzzy page search is local. | `apps/app/src/shell/CommandPalette.tsx` |
| Outline | `collectOutline()` and `scrollToOutlineItem()` work on the **current page's DOM only**. | `packages/wiki-shell/src/outline.ts` |
| Tags | `/tags/:tag`, computed locally | `TagPage.tsx` |
| Chat entry | `/chat`. **No URL prefill or auto-send.** `SessionChat.initialQuestion` exists but the reader doesn't use it. | `packages/chat/src/components/session-chat.tsx:74` |
| Comments | Liveblocks room `markdown:<slug>`. The HTTP API can list threads and add replies, but not start new threads. | `apps/app/server/api/comments.ts` |
| Image theater, smart tables | DOM click handlers only, no programmatic API | `packages/wiki-markdown/src/image-theater.tsx`, `packages/smart-table/src/enhance-table.ts` |
| Education / OncoGuide | Static `chat-index.json`. Talk tools run in the browser, and `open_page` already drives navigation. | `packages/education/src/talk.ts:30-43` |
| Agent-facing surfaces | `llms.txt` and `features.md`. No MCP server (the features page lists this as missing). `robots.txt` disallows everything. | `apps/app/public/` |

The access model already does the right thing for in-page tools:
- Manifest and body reads are scope-aware (public or session).
- Restricted bodies arrive as `sensitive-unavailable`.
- PII is redacted at publish time and again on every read path.
- RBAC is enforced server-side on every search, tool and comment path.

A WebMCP tool that only calls same-origin endpoints, or reads LiveStore, **cannot exceed the user's own access**. The new question is narrower: *should* everything the user can see flow to whatever agent they have attached? See §5.

## 2. Proposed tool set

Use the existing tool names where they already exist (`search_wiki`, `read_page`, `list_tags`, `open_page`). Agents and prompts then work the same in chat, Talk and WebMCP.

### Tier 1: find and read (read-only, register on every reader route)

| Tool | Input | Implementation | Network |
|---|---|---|---|
| `search_wiki` | `{query, mode?: "text"\|"ai", tag?, folder?, limit?}` | `text` calls `/api/search`. `ai` calls `/api/ai-search` with the text-hit slugs, matching SearchPage. Returns `{slug, title, href, snippet, line, anchor?}`. | yes |
| `read_page` | `{slug, anchor?, maxChars?}` | Uses the LiveStore `pageContent` if it is `fresh`, otherwise `/api/wiki/pages`. Returns title, tags, description, body (optionally cut to a section), outline and linked pages. | sometimes |
| `browse` | `{folder?}` | Folder children from the `fileTree` (pages and subfolders, with titles) | no |
| `list_tags` / `get_pages_by_tag` | `{}` / `{tag}` | Tag counts and tag members from `pageIndex` | no |
| `get_current_page` | `{}` | Current slug, title, tags, visible heading, selected text, outline, related assets and scope (signed in or public) | no |
| `list_assets` | `{slug?}` | `relatedAssetsForSlug` / `assetIndex` (PDFs, CSVs, images) | no |
| `recent_pages` | `{}` | The palette's recents (`cmd-palette-recent`) | no |

Most of these need no network at all. That makes them fast and cheap, and they work offline, which is something the server-side `/api/tools` cannot offer.

### Tier 2: drive the reader (the reason to use WebMCP over a remote MCP server)

WebMCP's distinctive value is that the agent and the user look at the **same screen**. An agent can answer by *showing*: open the page, scroll to the section, highlight the sentence.

| Tool | Input | Implementation |
|---|---|---|
| `open_page` | `{slug, anchor?}` | Router navigate, then `scrollToOutlineItem`. Same name and meaning as Talk's `open_page`. |
| `show_passage` | `{quote, slug?}` | Find the text in `.prose`, scroll to it, flash a highlight. This turns "according to page X" into a visible citation. Reuses the comment anchor matcher (`anchorQuote/Prefix/Suffix`). |
| `open_search` | `{query, mode?}` | Navigate to `/search?q=&tab=`, so the user sees the result list |
| `open_tag` | `{tag}` | `/tags/:tag` |
| `open_asset` | `{path}` | PDF viewer `/tools/pdf-viewer?path=`, or image theater (needs a small exported `openTheater(img)`) |
| `ask_wiki_chat` | `{question}` | Navigate to `/chat?q=…` and auto-send. Needs the chat prefill in §4.5. |
| `open_palette` | `{mode}` | `openCommandPalette(mode)`. Low value, nearly free. |

### Tier 3: writes and clinical data (later, opt-in, with user confirmation)

- `add_comment` `{slug, quote?, body}`:
  - Requires sign-in.
  - Needs a "create thread" path, since today the HTTP API can only reply.
  - Should ask the user before posting; WebMCP gives the tool a user-interaction hook for this.
- Diagnostics: the timeline, imaging studies, opening DICOM or pathology viewers at a study or series, Epic labs.
  - These have very high value for Diana's own exploration ("show me the last two MRIs side by side").
  - They are also the most sensitive data in the system.
  - Session-only, behind their own toggle, never registered on public scope.
- **Leave out entirely:** share-link creation, downloads of full archives, and everything admin, PII view or RBAC. These are one prompt-injection away from leaking data, and agents rarely need them.

### Declarative freebie

The `/search` page already renders a `<form>` (`SearchPage.tsx:277`). Adding `toolname="search_wiki"` and `tooldescription` makes it a tool in supporting browsers. Other browsers ignore the attributes. Do this in the first PR.

## 3. Architecture

```
packages/wiki-content/src/agent-tools/      ← NEW: one source of truth
  definitions.ts   name, description, zod input schema, result type (per tool)
  handlers.ts      pure functions over (pageIndex, fileTree, pageContent, fetchers)

apps/app/server/api/tools.ts                ← reuses definitions (server handlers)
apps/app/server/chat-route.ts               ← reuses definitions (AI SDK tool())
apps/app/src/webmcp/                        ← NEW
  register.ts      feature-detect document.modelContext ?? navigator.modelContext,
                   zod → JSON Schema, register / unregister, Axiom span per call
  reader-tools.ts  Tier 1+2, bound to LiveStore store + router
  route-tools.ts   registered only while a route is mounted (e.g. get_current_page on WikiPage)
apps/app/src/education/ + apps/oncoguide    ← register packages/education talk tools
```

- **Mount point.** A `<WebMcpTools/>` component inside `RequireReaderStore`, so tools can read the store and router. Register only when all of these hold:
  - the `webmcp` flag is on;
  - the API exists;
  - an origin-trial token is present.
- **Lifecycle.** Global tools register once. Route tools register and unregister with the route (the API supports unregister), so an agent never sees `get_current_page` on `/chat`.
- **Results.** Return compact JSON with `href`s the agent can show the user. Always include `slug`, so results chain into `read_page` / `open_page`. Mark content written by a user (comments, chat) as such.
- **Telemetry.** Send one Axiom event per call: tool, latency, result size, whether it hit the network. Without this we can't tell whether anyone uses it.
- **Polyfill.** Bridge libraries exist that expose page tools to MCP clients in other browsers via an extension. Evaluate one only if the pilot shows real use; don't take on the dependency up front.

### Testing

- **Unit:** handlers are pure functions over fixture manifests, which covers most of the logic.
- **Playwright:**
  - An `addInitScript` stub defines `document.modelContext` and captures registrations.
  - Tests call `execute()` directly and assert results.
  - Tests check navigation side effects: URL change and scroll position.
  - Run them in the existing reader e2e shards on the local stack.
  - Add one spec for the sensitive case: a public-scope run must never return a sensitive body.

## 4. Discovery gaps worth fixing regardless

Each of these improves the human UI too, and makes the tools much better.

1. **Search filters.** `/api/search` has no `tag` or `folder` filter, yet the Convex `search_content` index already has `tags` as a filter field (`convex/schema.ts:124`).
   - Add `tag`, `folder` and later `updatedSince` params.
   - Expose them as filter chips on `/search` and as `search_wiki` args.
2. **Headings and dates in the manifest.** `pageIndex` has no outline and no date.
   - At publish, store `headings: [{id, text, level}]` (h1–h3) and `updatedAt` per document. `_creationTime` doesn't move on update, and `publishChanges` has no time.
   - This enables:
     - the ⌘K outline across **all** pages ("jump to *Treatment options* in any page");
     - section-level `read_page`;
     - a **What's new** page sorted by `updatedAt`;
     - "recently updated" filters in search.
3. **Deep-linked search hits.** Text hits carry `lineNumber` but no anchor. Map each line to its nearest preceding heading id, cheap once (2) exists, so results open at the section instead of the top of a long page.
4. **Backlinks and related pages.** Nothing computes inbound links.
   - Extract wikilinks at publish and store `outlinks` on `documentMeta`. Invert them for backlinks.
   - Add a "Linked from" section in the right rail and a `get_related` tool (backlinks, outlinks, shared tags).
   - For a dense research vault this is probably the single best way to explore by browsing.
5. **Chat prefill.** Support `/chat?q=…` (auto-send) by wiring the existing `SessionChat.initialQuestion`. This unlocks:
   - an "Ask about this page" action in the palette and page actions;
   - an "Ask chat" handoff from `/search` when results are thin;
   - `ask_wiki_chat`.
6. **Unify `/api/tools` and chat.** `/api/tools` `search_wiki` has no vector search and an 8-hit cap; chat uses hybrid search with 12 hits. The shared definitions package in §3 resolves this.
7. **Programmatic hooks.** Export `openImageTheater()` and a smart-table `expand(table)` so tools, and future keyboard shortcuts, can drive them.

Candidate new pages: **What's new** (from 2), an **Explore** page (folder cards with page counts, top tags, recently updated), and search filter chips (from 1).

## 5. Privacy and safety

- **Sensitive pages are opt-in.** The tools inherit the user's access. But any browser agent may send tool output to a third-party model.
  - Default: tool results exclude bodies of `sensitive` pages and all clinical data, even for a signed-in user.
  - Add a per-device toggle, "Let AI agents in this browser read private pages", stored locally and off by default.
  - Public scope never exposes them.
- **PII:** bodies are already redacted before they reach LiveStore. Don't add any path that reads `rawContent`.
- **Cost:** `mode: "ai"` search spends LLM quota. Throttle it per tab (for example, at most N calls a minute) and surface 402 as a clear tool error.
- **Prompt injection:** the wiki is authored by its owner, so it carries little risk. Comments and guest names come from users, so label them. Tier 3 writes always need user confirmation.
- **Origin trial:** register the token per production domain. Keep the flag server-controlled so the feature can be turned off without a deploy.

## 6. Plan

| Phase | Scope | Size |
|---|---|---|
| **0: pilot** | Flag, origin-trial token, `register.ts`, test stub. Tier 1 read tools, `open_page`, declarative search form. Register Talk's existing tools on `/education` and oncoguide.cc. | ~2 days |
| **1: show, don't tell** | `show_passage`, `open_search`, `open_tag`, `open_asset`, `/chat?q=` and `ask_wiki_chat`. Shared `agent-tools` definitions adopted by `/api/tools` and chat. | ~3–4 days |
| **2: better discovery** | Search filters, headings and `updatedAt` at publish (with backfill), deep-linked hits, backlinks and "Linked from", What's new page. Convex changes follow the usual Convex-before-app deploy order. | ~1–1.5 weeks |
| **3: opt-in power tools** | Sensitive-page toggle, comments (new-thread path plus confirmation), diagnostics and imaging tools for session scope | ~1 week |

Phase 2 is worth doing even if WebMCP adoption stalls.

## 7. Decisions needed

1. **Pilot surface:** public education/OncoGuide first (no auth or PHI questions, the tools already exist) or the Diana reader first (more value, needs §5)? *Recommend both in Phase 0. Education is nearly free.*
2. **Sensitive content to agents:** off by default with a local toggle (recommended), always off, or follow the user's access?
3. **Remote MCP server too?** WebMCP reaches only in-browser agents in a Chrome trial. An `/api/mcp` endpoint over the same shared definitions would serve Claude and ChatGPT clients today. The hard part is auth: the password gate plus session would have to become OAuth. *Recommend: build the shared definitions in Phase 1 so this stays cheap, and decide after the pilot.*
4. **Clinical tools (Phase 3):** in scope at all, or kept to Diana's own sessions only?
