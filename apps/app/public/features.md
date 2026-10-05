# Everything Oncobase can do

> A knowledge base for taking control of your care, built with attention to detail so it’s easy to read, easy to share, and safe.

Source: https://github.com/jasonLaster/oncobase (MIT). Live example: https://diana-tnbc.com/. This page: https://diana-tnbc.com/features. How it compares with Notion, Obsidian, and others: https://diana-tnbc.com/compare.md. Inspired by Sid Sijbrandij's osteosarc.com (https://osteosarc.com/).

## Find your way, then read in peace.

Hundreds of pages should feel as easy as one. Everything below works on a laptop, a tablet, and a phone.

- **Page tree.** Every page in a folders-first tree that remembers what you opened, resizes, collapses to a rail, and stays fast on large vaults. Where: Sidebar. Interface: `GET /api/wiki/manifest`.
- **Outline.** A page's headings with the current section highlighted as you scroll; a tab in the phone sheet and a mode in the palette. Where: Right rail, phone sheet, palette (⌘⇧O).
- **Heading links.** Every heading is linkable. Hover for a # that copies the URL, and deep links land clear of the fixed header. Where: Every page.
- **Smart tables.** Column widths come from measured text, drag to resize, expand to the full workspace on desktop, with a phone layout and a sticky first column. Where: Any markdown table.
- **File palette.** ⌘K jumps to any page with fuzzy matching and recents, works offline, and also finds headings, source PDFs, tags, and actions. Where: ⌘K / Ctrl+K.
- **Mobile reader.** A phone header, a bottom sheet with Page nav and Outline tabs, focus trapping, and a floating Ask wiki button. Where: Below 768px.
- **Light, dark, or system.** Three theme modes applied before first paint, so there is no flash. Diagrams follow the theme. Where: Actions menu, palette, theme button.
- **Image lightbox and slides.** Open any image full screen with download, and step through a slide set with the arrow keys. Where: Every page with images.
- **Mermaid diagrams.** Write a flowchart, timeline, or Gantt chart as text and it draws itself, follows your light or dark theme, and loads only on pages that use one. Where: Any markdown page.
- **Rich markdown.** Wikilinks, GFM tables, task lists and footnotes, KaTeX math, citation links, and PDF chips. Where: Every page.
- **Tags and note bundles.** Tag pages list their pages as a tree; Overview, Formatted, and Raw versions of one note share a switcher. Where: /tags/:tag, page header.
- **Saved pages and offline.** Pages are stored on your device, paint before the database opens, and say plainly when you are offline or retrying. Where: Automatic.
- **Copy and download.** Copy a page as markdown in one click, or download the whole wiki as a zip. Where: Page header, actions menu. Interface: `GET /api/page-copy, GET /api/download`.

## Talk to the knowledge base.

Three ways to find things: exact words, meaning, and a conversation. Each one only ever sees what you’re allowed to see.

- **Chat with the knowledge base.** An agent searches, reads the best pages, follows links, and answers with inline citations. Conversations are saved, and you can stop, queue, and resume. Where: Ask wiki, /chat. Interface: `POST /api/chat`.
- **AI search.** Semantic search that returns the most relevant pages, each scored out of 10 with a one-line reason. Where: /search (AI Mode). Interface: `POST /api/ai-search`.
- **Text search.** Exact matches with line numbers and highlighted snippets, grouped by page, with an interim answer while the full scan finishes. Where: /search (Text Search). Interface: `GET /api/search`.
- **Agent tools.** The same search and read tools the chat agent uses, as a JSON endpoint: search_wiki, read_page, get_pages_by_tag, list_tags, list_pages. Where: API only. Interface: `POST /api/tools`.

## Share the science without sharing the patient.

Privacy is built in layers, so a mistake in one doesn’t expose everything.

- **Password gate.** A shared password in front of the whole site, with a signed cookie and no-store responses. Where: Sign-in page. Interface: `POST /api/login`.
- **Accounts and roles.** Give each person a role and choose which folders and tags they can open. A sensitive page that no role matches is visible to nobody. Where: Admin, Roles. Interface: `/api/admin/roles`.
- **Sensitive pages.** Mark a page sensitive in its frontmatter and it drops out of guest manifests, search, AI search, chat, tags, downloads, link previews, and comments. Where: Frontmatter. Interface: `oncobase check`.
- **Inline redaction.** Wrap a span in <redact> or a block in :::redact and readers without access see the label, not the text. Where: Markdown.
- **Redaction patterns.** Per-site patterns catch identifiers that slip through, applied on page reads, search, AI search, chat, copy, and downloads. Where: Site config.
- **Admin screens.** Filter pages by who can see them, assign roles in bulk, and preview what a role includes before saving. Where: /admin/pages, /admin/users, /admin/roles.
- **Agent skills for redaction.** Written rules teach agents what to redact, what to leave visible, and what to mark sensitive, with a linter that checks. Where: Vault skills (Diana’s vault).

