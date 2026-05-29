# Changelog

This changelog tracks improvements to the web wiki experience in `apps/web/`. Each
entry links to the relevant GitHub commit set. It covers committed history
through `3569fe4c` on 2026-04-20; uncommitted work is not included.

## 2026-04-18 to 2026-04-20 - Header paint, previews, routing, and anchors

Commit set: [d8401c6d...3569fe4c](https://github.com/jasonLaster/oncobase/compare/d8401c6d...3569fe4c)

- Preserved the initial header paint and added page-load regression coverage.
- Adjusted wiki routing around the root index restructure.
- Added another pass of heading anchor behavior for wiki pages.
- Fixed link preview metadata and added share-preview routing coverage.
- Added outline button highlight states in the comments/sidebar UI.

## 2026-04-17 - Navigation cleanup and dynamic PDF sidebar

Commit set: [4ed8ecf2...d8401c6d](https://github.com/jasonLaster/oncobase/compare/4ed8ecf2...d8401c6d)

- Fixed web build and routing fallout from moving top-level wiki files.
- Added root redirect behavior for the wiki index.
- Made markdown headings tappable anchor targets.
- Cleaned up outline labels that included trailing heading anchor hashes.
- Made the sidebar PDF tree dynamic.

## 2026-04-16 - Static rendering and smart tables

Commit set: [805a82f4...4ed8ecf2](https://github.com/jasonLaster/oncobase/compare/805a82f4...4ed8ecf2)

- Removed `dynamicParams` usage that conflicted with `cacheComponents`.
- Restored fully static rendering for regular document pages.
- Added Suspense streaming for ISR source pages only.
- Extracted a cached document header and made the layout more static-cache
  friendly.
- Streamed the sidebar PDF tree from a static sidebar shell.
- Built smart prose table expansion with overflow-only auto-expansion,
  long-header wrapping, narrow-viewport fallback behavior, pinned overflow fades,
  QA coverage, and shared fixtures.
- Extracted the smart table package and fixtures for reuse.

## 2026-04-15 - Reader, chat, search, and PPR polish

Commit set: [4eba17e1...805a82f4](https://github.com/jasonLaster/oncobase/compare/4eba17e1...805a82f4)

- Moved the find-files button next to search and made the search affordance more
  prominent.
- Improved mobile reader spacing, heading anchor placement, and chat layout.
- Redesigned chat from bubble-style messages to a flatter reader-friendly layout.
- Improved chat retrieval for treatment-plan and other core wiki pages.
- Added a chat button to the header and cleaned up competing chat-streaming
  progress indicators.
- Added async markdown rendering with Suspense and diagnostic timing logs.
- Enabled Partial Prerendering via `cacheComponents`.
- Migrated model access from OpenRouter to Vercel AI Gateway.
- Added PDF sidebar styling, Convex-backed PDF fetching, and Git LFS pointer
  skipping for served/listed PDFs.

## 2026-04-14 - Comments, command palette, diagrams, and table rendering

Commit set: [b8cb57ce...4eba17e1](https://github.com/jasonLaster/oncobase/compare/b8cb57ce...4eba17e1)

- Added Mermaid rendering for wiki pages, then moved to server-side diagram
  rendering with GitHub light/dark themes.
- Fixed Mermaid UTF-8 decoding, responsive SVG behavior, and theme styling.
- Added Liveblocks comments to markdown pages.
- Restored the right sidebar as outline-only when comments are disabled.
- Split the command palette into file search and action command modes.
- Improved command-palette shortcut detection and added fuzzysort with recent
  files.
- Fixed stale markdown cache behavior by using a content hash.
- Added source-aware PDF chips and sidebar PDF label cleanup.
- Fixed table resize overlap and made tables fill the prose width.

## 2026-04-13 - Metadata, source assets, deploy workflows, and table directives

Commit set: [d4e0ebe1...b8cb57ce](https://github.com/jasonLaster/oncobase/compare/d4e0ebe1...b8cb57ce)

- Added post-deploy workflows for cache warming, embedding ingestion, metadata,
  and description generation.
- Added per-page Open Graph and Twitter metadata with generated descriptions.
- Moved slower ingestion and description work out of the critical build path.
- Hardened YAML/frontmatter parsing for malformed wiki files.
- Reduced static generation scope with ISR deferral and file caching.
- Served `.md`, `.pdf`, images, CSVs, and other source assets through web routes.
- Added PDF listing in the sidebar, public Blob usage, and `/api/file` proxying.
- Added e2e coverage for sidebar PDFs and file serving.
- Added table cell wrapping, `table-cols` directives, blank-line tolerance,
  natural horizontal scrolling, and renderer-side colgroup injection.

## 2026-04-12 - Downloadable wiki archives

Commit set: [7f469a88...d4e0ebe1](https://github.com/jasonLaster/oncobase/compare/7f469a88...d4e0ebe1)

- Added dual wiki download options.
- Added on-demand streaming ZIP generation with Blob caching.
- Served cached archives through public Blob redirects.
- Added markdown-only download support in the actions menu.
- Reworked the download route to fix server errors and cache markdown archives.
- Optimized archive building by fetching PDF streams in parallel, buffering PDF
  content safely, and eliminating N+1 document lookups.

## 2026-04-09 to 2026-04-11 - Mobile reader, vector search, and ingest resilience

Commit set: [539317d4...7f469a88](https://github.com/jasonLaster/oncobase/compare/539317d4...7f469a88)

- Added magic-link login support, including `?token=` handling on any URL.
- Overhauled mobile UX with bottom navigation, table scrolling, and header
  cleanup.
- Fixed duplicate chat responses and polished the chat UI.
- Cleaned up the command palette for both mobile and desktop.
- Added vector search to AI mode and an AI search eval for question-oriented
  queries.
- Increased ingest limits and added resilience for very large wiki documents.

## 2026-04-07 to 2026-04-08 - Search, deploy ingest, and table compatibility

Commit set: [cd82e841...539317d4](https://github.com/jasonLaster/oncobase/compare/cd82e841...539317d4)

- Fixed the search page and chat UI around Suspense boundaries.
- Improved wiki search with a dual index and better tool prompting.
- Added wiki ingest and ZIP build scripts for Vercel deploys.
- Gracefully skipped wiki ingestion when `CONVEX_URL` is unavailable.
- Slimmed the download route to redirect to a static ZIP.
- Added download and copy actions.
- Added shadcn-based resizable tables with a full-bleed expand toggle.
- Fixed Convex ingest and query-size issues with Bun-based scripts, non-fatal
  embedding ingestion, stale-document removal fixes, and paginated queries.
- Made the markdown renderer a server component with client islands.
- Added AI-mode search e2e tests with mocked API responses.

## 2026-04-06 - Chat, header search, anchors, and reader polish

Commit set: [9e4c07ff...cd82e841](https://github.com/jasonLaster/oncobase/compare/9e4c07ff...cd82e841)

- Added the first AI research assistant chat page with wiki tool calling.
- Added a global header with centered search, chat link, and theme toggle.
- Improved chat with conversation management, client-side streaming, Convex
  subscriptions, stop/edit controls, scroll-to-bottom behavior, disabled states,
  stale-stream detection, and production safeguards.
- Added anchor links to markdown headings for shareable section URLs.
- Added early resizable table and web reader fixes.
- Fixed chat build issues around dynamic routes, missing Convex configuration,
  hydration, and React lint constraints.

## 2026-04-05 - Command palette, auth flow, and theme support

Commit set: [39702852...9e4c07ff](https://github.com/jasonLaster/oncobase/compare/39702852...9e4c07ff)

- Added shadcn UI, the first command palette, tag pages, and CSS variable cleanup.
- Improved sidebar and palette behavior.
- Added login redirect flow to preserve the original wiki URL.
- Wrapped login `useSearchParams` usage in a Suspense boundary.
- Added light, dark, and system theme support with flash prevention.
- Improved linting and citation/link compatibility for wiki rendering.

## 2026-04-04 - Web wiki foundation

Commit set: [fc16c8a...39702852](https://github.com/jasonLaster/oncobase/compare/fc16c8aac849827dd8fd83e429fd11868ccdd210...39702852)

- Folded wiki material into the app's `wiki/` and `sources/` structure.
- Fixed URL-encoded slug routing.
- Added mobile-friendly sidebar behavior.
- Fixed Vercel build conflicts, mobile drawer behavior, and duplicate title
  rendering.
- Added terminology anchors and the first link-checking workflow for wiki pages.

## Maintaining This File

- Add new entries as milestone ranges, not one commit at a time.
- Add newer milestones near the top, below the introduction.
- Keep bullets focused on the web wiki: rendering, routing, navigation, search,
  chat, comments, tables, downloads, source serving, ingest, deployment, and
  performance.
