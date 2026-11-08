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
- **Privacy.** The first launch explains that microphone audio goes to OpenAI.
  Transcripts stay in memory for the current turn's captions and aren't stored.
- **Bundle.** Only the launcher and avatar are in the initial reader bundle. The
  call code and corpus load when a reader opens Talk.

Talk is off until `ONCOGUIDE_TALK_OPENAI_API_KEY` is set on the Oncobase server.
**Use a key from a dedicated OpenAI project with a monthly spend limit.** Talk is
public and speech is costly, and the throttles (6 calls per client and 60 overall
per 10 minutes) only apply per function instance. Idle (5 minute) and length
(30 minute) limits run in the browser, so someone calling OpenAI's session
directly could exceed them. The project spend limit is the actual ceiling.
`ONCOGUIDE_CHAT_ORIGINS` also lists allowed preview origins for Talk, and
`NEXT_PUBLIC_ONCOGUIDE_TALK_API` overrides the browser endpoint for staging.

To try a real call locally after building (this spends real money):

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
