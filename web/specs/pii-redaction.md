# PII Redaction Spec

Server-side markdown redaction for patient-identifying content across wiki rendering, search, chat context preparation, and exports.

## Goals

- Let authors mark sensitive spans directly in markdown with a small, readable syntax.
- Hide redacted content by default everywhere the web app reads markdown.
- Keep hidden content out of rendered HTML, text search, AI/chat context assembly, and downloadable markdown archives.
- Allow intentional reveal for page rendering with an explicit query param, without weakening the default server-side protection boundary.
- Add vault linting so obvious patient identifiers can be found and redacted before they leak into the app.

## Non-Goals

- Fine-grained per-user authorization for PII reveal.
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

Default render:

```md
The patient is the patient.
MRN:
```

Reveal render (`?showPII=1`):

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

## Behavioral Contract

### Default mode: `redacted`

This is the safe baseline and must be used unless a route explicitly opts into reveal behavior.

- Inline `<redact>` spans are removed from output.
- Inline spans with `label="..."` render the label instead of the hidden content.
- `:::redact ... :::` blocks are removed from output.
- Block labels render as replacement text in place of the hidden block.
- Known high-risk literals still get fallback replacement even if they were not explicitly wrapped.

### Reveal mode: `revealed`

This mode is only for request-time page rendering where the caller intentionally passes `showPII`.

- Inline and block redactions emit their original content.
- Fallback replacements are disabled.
- Reveal does not modify stored/indexed/exported content.

### Query param

- Query param name: `showPII`
- Truthy values: `1`, `true`, `yes`, `on` (case-insensitive).
- Falsey or missing values, including `0`, `false`, `off`, and an empty `showPII`, must keep default redaction.
- Reveal applies only to authenticated page markdown rendering paths.
- Search, ingest, AI/chat context preparation, and download routes ignore the reveal param and stay redacted.
- Markdown suffix handling, casing fixes, and route aliases must preserve a truthy reveal intent without revealing for falsey values.

### Fallback replacements

Fallback replacements are a defense-in-depth layer for older content that has not yet been wrapped in explicit redaction syntax.

- Fallbacks run only in default `redacted` mode.
- Fallbacks replace known high-risk names, MRNs, DOBs, and email addresses, including case variants found in imported source documents.
- Fallbacks must not run in `revealed` mode, because the caller intentionally requested the raw page render.
- Explicit exceptions for known non-patient strings must remain stable so unrelated people are not accidentally renamed.
- Public redaction labels must not mention the reveal query parameter.

### Caching and routing

- Redacted and revealed markdown reads must use separate cache keys.
- The default document routes must remain the redacted/static path.
- Truthy `showPII` requests are routed to the request-time reveal renderer without changing stored markdown, search data, downloads, or AI context.
- API routes must not be rewritten by `showPII`; they remain redacted by construction.

## Security Boundary

The feature must remain server-side first.

- Raw markdown is never sent to the client when the request is in default mode.
- Search indexes/snippets are computed from redacted markdown, not from rendered DOM text.
- Download archives rebuild markdown from the server-side redacted reader instead of zipping raw `.md` files from disk.
- Download archives may be built from local disk, Convex records, or prebuilt Blob cache entries; every included markdown entry must be redacted regardless of source.
- Chat and AI-search context assembly must consume redacted markdown so hidden content is excluded before any model call.
- Query-param reveal must be read at request time and passed only to the page-level markdown loader; it must not mutate caches or stored source data.

## Implementation Plan

### Shared redaction utility

`src/lib/pii-redaction.ts`

- Parse block redactions with `:::redact[optional label] ... :::`
- Parse inline redactions with `<redact label="optional label">...</redact>`
- Normalize whitespace after removals so documents do not accumulate blank gaps
- Apply conservative fallback replacements for known patient identifiers that still exist in older source material
- Expose `shouldShowPii()` and `SHOW_PII_QUERY_PARAM`

### Markdown loading

`src/lib/markdown.ts`

- Add `piiMode` option to markdown reads
- Redact content before title extraction, body extraction, and cache storage
- Include `piiMode` in cache keys so revealed and redacted reads never collide

### Rendering

`src/app/(main)/page.tsx`
`src/app/(main)/[...slug]/page.tsx`
`src/app/(main)/pii-view/[...slug]/page.tsx`
`src/proxy.ts`

- Keep default page routes on the normal redacted markdown reader.
- In the proxy, rewrite authenticated requests with truthy `showPII` to the internal reveal route.
- Use the reveal route only to switch page rendering between `redacted` and `revealed`.
- Exclude API routes from reveal rewrites so downloads and other server endpoints cannot be flipped by query string.

### Search and AI context

`src/lib/search.ts`
`src/app/api/ai-search/route.ts`
`src/app/api/chat/route.ts`
`scripts/eval-*.ts`

- Ensure all search snippets and AI/chat context use redacted markdown
- Remove hardcoded patient-name examples from prompts and evaluation scripts

### Downloads and ingestion

`src/lib/archive-helpers.ts`
`src/app/api/download/route.ts`
`src/workflows/build-download-cache.ts`
`scripts/ingest-wiki.ts`

- Skip raw markdown files when archiving from disk
- Re-append markdown from redacted server reads
- Ingest redacted markdown into stored document records so later consumers inherit the safe form

### Vault hygiene

`../obsidian/.agents/skills/lint/check-pii.ts`

- Add focused vault lint for high-risk identifiers and fields
- Ignore content already wrapped in redact blocks
- Use it to drive a first-pass manual redaction of high-traffic wiki and source files

## Acceptance Criteria

- A page containing inline redactions does not render hidden values by default.
- A page containing block redactions does not render the block body by default.
- Adding `?showPII=1` reveals redacted page content server-side.
- Adding `?showPII=true`, `?showPII=yes`, or `?showPII=on` also reveals redacted page content.
- Adding `?showPII=0`, `?showPII=false`, `?showPII=off`, or an empty `showPII` does not reveal hidden content.
- Markdown suffix requests and canonical redirects preserve truthy reveal intent.
- Text search cannot retrieve hidden identifiers from redacted content.
- Downloaded markdown archives contain only redacted markdown, even if `showPII` is present in the request URL.
- Chat and AI-search context assembly use redacted markdown only.
- Stored ingested markdown content is redacted.
- Vault lint can flag obvious, unwrapped PII in the main wiki/source surfaces.
- Redacted and revealed page cache entries do not collide.
- API routes ignore `showPII` and do not rewrite to reveal routes.

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

### End-to-end tests

- Diagnosis page hides patient identifiers by default.
- Diagnosis page reveals them with `?showPII=1`.
- Diagnosis page reveals them with alternate truthy values such as `?showPII=TRUE`.
- Diagnosis page stays redacted with falsey values such as `?showPII=0`.
- Diagnosis page keeps reveal semantics after `.md` suffix requests.
- About page hides inline patient identifiers by default.
- Text search for hidden MRN and patient-name values returns no results.
- Markdown export remains redacted even when `showPII=1` is appended to the export URL.
- Markdown export assertions must tolerate deployment sources that do not contain every local markdown file, but any included sensitive page must be redacted.

## Known Follow-Ups

- Refresh embeddings after deploy so semantic/vector retrieval matches the newly redacted stored markdown.
- Expand lint-driven redaction beyond the first high-risk file set as the remaining backlog is reviewed.
- Consider replacing the temporary fallback literals with a configurable identifier registry if more patient-specific content is added later.
