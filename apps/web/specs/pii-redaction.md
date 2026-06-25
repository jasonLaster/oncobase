# PII Redaction Spec

Server-side markdown redaction and page-level sensitivity controls for patient-identifying content across wiki rendering, search, chat context preparation, Claude Code maintenance, and exports.

## Goals

- Let authors mark sensitive spans directly in markdown with a small, readable syntax.
- Let authors tag an entire page as sensitive when the page, its attachments, or its surrounding context should be hidden from broad/guest access.
- Hide redacted content by default everywhere the web app reads markdown.
- Keep hidden content and sensitive pages out of rendered HTML, text search, AI/chat context assembly, Claude Code wiki updates, and downloadable markdown archives.
- Allow intentional reveal for admin account page rendering without weakening the default server-side protection boundary.
- Add vault linting so obvious patient identifiers can be found and redacted before they leak into the app.

## Non-Goals

- Client-side criteria checks; matching sensitive include criteria must be decided server-side before rendering.
- Automatic NLP-based redaction of arbitrary identifiers.
- Client-only hiding of already-rendered sensitive content.
- Retroactive cleanup of previously generated embeddings in this change set.

## Authoring Syntax

### Inline redaction

Use inline tags when only a short span should be hidden:

```md
The patient is <redact label="the patient">Diana Laster</redact>.
MRN: <redact>[internal MRN]</redact>
```

Use `fallback` as the replacement text when the span should be visible only for
a matching sensitive include criterion:

```md
Partner detail: <redact sensitive-include="serova" fallback="">Serova-only note</redact>
```

Default render:

```md
Partner detail:
```

Render when the server passes a matching `serova` criterion:

```md
Partner detail: Serova-only note
```

Default render:

```md
The patient is the patient.
MRN:
```

Admin account render:

```md
The patient is Diana Laster.
MRN: [internal MRN]
```

### Block redaction

Use fenced block redactions when an entire multi-line section should disappear by default:

```md
:::redact[Patient identifiers hidden.]
**Patient:** Diana Laster
**DOB:** 12/11/1989
**MRN:** 88855655
:::
```

Default render keeps only the optional label:

```md
Patient identifiers hidden.
```

Reveal render returns the original block body.

### Page-level sensitivity

Use page-level sensitivity when the entire page should be unavailable to guests, search, chat, download archives, and Claude Code wiki maintenance.

Preferred frontmatter:

```md
---
title: Private case notes
sensitive: true
---
```

Tag-based authoring is also supported:

```md
---
title: Private case notes
tags:
  - sensitive
---
```

- `sensitive: true`, `sensitive: 1`, `sensitive: yes`, and `sensitive: on` are truthy, case-insensitive values.
- The tag form requires the exact tag `sensitive`; nearby tags such as `sensitivity-analysis` or `not-sensitive` must not mark a page sensitive.
- Page-level sensitivity is for whole-page privacy. Use inline or block redaction when the page can stay public after hiding only specific spans.

## Behavioral Contract

### Default mode: `redacted`

This is the safe baseline and must be used unless a route explicitly opts into reveal behavior.

- Inline `<redact>` spans are removed from output.
- Inline spans with `label="..."` render the label instead of the hidden content.
- Inline spans with `fallback="..."` render the fallback instead of the hidden content.
- Inline spans with `sensitive-include="..."` reveal their body only when the server-side render call passes a matching include criterion; otherwise they render their fallback or disappear.
- `:::redact ... :::` blocks are removed from output.
- Block labels render as replacement text in place of the hidden block.
- Block redactions may also use `fallback="..."` and `sensitive-include="..."` on the opening marker.
- Known high-risk literals still get fallback replacement even if they were not explicitly wrapped.

### Reveal mode: `revealed`

This mode is only for request-time document page rendering after the server verifies that the account session belongs to an admin user.

- Inline and block redactions emit their original content.
- Fallback replacements are disabled.
- Reveal uses the raw stored page body, but it does not modify indexed/exported content.

### Query param

