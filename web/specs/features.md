# Web App Feature Spec

Current-state feature inventory for the `web` app, based on the implementation in `src/app`, `src/components`, `convex/`, and the existing end-to-end tests.

This document focuses on shipped behavior and notable implementation details. Detailed comments behavior still lives in [comments.md](./comments.md).

## Multi-site model

The app is a multi-site wiki publishing platform. Diana is site #1; additional sites share the same Next.js deployment, Convex deployment, Blob store, and codebase, with isolation enforced in code. The full contract lives in [multi-site.md](./multi-site.md). Key points:

- The proxy resolves the active site from the `Host` header on every request and sets `x-site-slug` on the forwarded request. Client-supplied `x-site-slug` is overwritten.
- Every public Convex function takes an optional `siteSlug` and threads it through the `requireSite` helper. ESLint bans raw `ctx.db.query(` outside the helper.
- Diana's content is rendered through the sibling `obsidian/` tree at static-generation time during the migration window; new sites publish into Convex via `bun run wiki:publish` and serve from there. Both paths coexist; the cutover that retires the fs path is documented in [plans/multi-tenant-wiki/work-log.md](../../plans/multi-tenant-wiki/work-log.md).
- `/api/file`, `/api/search`, downloads, comments, chat — all Convex-backed and site-scoped via `requireSite`.

## Product Surface

- The app is a password-gated wiki and research workspace. For Diana the content tree is the sibling `obsidian/` directory; for new sites it is Convex (populated by the publisher CLI).
- Primary route surfaces:
  - `/` renders `index.md`
  - `/[...slug]` renders markdown pages and redirects `.pdf` and `.md` URL variants
  - `/search` provides text and AI search
  - `/chat`, `/chat/[id]`, `/chat/archived` provide the research assistant when chat is enabled
  - `/comments` provides the global comments timeline when comments are enabled
  - `/tags/[tag]` provides tag archive pages
  - `/login` handles the site password gate
- Desktop layout uses a header, a resizable left sidebar, and a main content pane.
- Mobile layout replaces the persistent sidebar with a bottom-sheet navigator and safe-area-aware spacing.

## Core Features

### Wiki Browsing And Navigation

- The sidebar is generated directly from the Obsidian vault and includes both markdown pages and PDFs.
- Directory nodes auto-open for the active route; file nodes highlight the current page.
- PDF entries open in a new tab through `/api/file?path=...`.
- The header includes:
  - a search form that pushes to `/search?q=...`
  - a file palette button
  - an actions menu for download, theme, and account actions
- Document pages show:
  - page title
  - tag pills linked to `/tags/[tag]`
  - a copy-to-clipboard button for the page markdown
- The app includes redirect rules for legacy wiki slugs and moved source pages.
- The middleware adds a site-wide password gate with:
  - `authed=true` cookie persistence
  - a `?token=<password>` magic-link shortcut that sets the cookie and strips the query param

### File Palette And Command Palette

- The file palette is implemented as a global command dialog that fetches the full page list from `/api/pages` on first open.
- It supports:
  - fuzzy file search with `fuzzysort`
  - recent files stored in local storage
  - grouped browsing by top-level path when no query is present
  - direct navigation to a selected page
- Current keyboard bindings in code:
  - file palette: `Cmd/Ctrl+K` and `Cmd/Ctrl+O`
  - action palette: `Cmd/Ctrl+Shift+K`
- The action palette includes:
  - theme switching between light, dark, and system
  - wiki downloads for full zip and markdown-only zip
  - navigation shortcut to `/search`
- The header button label currently advertises `⌘P`, but the implemented shortcut listener uses `K` and `O`.

### Markdown Rendering