## Results and scans, right beside the notes.

Clinical data is easier to understand next to the conversation about it. These viewers run in the browser, with nothing to install.

- **Diagnostics timeline.** Swim-lanes for imaging, pathology, ctDNA, and blood counts, with a draggable overview, zoom, filter, and source links. Where: /diagnostics. Interface: `GET /api/timeline`.
- **Imaging list.** Every study with its reports, images, comparisons, and download, as a table or a phone list. Where: /diagnostics/imaging. Interface: `GET /api/diagnostic-studies`.
- **DICOM viewer.** Stack and series browsing, window/level, pan, zoom, cine, touch gestures, deep links, and saved annotations with a calibrated ruler. Where: /tools/dicom-viewer. Interface: `/api/dicom/*`.
- **DICOM compare.** Two synced viewports with presets such as subtraction, z-matched, and projection, and a clear match state. Where: /tools/dicom-compare.
- **Pathology slides.** Whole-slide viewing with a navigator, magnification, scale bar, rulers, side-by-side compare, and saved region notes. Where: /tools/pathology-viewer. Interface: `/api/pathology/*`.
- **Lab ingestion.** An hourly import of lab results from Epic MyChart over SMART on FHIR, with encrypted tokens. Where: Admin. Interface: `/api/integrations/epic/*`.

## Work through it together.

Family, doctors, and researchers read the same page, so the questions and answers live next to the thing they are about.

- **Comments.** Page-level and selection-anchored threads with replies, reactions, resolve, and shareable links; guests get a stable name. Where: Right rail, /comments. Interface: `/api/liveblocks-*`.
- **Link previews.** Pages get their own preview card in chats and social apps. Sensitive pages fall back to a generic card. Where: Automatic. Interface: `GET /api/share-preview`.
- **Education hub.** A public, password-free reader for the guides you choose to share, with its own search. Where: /education. Interface: `GET /api/education/*`.
- **Multi-site.** One deployment can serve several sites, each with its own domain, password, roles, and data. Where: Site config.

## Fast on the first visit, faster every visit after.

Reading shouldn’t wait on a spinner. Oncobase keeps what you have read on your device, loads the rest in the background, and downloads only the code a page needs.

- **Local page store.** Pages you have opened are kept in a local database in your browser, so reopening one or going back needs no network, and they still open offline. Where: Automatic.
- **Whole index up front.** The page tree, palette, and asset list come from one small manifest, so navigating and finding files never wait on the network. Where: Automatic. Interface: `GET /api/wiki/manifest`.
- **Instant first paint.** A compressed snapshot of the last page and tree paints before the database opens, and is dropped if your access changed. Where: Automatic.
- **Destination first.** Opening a page you haven’t visited shows its title and place in the tree right away, while the text arrives in one small request. Where: Automatic.
- **Background prefetch.** The pages other readers open most are fetched quietly ahead of time, up to 150 pages and 8 MiB, and never on offline or data-saver connections. Where: Automatic. Interface: `GET /api/wiki/prefetch`.
- **Quiet revalidation.** Unchanged data costs a tiny “not modified” reply instead of a download, and the page list refreshes at most about once a minute. Where: Automatic.
- **Fast search.** Search answers from an index within about a second and a half while the exhaustive scan finishes in the background. Where: /search. Interface: `GET /api/search`.
- **Light code.** Math, diagrams, chat, and the palette load only when a page needs them, and size budgets in the build keep the first download small. Where: Automatic.
- **Long pages stay fast.** Long articles skip drawing what is off screen, while find-in-page, selection, anchors, and print still work. Where: Automatic.

## Built with attention to detail.

Caring for someone is full of small moments where software either helps or gets in the way. These are some of the small things we got right.

### Reading

- **No flash of the wrong theme.** Your light or dark choice is applied before anything draws, so dark mode never starts out white.
- **Links land where you meant.** Heading links and outline taps scroll clear of the header, even after a reload, on a phone or a laptop.
- **Refreshes don’t move you.** New content slips in without losing your scroll position or your place in the navigation.
- **Your layout is remembered.** Sidebar and panel widths, open folders, and recent files are right where you left them.

### Speed and connection