- Query param name: `showPII`
- Truthy values: `1`, `true`, `yes`, `on` (case-insensitive).
- Falsey or missing values, including `0`, `false`, `off`, and an empty `showPII`, must keep default redaction.
- `showPII` is not sufficient by itself; raw content reveal requires an admin account session.
- The proxy must not rewrite `showPII` requests into a reveal route; query params stay harmless unless an admin-authenticated document renderer is already allowed to read raw content.
- Search, ingest, AI/chat context preparation, and download routes ignore the reveal param and stay redacted.
- Markdown suffix handling, casing fixes, and route aliases must not turn a query parameter into raw-content access.

### Fallback replacements

Fallback replacements are a defense-in-depth layer for older content that has not yet been wrapped in explicit redaction syntax.

- Fallbacks run only in default `redacted` mode.
- Fallbacks replace known high-risk names, MRNs, DOBs, and email addresses, including case variants found in imported source documents.
- Fallbacks must not run in `revealed` mode, because the caller intentionally requested the raw page render.
- Explicit exceptions for known non-patient strings must remain stable so unrelated people are not accidentally renamed.
- Public redaction labels must not mention the reveal query parameter.

### Caching and routing

- Admin raw page reads must not pollute the shared redacted page cache.
- The default document routes must remain the redacted/static path.
- Direct `/pii-view/...` requests must require an admin account session before rendering.
- API routes must not be rewritten by `showPII`; they remain redacted by construction.

### Sensitive pages

Sensitive pages are hidden by default from every broad discovery surface.

- Guests and shared-password visitors receive a 404 for direct page requests to sensitive pages.
- `showPII` does not grant access to sensitive pages; a guest request with `?showPII=1` still receives a 404.
- Signed-in account users may load a sensitive page directly and may see it in account-scoped page lists/file trees.
- Sensitive pages must not appear in the sidebar/file tree, page picker, static route params, tag pages, public metadata, share previews, search, AI chat context, downloadable archives, or asset listings for guests.
- Sidecar files with the same stem as a sensitive markdown page inherit sensitivity. For example, `Case.md` makes `Case.pdf` unavailable to guests and excludes it from broad downloads and asset lists.
- Liveblocks rooms and comments for sensitive pages are unavailable to guests; guest auth, comment creation, thread deletion, and thread listings must hide or reject sensitive rooms.

## Security Boundary

The feature must remain server-side first.

- Raw markdown is never sent to the client when the request is in default mode.
- Raw markdown may be stored alongside the redacted copy, but Convex may return it only after validating an admin account session token hash.
- Search indexes/snippets are computed from redacted markdown, not from rendered DOM text.
- Download archives rebuild markdown from the server-side redacted reader instead of zipping raw `.md` files from disk.
- Download archives may be built from local disk, Convex records, or prebuilt Blob cache entries; every included markdown entry must be redacted regardless of source.
- Chat and AI-search context assembly must consume redacted markdown so hidden content is excluded before any model call.
- Admin raw reveal must be read at request time and passed only to the page-level markdown loader; it must not mutate shared caches, search data, downloads, or AI context.
- Sensitive pages are excluded before search, vector retrieval, tool responses, chat context assembly, and archive generation.
- Convex public document reads must filter sensitive documents from `getBySlug`, search, vector search, page lists, content lists, descriptions, embedding status, and embedding upserts.
- Tool routes such as wiki search, page reads, page lists, and tag lookups must not expose sensitive pages to guests or chat workflows.
- Local markdown search must skip sensitive source files instead of relying only on redaction.
- Claude Code wiki-maintenance instructions must tell agents not to read, search, summarize, cite, or use sensitive pages unless the user explicitly confirms that page-level sensitive material is in scope.
- Public Blob URLs cannot be made private retroactively if a URL has already leaked; newly sensitive sidecar assets must be excluded from future route responses, asset lists, archives, and ingest outputs, and leaked Blob objects should be rotated or removed as a follow-up.

## Implementation Plan

### Shared redaction utility

`src/lib/pii-redaction.ts`

- Parse block redactions with `:::redact[optional label] ... :::`
- Parse inline redactions with `<redact label="optional label">...</redact>`
- Parse `fallback` and `sensitive-include` attributes on redaction tags and block markers
- Normalize whitespace after removals so documents do not accumulate blank gaps
- Apply conservative fallback replacements for known patient identifiers that still exist in older source material
- Expose `shouldShowPii()` and `SHOW_PII_QUERY_PARAM`