- Static wiki pages use a server-side markdown pipeline built with `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-raw`, `rehype-slug`, and `rehype-stringify`.
- Chat and streaming contexts use a separate client-side markdown renderer with `react-markdown`.
- The renderer supports:
  - GitHub-flavored markdown tables, task lists, and formatting
  - raw HTML in markdown
  - heading IDs for deep links
  - Obsidian `[[wikilinks]]` and `[[wikilink|labels]]`
  - relative PDF wikilinks resolved to `/api/file`
  - `.md` link cleanup so rendered links use slug routes instead of raw filenames
  - relative image/file proxying for supported assets
- The renderer rewrites inline PDF links into styled PDF chips with a document icon and external-link affordance.
- Server-side markdown redaction supports inline `<redact ...>...</redact>` spans and `:::redact ... :::` blocks so patient identifiers stay hidden by default across rendering, search, chat context, and exports. Detailed behavior lives in [pii-redaction.md](./pii-redaction.md).

### Mermaid And Diagrams

- Fenced ```` ```mermaid ```` blocks are rendered server-side with `beautiful-mermaid`.
- Both light and dark SVG variants are generated up front and toggled with CSS based on the active theme.
- Mermaid failures fall back to a readable error block that shows the graph source.
- Diagram containers are horizontally scrollable and theme-aware.

### Tables

- All rendered tables are wrapped in a horizontal scroll container before hydration so wide tables are usable immediately.
- Tables use a content-aware client layout pass that balances column width against row height instead of relying on hand-authored column width comments.
- Client-side enhancement adds:
  - expand/collapse controls
  - column resize handles on header cells that lock the current layout after manual adjustment
  - automatic expansion for tables that materially overflow their container
  - overflow detection with a right-edge gradient hint

### Search

- `/search` is a client page with two modes:
  - `AI Mode` is the default tab
  - `Text Search` is the secondary tab
- Text search behavior:
  - scans markdown files from disk
  - matches by line with line numbers
  - groups results into a directory/file tree
  - highlights matched text inside snippets
  - reports total matches and matched files
- AI search behavior:
  - waits for text search to finish
  - merges text-derived candidate slugs with Convex vector search candidates
  - scores candidates with an LLM and returns relevance plus a short summary
  - still works when text search finds no initial candidates because vector search runs on the server
- Search states covered in the UI:
  - empty prompt
  - searching/loading
  - ranked results
  - no results
  - API error

### Chat With Wiki

- Chat is behind `NEXT_PUBLIC_ENABLE_CHAT`. When disabled, `/chat` redirects to `/`.
- The reusable chat feature lives in `packages/chat`; Diana-specific prompts,
  generated Convex refs, markdown transforms, tool UI, and suggested prompts are
  configured from the web app. See [chat-package.md](./chat-package.md).
- Chat routes:
  - `/chat` starts a new conversation
  - `/chat/[id]` reopens an existing conversation
  - `/chat/archived` lists archived conversations with restore actions
- Conversation data is stored in Convex:
  - conversation title
  - message history
  - archived state
  - streaming text and streaming parts for in-flight responses
- New conversations are created from the first prompt, and the title is derived from that prompt.
- Chat responses stream through `/api/chat` and are mirrored into Convex during generation so the UI can recover state across reloads.
- The streaming model has access to tools for:
  - `search_wiki`
  - `read_page`
  - `list_pages`
  - `get_pages_by_tag`
  - `list_tags`
- The system prompt instructs the assistant to cite wiki pages inline with markdown links.
- The chat UI supports:
  - starter prompt chips on an empty conversation
  - a growing textarea composer
  - `Enter` to send and `Shift+Enter` for a newline
  - a `Stop` button while generation is active
  - stale-stream cleanup after 30 seconds without updates
  - auto-resume when the last active user message exists without a running stream
  - collapsible reasoning blocks
  - inline tool call badges for search/read actions
  - source page pills extracted from tool outputs
  - copy-as-markdown and copy-link actions
  - archive actions in both the sidebar dropdown and the chat footer
  - a per-message edit affordance that re-seeds the composer from a prior user message

### Comments

- Comments are enabled by default. `NEXT_PUBLIC_ENABLE_COMMENTS=false` is the
  global kill switch; per-site `enableComments` and Liveblocks credentials are
  enforced by the server routes.
- Document pages render the Liveblocks comment UI through `DocumentComments`.
- Supported comments behavior includes:
  - page-level comments
  - text-selection-anchored comments
  - per-document comment sidebars
  - a global comments timeline at `/comments`
  - signed-in and guest identities
- Detailed behavior is documented in [comments.md](./comments.md).

### Tags

- Document frontmatter tags render as pills on document pages.
- Tag archive pages are statically generated from the current markdown corpus.
- Tags are normalized case-insensitively when indexing pages.

### Downloads, Files, And Sharing

- `/api/file` serves PDFs, CSVs, and common image formats.
- Asset serving supports two backends:
  - local disk during local development
  - Convex metadata plus blob proxying in production
- The file route rejects unsupported file types and guards against path traversal.
- `/api/download` supports:
  - `type=full` for the full wiki archive
  - `type=markdown` for markdown-only export
- Download actions are exposed from both the actions menu and the action palette.
- The app also exposes smaller sharing/copy features:
  - copy page markdown
  - copy chat markdown
  - copy chat URL
  - copy comment text in the comments UI

### Theming

- The app supports:
  - light mode
  - dark mode
  - system theme following `prefers-color-scheme`
- Theme changes are available from both the actions menu and the action palette.
- Theme preference is stored in local storage and applied before hydration with a `beforeInteractive` script to avoid a flash of the wrong theme.
- Styling is driven by CSS custom properties in `globals.css`, including shared tokens for:
  - page background and foreground
  - sidebar chrome
  - brand and accent colors
  - shadcn semantic variables
- Mermaid rendering is theme-aware because the server emits both light and dark SVG variants.
- Liveblocks UI colors inherit the app theme through CSS variable overrides.

### Access, Auth, And Identity

- There are two separate auth layers:
  - a simple site password gate enforced by middleware
  - optional account auth flows for user identity and future saved features
- Optional account auth supports:
  - sign in and sign out from the actions menu
  - account creation through the auth API for operator and test flows
  - persistent session cookies
- Role-based access permissions are account-based and site-scoped:
  - `/admin/access` creates roles and assigns them to site users
  - each role grants include/exclude path-prefix and tag-filtered permissions such as including `sources/private/*` while excluding a public-summary path or tag
  - public source pages render before RBAC is consulted
  - protected source pages return 404 unless the signed-in user has a matching role
- Liveblocks comments use either:
  - authenticated users resolved through Convex
  - a persistent guest identity stored in a cookie, local storage, and Convex so other users can resolve the display name

## Responsive And Mobile Behavior

- Below `md`, the desktop sidebar is removed from the layout.
- Mobile navigation uses a bottom-fixed trigger that opens a scrollable bottom sheet with:
  - page title
  - top-level links
  - file tree or conversation list
- Mobile layout uses safe-area padding for the bottom navigation and chat composer.
- Hover-only heading anchors are disabled on non-hover devices.
- Tables and Mermaid diagrams preserve horizontal scroll on small screens.
- The chat UI reduces padding and button sizes for narrow viewports.
- The comments implementation uses a single fixed bottom rail for comments and outline below `lg`; on phones it sits above the bottom navigation, and on iPad widths it pins to the viewport bottom.

## Persistence And Saving

### Local Storage

- `theme`
  - persisted theme preference
- `sidebar-width`
  - desktop left sidebar width, including collapsed state
- `cmd-palette-recent`
  - recently opened files for the file palette
- `liveblocks_guest`
  - guest comments identity
- comments pane keys in the comments UI
  - right-pane open/collapsed state
  - comments pane width

### Cookies

- `authed`
  - site password gate session
- `wiki_user_session`
  - account auth session
- `liveblocks_guest`
  - guest comments identity mirror

### Convex Persistence

- `documents`
  - markdown content, tags, descriptions, embeddings
- `messages` and `conversations`
  - chat history, streaming state, archived state
- `meta`
  - download cache metadata
- `pdfAssets` and `fileAssets`
  - production asset lookup

### Other Persistence

- Rendered markdown HTML is cached on disk in `.next/cache/markdown`.
- Full and markdown-only download archives are cached into public blob storage and memoized in Convex metadata.

## Next.js And Vercel Architecture

### App Router And RSC Boundaries

- The app uses Next.js App Router with route groups for `(auth)` and `(main)`.
- Server-component-first areas:
  - home page
  - document pages
  - tag pages
  - root and main layouts
- Client-heavy areas:
  - search page
  - chat interface
  - command and action palettes
  - sidebar behavior
  - bottom navigation
  - comments UI

### Static Generation And On-Demand Rendering

- Most markdown pages are pre-rendered through `generateStaticParams()`.
- `sources/` pages are intentionally deferred to on-demand ISR to cut build time.
- Metadata generation batch-loads descriptions from Convex so build-time metadata does not issue one request per page.
- Tag pages are statically generated from the current tag set.

### Build And Deploy Flow

- The Vercel build runs:
  - `bun install`
  - `convex deploy`
  - wiki ingestion and PDF ingestion scripts
  - `next build`
- `next.config.ts` also configures:
  - legacy redirects
  - output tracing root for the monorepo shape
  - output tracing exclusions for large asset directories
  - `withWorkflow(...)` integration for Vercel Workflow
- After deploy, a parent workflow launches durable child workflows for:
  - full download cache generation
  - markdown-only download cache generation
  - AI page descriptions
  - embeddings ingestion

## Performance And Loading Notes

### Build-Time Optimizations

- Deferred static generation for `sources/` pages reduces pre-rendered page count substantially.
- Module-level caches in `lib/markdown.ts` reduce repeated file reads for:
  - slug listing
  - tag listing
  - tag page generation
  - parsed markdown files
- Metadata generation batches description reads through a shared promise cache.
- Rendered markdown is cached on disk with a pipeline version key.

### Runtime Optimizations

- The conversation list is lazy-loaded in both desktop and mobile nav.
- The file palette fetches pages only once, on first open.
- AI search waits for text search to complete before firing its ranking request.
- Chat streaming flushes partial results to Convex on an interval instead of on every token.
- Chat auto-scroll avoids smooth-scroll overhead during active streaming.
- Download requests take a fast path when a fresh cached blob already exists.

### Loading States

- Search shows empty, loading, result, no-result, and error states.
- Chat shows waiting dots before first streamed text, streaming UI while generating, and explicit error banners for connection/API failures.
- Archived chats and conversation list show loading placeholders.
- The file palette shows a loading state while page entries are fetched.

## Feature Flags And External Dependencies

- `NEXT_PUBLIC_ENABLE_CHAT`
  - enables or disables the chat product surface
- `NEXT_PUBLIC_ENABLE_COMMENTS`
  - optional global kill switch; set to `false` to disable the comments product surface
- `NEXT_PUBLIC_CONVEX_URL`
  - powers chat persistence, document queries, metadata, and production asset lookup
- `AI_GATEWAY_API_KEY`
  - required for chat responses and AI-generated page descriptions (Vercel AI Gateway)
- `OPENAI_API_KEY`
  - required for embeddings and semantic search
- `LIVEBLOCKS_SECRET_KEY` or `LIVEBLOCKS_API_KEY`
  - required for authenticated comments mode
- `PUBLIC_BLOB_READ_WRITE_TOKEN`
  - enables deploy-time archive cache generation
- `VERCEL_DEPLOYMENT_ID`
  - used to validate cached download artifacts per deploy

## Notes And Caveats

- The chat and comments navigation entries are both exposed in the sidebar when
  their product surfaces are active; comments can still fail closed per site if
  Liveblocks is not provisioned.
- The file palette and action palette keyboard listeners currently differ from some user-facing labels and comments in the code.
- This document describes the implementation as it exists today, including gated and partial behaviors, rather than a future roadmap.
