# OncoGuide

Next.js App Router with static export, built from the public
[OncoGuide content repository](https://github.com/jasonLaster/oncoguide).
Lessons use the same `/education/...` paths and also support `/wiki/education/...`.
The existing Diana education site and its content remain available.

```sh
bun install --frozen-lockfile
bun --cwd packages/smart-table build
bun --cwd apps/oncoguide build
bun --cwd apps/oncoguide test:unit
bun --cwd apps/oncoguide test:e2e
```

`content.lock.json` pins the default content commit. Set
`ONCOGUIDE_CONTENT_DIR=/absolute/path/to/oncoguide` to build a reviewed local
checkout, or `ONCOGUIDE_CONTENT_SHA` to build another committed revision.
`ONCOGUIDE_BASE_URL` runs browser tests against an existing deployment. The local
browser checks serve the exported `out/` directory, not a development server.

The content repo's Vercel project builds this app from the exact Oncobase commit
in its `renderer.lock.json`. Native Git previews and production builds therefore
run on content changes without cross-repository deployment tokens. Content PRs
also run the same static build and browser checks in GitHub Actions. To release
updated application components, update that renderer commit in the content repo;
the resulting content commit is reviewed and rebuilt like any other release.

The app compiles Markdown at build time using the shared renderer's optional host
adapters. Images and downloads become local static assets, education links stay
local, and other wiki links point back to Diana. Source Markdown is unchanged.
Navigation and article markup are statically rendered; small Client Components
provide search, themes, mobile navigation and the shared Markdown enhancements.
The client entry points do not import the Markdown compiler or the care runtime.

`/education/chat/` provides a learning companion using the shared
`@oncobase/chat` session UI and streaming Markdown renderer. Readers can ask from
the home page, navigation, or a specific lesson. The conversation stays in the
current browser tab's session storage while readers explore source links; New
chat clears it. It is not saved to care conversations.

The content build emits `/chat-index.json`: every public lesson's rendered
sections, exact heading anchors, text, captions and paired theme illustrations.
Oncobase serves `/api/education/chat` through its existing backend and AI Gateway
model selector. It searches the whole index, can read additional sections, and
streams source cards and cartoons alongside the explanation. Only this public
corpus is available to the tutor. The browser sends text history, the optional
lesson slug and content commit; client tool outputs and source content are never
accepted as evidence. Mismatched content commits ask the reader to reload.

### The visual catalog

The content build also emits `/visual-catalog.json`: every lesson cartoon, diagram
and table, by exact section, with what it shows (alt text, diagram labels or table
cells) and the lesson's own caption when it has one. Markup for diagrams and tables
is one small file each under `/visuals/`, fetched only when shown, so the catalog
stays metadata. The build prints how many of each kind it found. It is a separate
file from `chat-index.json` because both chat and Talk load that index first.

Each cartoon also carries the words drawn on it, read from its SVG, and the brief
it was drawn from (`images/prompts/<name>.txt`). The words are shown to the model.
The brief is used for search only, at low weight, because it states intent rather
than the final picture; it never reaches the reader's page. A table is described
by its columns, row names and the sentence that introduces it. Where a lesson
follows a visual with "Read the illustration" and "Answer", both are kept for the
picture quiz. The catalog also holds each lesson's front matter: summary, level,
other names, what to learn first, where it is used, and its place in a guide.

Typed chat and Talk both choose from this catalog by id, so a model can never
supply an image URL or markup. In typed chat:

- Retrieved sections list their visuals, and `search_visuals` finds others by what
  they show, optionally by kind. The tutor calls `show_visual` for at most two per
  answer and may show only visuals listed to it in that reply.
- `show_visual` returns a marker such as `[[visual:1]]`. The tutor puts it where
  the reader should look and the page draws the figure there. A visual with no
  marker in the text appears under the answer.
- Until the tutor chooses, the reader sees the cartoon that best matches the
  question, but only if it covers at least 70% of the question's meaning.
- "Explain this" on a figure, and the next-step chips, send that visual's id as
  `focusVisual` with `focusMode` `explain`, `quiz` or `check`. The id is looked up
  in the catalog; an unknown id is ignored.
- A lesson card and up to four next steps come from front matter and from visuals
  not yet shown. No model writes them.

Both surfaces render through `components/lesson-visual.tsx`. Ids are a section
anchor plus the cartoon's file name, or a per-section count for diagrams and
tables, so adding a visual elsewhere on a page does not change them.

### Search

Lesson search prepares its index once per corpus instead of tokenising every
section per question. With the catalog loaded it also knows each lesson's other
names, so "T-DXd" finds the antibody-drug conjugate lesson even where the text
never uses that name.

Search by meaning is an optional layer. Building with `ONCOGUIDE_SEMANTIC_SEARCH=1`
and AI Gateway credentials writes `/search-vectors.json`: one 256-dimension vector
per section from `openai/text-embedding-3-small`, a byte per dimension. Unchanged
sections are read from `.generated/search-vectors-cache.json`. The server embeds
each question (1.2 s limit, then keywords only) and blends the two rankings: a
lesson named in the question comes first and the rankings then alternate;
otherwise meaning leads. `ONCOGUIDE_SEARCH_VECTORS_URL` overrides where the server
looks. Talk searches in the browser and uses keywords and lesson names only.

`bun scripts/eval-search.ts` measures all of this against questions with known
answers: 40 natural questions, every lesson alias and 35 requests for a picture.
Add `--semantic` to measure the blend, `--verbose` to list misses, and
`--min-lesson` / `--min-visual` to fail below a top-3 rate. Run it after changing
ranking, the catalog fields or the prompts that feed search.

The server's `ONCOGUIDE_VISUAL_CATALOG_URL` defaults to
`https://oncoguide.cc/visual-catalog.json`. The catalog is optional: if it is
missing, or built from a different content commit than the index, the tutor
answers as before with cartoons found by lesson search. This lets the Oncobase
server and the static site deploy in either order.

The server's `ONCOGUIDE_CHAT_INDEX_URL` defaults to
`https://oncoguide.cc/chat-index.json`. `ONCOGUIDE_CHAT_ORIGINS` can list additional
preview origins, separated by commas. `NEXT_PUBLIC_ONCOGUIDE_CHAT_API` overrides
the browser endpoint for staging. Keep AI Gateway credentials on the Oncobase
server. Requests have bounded history, generation time, output and tool steps,
and a per-instance IP throttle; deployment-wide abuse controls belong in the
hosting firewall. Responses are uncached and use credential-free CORS.

For a local, functional preview after building, run from this directory:

```sh
ONCOGUIDE_CHAT_LOCAL=1 bun --env-file=../../.env.local scripts/serve-export.ts
```

This uses the exported corpus with the real Oncobase backend handler. Localhost
chat uses this same-origin endpoint. Backend unit tests exercise the actual SSE
handler with a deterministic model. The dedicated chat E2E suite uses recorded
Vercel AI Gateway responses through the actual handler and SDK.
Chat code loads only on its route. Static checks retain a 350 KiB initial reader
ceiling and a 550 KiB ceiling for all chunks, including the lazy shared chat SDK
and streaming renderer.

Run the learning-chat journeys separately from the static reader audit:

```sh
bun run test:e2e:chat
```

This starts an isolated loopback server on port 62012 with no Gateway credentials
and no network fallback. It covers curiosity prompts, simpler follow-ups, exact
section navigation, session restoration, cartoons and their theme variants,
mobile layout, retry, cancellation, lesson context, and tool reads across both
guides. It also checks that browser-supplied evidence is ignored, stale content
is rejected, and a changed model request fails playback. CI runs both suites.

`e2e/fixtures/gateway/` contains genuine Gateway SSE responses, public request
bodies, model and SDK versions, recording dates, and the content commit and
corpus SHA-256. Request headers and credentials are never recorded. The provider
response bodies are preserved, including token usage and tool-call metadata.
Every outgoing model request must exactly match the recorded public prompt,
history, retrieval results, and tool results. `e2e/chat.spec.ts-snapshots/` holds
readable, platform-independent JSON snapshots of Gateway text and tool calls,
the handler's final resources and citations, and the rendered explanations,
links and cartoons. Chunk boundaries, generated IDs, timestamps, and token usage
are omitted from these review snapshots but remain in the original recordings.

To intentionally refresh after a prompt, corpus, model or SDK change, build
first, then record using the existing server Gateway credentials:

```sh
bun run build
bun run chat:record
bun run test:e2e:chat --update-snapshots
bun run test:e2e:chat
```

Recording makes paid live requests using the production model selected by
Oncobase. It accepts only fixed public scenarios in `learningScenarios`; no
personal questions or conversations. Append a scenario ID, such as
`bun run chat:record across-the-library`, to refresh just that recording. Review
the fixture and snapshot diff together before committing. The ordinary E2E
command never records or updates snapshots.

### Deciding what to show

Before the tutor writes, the chat server asks a decision model what to show.
Search proposes up to 12 figures and 6 sections; one request scores each from 0
(unrelated) to 3 (exact) against the reader's message and asks whether the
reader asked for a figure. Fixed rules in `packages/education/src/decisions.ts`
turn the scores into the answer's content:

- The best figure shows at a score of 2, or 1.5 when the reader asked for one.
- A second figure shows only at 2.5 and only if it is a different kind.
- Section cards keep search order and are withheld when no section reaches 1.25.

The tutor is told what is showing and only places the markers. It has no visual
tools on these answers. A tapped visual skips the decision.

The request goes to `typesafe-ai/jev` through the AI Gateway, then to
`openai/gpt-6-luna-decisions` if Jev is down, slow (1.5 s), refuses or answers
incompletely. If both fail, the tutor chooses with `search_visuals` and
`show_visual` as before. `ONCOGUIDE_DECISION_MODELS` replaces the list; an empty
value turns the step off.

On Vercel each chat request is one trace: `wiki /api/education/chat` with child
spans `education.library`, `education.search`, `education.decide` (one
`education.decide.attempt` per model tried, so a fallback shows as a failed
attempt then a successful one) and `education.answer`. The request span says
who decided (`education.decision`, `education.decision.model`) and how much was
shown; the answer span counts model steps and tool calls. Spans never carry the
question, the answer or what was found.

`bun --env-file=<.env.local> scripts/eval-decisions.ts --verbose` measures the
step on current content with paid requests. Chat fixtures record each decision
next to the model exchanges, and replay rejects a decision request that differs.

## Talk

A floating avatar on every page starts a spoken conversation with OncoGuide over
the OpenAI Realtime API. It lives in the root layout, so a call continues across
client-side navigation. As the conversation moves, it offers the most relevant
page in a prompt that the reader can answer by tapping or by voice.

- **Connection.** The browser sends a WebRTC offer to Oncobase's
  `/api/education/talk`, which adds the API key, model, prompt and tools and
  returns OpenAI's answer. Audio then flows directly between the browser and
  OpenAI. Readers never receive a credential.
- **Tools.** The browser answers tool calls against the public `/chat-index.json`
  with the same `searchEducation` ranking as chat. Only real corpus sections can
  become a prompt or a navigation target. `packages/education/src/talk.ts` holds
  the prompt, tools and session configuration.
- **Page prompts.** Reading a section on another page raises its prompt
  automatically, because live testing showed the model won't reliably call
  `suggest_page` by itself. A declined page isn't offered again.
- **Privacy.** The first launch explains that microphone audio goes to OpenAI,
  along with recent typed messages when a call starts from chat. Transcripts stay
  in memory for the current turn's captions, and board cards stay in memory for the
  tab. Neither is stored.
- **Bundle.** Only the launcher, avatar and a small store are in the initial reader
  bundle. The call code, corpus and visuals load when a reader opens Talk.

### The conversation board

Starting a call from `/education/chat/` replaces the transcript with a board that
makes the conversation easier to follow. Nothing the reader or voice says is
written down unless the reader turns captions on. Typed chat stays mounted beneath
it and returns intact.

- **Real visuals first.** The board chooses from the visual catalog described
  under "The visual catalog" below. When the voice reads a
  section, the client immediately shows that lesson's best cartoon or diagram and
  tells the voice, so it doesn't depend on the model asking and it can point to it.
- **Tap to ask, and enlarge.** A figure on the board has "Ask about this", which
  tells the voice which card the reader tapped, and diagrams and tables can be
  enlarged.
- **The page as the board.** Away from the chat page there is no board. When the
  voice reads a section of the lesson the reader is on, the page scrolls there and
  outlines that section's first picture, diagram or table for a few seconds, and
  the voice is told so it can point to it. See `lib/talk-point.ts`.
- **A silent board request.** After each spoken reply, the client sends a text-only
  Realtime response with `conversation: "none"` and `tool_choice: "required"`. It
  picks another lesson visual, or writes steps, a comparison or key points. It adds
  no speech and doesn't delay the voice. Transcripts finish before their audio, so
  cards arrive while the voice is talking. See `lib/talk-board.ts`.
- **Limits on written cards.** They render as plain text with bounded lengths, carry
  an "AI summary of" label, and must cite a section retrieved during the call.
  Models pick visuals by id and never supply markup. Each reply adds one text
  request's tokens to the call's cost.

Talk is off until `ONCOGUIDE_TALK_OPENAI_API_KEY` is set on the Oncobase server.
**Use a key from a dedicated OpenAI project with a monthly spend limit.** Talk is
public and speech is costly, and the throttles (6 calls per client and 60 overall
per 10 minutes) only apply per function instance. Idle (5 minute) and length
(30 minute) limits run in the browser, so someone calling OpenAI's session
directly could exceed them. The project spend limit is the actual ceiling.
`ONCOGUIDE_CHAT_ORIGINS` also lists allowed preview origins for Talk, and
`NEXT_PUBLIC_ONCOGUIDE_TALK_API` overrides the browser endpoint for staging.

To try a real call locally after building (this spends real money), add
`ONCOGUIDE_TALK_OPENAI_API_KEY` to `.env.local`, then run:

```sh
ONCOGUIDE_TALK_LOCAL=1 bun --env-file=../../.env.local scripts/serve-export.ts
```

`e2e/talk.spec.ts` runs in the normal static suite with a fake Realtime peer, so
it needs no credentials and costs nothing. The panel, tools, search and routing
are real. It cannot catch a change in OpenAI's protocol or how the model behaves,
so try a real call after changing the prompt, tools or model.

Release the Oncobase backend and update the content repository's renderer pin
together. The new static build must provide `chat-index.json` before live chat
can use it. For a staged preview, point the backend at that preview's public
index and configure its origin and API endpoint explicitly. Validate a real
provider reply and source navigation before promoting both releases.

The initial content copy uses `scripts/copy-content.ts <diana-repo>
<empty-destination> [commit/ref]`. It reads committed Markdown only, copies its
referenced asset graph (including inferred dark variants), verifies LFS hashes,
and records a source provenance receipt. It does not delete or publish Diana
content, and never exports its private Git history.