### Shared sensitivity utility

`src/lib/sensitive-pages.ts`

- Parse frontmatter for page-level sensitivity
- Treat exact `sensitive` tags as sensitive markers
- Support truthy frontmatter values consistently with other explicit opt-in flags
- Keep sensitivity parsing centralized so markdown, ingestion, asset routes, and tests share the same behavior

### Markdown loading

`src/lib/markdown.ts`

- Add an admin-only raw-content read option to markdown reads
- Add `includeSensitive` options to discovery/read helpers whose callers are allowed to see sensitive pages
- Store redacted content for public reads, search, chat, downloads, and sync
- Bypass the shared document cache for admin raw reads so role changes are not hidden by a cached raw page body
- Exclude sensitive pages from default slugs, file trees, and PDF/file sidecar discovery
- Expose helpers for checking whether a markdown slug or Obsidian-relative sidecar path is sensitive

### Rendering

`src/app/(main)/page.tsx`
`src/app/(main)/[...slug]/page.tsx`
`src/app/(main)/pii-view/[...slug]/page.tsx`
`src/proxy.ts`

- Keep default page routes on the normal redacted markdown reader.
- Do not rewrite `showPII` in the proxy; reveal branching must happen after the account-admin check.
- Let the document renderer request raw content only after checking that the signed-in account is an admin.
- Keep `/pii-view/[...slug]` admin-only for direct requests.
- Keep API routes unbranched by `showPII` so downloads and other server endpoints cannot be flipped by query string.
- Return 404 for sensitive page requests from guests and shared-password visitors.
- Let signed-in account sessions view sensitive pages through the normal document page renderer.
- Apply `noindex,nofollow` metadata to sensitive pages and avoid leaking sensitive titles/descriptions to guests.

### Search and AI context

`src/lib/search.ts`
`src/app/api/ai-search/route.ts`
`src/app/api/chat/route.ts`
`scripts/eval-*.ts`

- Ensure all search snippets and AI/chat context use redacted markdown
- Remove hardcoded patient-name examples from prompts and evaluation scripts
- Skip sensitive pages from local search, Convex search, vector search, page-read tools, page-list tools, and tag lookups used by chat.

### Downloads and ingestion

`src/lib/archive-helpers.ts`
`src/app/api/download/route.ts`
`src/workflows/build-download-cache.ts`
`scripts/ingest-wiki.ts`

- Skip raw markdown files when archiving from disk
- Re-append markdown from redacted server reads
- Ingest redacted markdown into stored document records so later consumers inherit the safe form
- Store a `sensitive` flag on ingested document records
- Exclude sensitive markdown and inherited-sensitive sidecar files from archives, asset ingest, PDF ingest, and public asset routes

### Vault maintenance skills

Vault-local maintenance guidance, for example `.claude/skills/*` or
`.agents/skills/*`, should:

- Document the page-level sensitivity syntax
- Instruct Claude Code not to read, search, summarize, cite, ingest, or use sensitive pages by default
- Require explicit user confirmation before a maintenance task includes sensitive pages

### Vault hygiene

Vault-local lint tooling, for example `.agents/skills/lint/check-pii.ts`, should:

- Add focused vault lint for high-risk identifiers and fields
- Ignore content already wrapped in redact blocks
- Use it to drive a first-pass manual redaction of high-traffic wiki and source files

## Acceptance Criteria