- **Honest about slow and offline.** You see “Saved page · offline” or how much has arrived, with a Retry if a page stalls.
- **Quiet loading.** Loading cues wait a beat before appearing, and turn their motion off if you prefer reduced motion.
- **Shortcuts work right away.** Press ⌘K while the page is still starting up and the palette opens as soon as it’s ready.

### Search, sharing, and publishing

- **Search stays in step.** A slow answer for an old search never replaces the one you just ran.
- **One-tap markdown handoff.** Copy a page as markdown with a single click and a check-mark. What you copy is already redacted.
- **Publishing you can trust.** A dry run first, an explicit flag for deletions, and success reported only after the pages are live.

### Safe and accessible

- **Checked for accessibility.** Automated checks run over the reader, search, comments, and viewers in light and dark.
- **Private by default.** Signed-in pages are never cached, sensitive pages are never indexed, and crawlers are told to stay out.

## Have your agent build your own knowledge base.

Use Oncobase as it is, or let your agent borrow from it while it builds yours. It’s MIT licensed, so use any part of the code any way you like.

- **Publish from a vault.** Write in an Obsidian-style folder of markdown and publish with one command. Only changed files upload. Where: Terminal. Interface: `oncobase publish`.
- **Dry runs and safety rails.** check shows what would change, tombstones need an explicit flag, dirty trees are refused, and uploads are verified by reading them back. Where: Terminal. Interface: `oncobase check`.
- **Sync.** Pull remote content into the vault without overwriting your edits; differences are set aside for review. Where: Terminal. Interface: `oncobase sync`.
- **Embeddings.** Publishing computes search embeddings so semantic search works the moment a page goes live. Where: Terminal. Interface: `oncobase publish --embeddings`.
- **Research helpers.** Literature and clinical-trial search with provenance, and audio-to-note transcription. Where: Terminal. Interface: `oncobase elicit, oncobase transcription`.
- **Agent skills.** Skills for first-time setup and safe pre-publish checks ship with the CLI and copy into your vault. Where: Terminal. Interface: `oncobase skills`.
- **Local stack.** A self-hosted backend, seeded site, and smoke test on your machine, with no cloud account. Where: Terminal. Interface: `bun run local:stack`.
- **Open source.** MIT licensed. Run it on Vercel and Convex or with the standalone Bun server. Where: GitHub.

### Start

```
oncobase init --site my-site --vault ./vault --publish-url https://my-site.example
oncobase skills
oncobase check
oncobase publish --embeddings auto
```

### Interfaces

Auth: Gate = the site's shared-password cookie; Session = an account cookie; Publish token = `Authorization: Bearer wpt_…`; Public = none.

### Pages, files, and downloads

| Name | Kind | What it does | Auth |
| --- | --- | --- | --- |
| `GET /api/wiki/manifest` | API | File tree, page index, and asset index with ETag | Gate |
| `GET /api/wiki/pages?slugs=` | API | Page bodies, redacted for the viewer | Gate |
| `GET /api/page-copy?slug=` | API | A page as a markdown download | Gate |
| `GET /api/download?type=` | API | The whole wiki as a zip | Gate |
| `GET /api/file?path=` | API | A PDF, image, or data file, with range requests | Gate |
| `GET /api/education/*` | API | The public guides: manifest, pages, search, files | Public |

### Search, chat, and agent tools

| Name | Kind | What it does | Auth |
| --- | --- | --- | --- |
| `GET /api/search?q=` | API | Exact-text search with line hits | Gate |
| `POST /api/ai-search` | API | Semantic search with relevance scores and summaries | Gate |
| `POST /api/chat` | API | Streaming agent chat with citations | Gate |
| `POST /api/tools` | API | Run search_wiki, read_page, get_pages_by_tag, list_tags, list_pages | Gate |

### Clinical data

| Name | Kind | What it does | Auth |
| --- | --- | --- | --- |
| `GET /api/timeline` | API | The diagnostics timeline data | Gate |
| `/api/dicom/*, /api/pathology/*` | API | Imaging catalogs, bytes, annotations, and slide tiles | Gate |

### Publish and build

| Name | Kind | What it does | Auth |
| --- | --- | --- | --- |
| `POST /api/publish/*` | API | The publish protocol the CLI speaks | Publish token |
| `oncobase init | sync | check | publish` | CLI | Set up a vault and run the publish loop | Publish token |
| `oncobase skills` | CLI | Copy the bundled agent skills into your vault | None |
| `oncobase elicit | transcription` | CLI | Literature, trials, and audio-to-note helpers | Service keys |
| `bun run local:stack` | Script | A complete local backend with seeded data | Local |

## Not available today

Sorting or filtering inside tables, and an MCP server.