- A page containing inline redactions does not render hidden values by default.
- A page containing block redactions does not render the block body by default.
- Admin account page rendering reveals redacted page content server-side.
- Truthy `showPII` values do not reveal raw content for non-admin readers.
- Direct `/pii-view/...` requests return 404 for non-admin readers.
- Adding `?showPII=0`, `?showPII=false`, `?showPII=off`, or an empty `showPII` does not reveal hidden content.
- Markdown suffix requests and canonical redirects do not create raw-content access.
- Text search cannot retrieve hidden identifiers from redacted content.
- Downloaded markdown archives contain only redacted markdown, even if `showPII` is present in the request URL.
- Chat and AI-search context assembly use redacted markdown only.
- Stored document `content` is redacted; admin-only `rawContent` may retain the source body for page rendering.
- Vault lint can flag obvious, unwrapped PII in the main wiki/source surfaces.
- Redacted and revealed page cache entries do not collide.
- API routes ignore `showPII` and do not rewrite to reveal routes.
- A page with `sensitive: true` does not appear in guest sidebar/file-tree data, page-picker data, static route params, tag pages, search results, chat context, metadata/share previews, asset listings, or download archives.
- A page tagged with exact `sensitive` behaves the same as one with `sensitive: true`.
- A page tagged with a nearby but non-exact tag, such as `sensitivity-analysis`, is not treated as sensitive.
- A guest direct request to a sensitive page returns 404.
- A guest direct request to a sensitive page with `?showPII=1` still returns 404.
- A signed-in account user can direct-view a sensitive page and can receive it from account-scoped page/file-tree APIs.
- Local search, Convex search, vector retrieval, chat tools, and page-read tools cannot return or read sensitive pages.
- Sidecar PDFs/files that correspond to sensitive markdown pages are not served to guests and are excluded from broad asset lists, asset ingest, PDF ingest, and download archives.
- Liveblocks guest auth, comment creation, thread deletion, and thread listings hide or reject rooms for sensitive pages.
- Claude Code wiki-maintenance docs instruct agents to skip sensitive pages unless explicitly authorized.

## Test Plan

### Unit tests

- Inline redaction hides content and preserves labels.
- Inline redaction accepts single-quoted labels and multiline hidden content.
- Block redaction removes content in default mode.
- Block labels are trimmed and replace the hidden body cleanly.
- Reveal mode restores hidden inline and block content.
- Reveal mode disables fallback replacements.
- Fallback replacements catch legacy identifiers.
- Fallback replacements preserve explicit non-patient exceptions.
- `shouldShowPii()` accepts supported truthy query values case-insensitively.
- `shouldShowPii()` rejects falsey, empty, and missing values.
- Markdown file reads keep redacted and revealed cache entries isolated.
- Search indexing returns redacted replacement text without raw hidden values.
- Page-level sensitivity accepts `sensitive: true` and exact `sensitive` tags.
- Page-level sensitivity rejects near-match tags such as `sensitivity-analysis`.
- Markdown file trees exclude sensitive pages and inherited-sensitive sidecar PDFs unless `includeSensitive` is requested.
- Local search skips sensitive markdown files.

### End-to-end tests

- Diagnosis page hides patient identifiers by default.
- Admin account page rendering reveals hidden redact-block content.
- Non-admin `?showPII=1` page rendering stays redacted.
- Non-admin `/pii-view/...` page rendering returns 404.
- Diagnosis page stays redacted with falsey values such as `?showPII=0`.
- Diagnosis page stays redacted after `.md` suffix requests from non-admin readers.
- About page hides inline patient identifiers by default.
- Text search for hidden MRN and patient-name values returns no results.
- Markdown export remains redacted even when `showPII=1` is appended to the export URL.
- Markdown export assertions must tolerate deployment sources that do not contain every local markdown file, but any included sensitive page must be redacted.
- Guest page navigation cannot discover sensitive pages in sidebar or page-picker data.
- Guest direct navigation to a sensitive page returns 404, including with `showPII=1`.
- Signed-in account navigation can load a sensitive page directly.
- Search/chat/tool flows cannot retrieve a known phrase from a sensitive page.
- Sensitive sidecar PDF/file URLs return 404 for guests and are absent from downloadable archives.
- Guest Liveblocks calls cannot authenticate, list, create comments, or delete threads for sensitive rooms.

## Known Follow-Ups

- Refresh embeddings after deploy so semantic/vector retrieval matches the newly redacted stored markdown.
- Refresh ingestion after deploy so existing Convex document records receive the correct `sensitive` flag.
- Run Convex codegen in an environment with `CONVEX_DEPLOYMENT` configured.
- Remove, rotate, or expire previously uploaded public Blob assets for pages that are newly marked sensitive if those URLs may have leaked.
- Expand lint-driven redaction beyond the first high-risk file set as the remaining backlog is reviewed.
- Consider replacing the temporary fallback literals with a configurable identifier registry if more patient-specific content is added later.
