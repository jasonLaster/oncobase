# Public education

## Dedicated education library

`/education` is the public education home, with its own header, search, topic cards, and expandable curriculum sidebar. Every explicitly non-sensitive published page under `wiki/education/` appears in the library. Article URLs remove the `wiki/` prefix, for example `/education/oncology-101/index`. The wiki remains the source of truth; no curriculum is copied or republished. The existing `/wiki/education/` URLs keep working.

The standalone education application does not mount the care wiki's reader, LiveStore database, account UI, or comments. Its `/api/education/` endpoints always use education-only public scope, including for authenticated visitors and when the site's password gate is disabled. Manifest, page bodies, text search, Markdown downloads, and files reuse the existing filtering and redaction policies. Unknown endpoints, writes, sensitive lessons, and assets with mixed or unknown ownership remain unavailable. Other sites retain their existing access rules.

Curriculum links stay under `/education`, images use the education file API, and the mobile menu provides the same lesson list. Header search supports Cmd/Ctrl+K and shareable `/education/search?q=…` URLs, retries a warming text index, and includes matching page titles and descriptions. Education makes no use of remembered full-wiki browser data. Reader module preloads and startup shortcuts skip the dedicated routes.

Verification: `education-routes.test.ts`, dedicated cases in app-shell/API tests, and `e2e/education-hub.spec.ts` cover guest and authenticated scope, full published-page discovery, reading, cartoons, search, browser history, direct links, responsive layouts, and continued clinical protection.

## Wiki reader access

On Diana, non-sensitive pages under `wiki/education/` can be read without the shared wiki password. The landing page links directly to the curriculum. Other sites retain their configured password gate.

Guests use the normal reader with an education-only manifest, page API, text search, and Markdown downloads. Images, PDFs, and HTML labs are available only when their asset path is in education, their stored sensitivity is explicitly false, and all recorded owners are education pages. Unknown ownership and sensitive assets remain protected. HTML labs run in an origin-isolated CSP sandbox.

Existing inline/block PII redaction applies to guest pages, search, downloads, and server bootstraps. Sensitive pages inside education still require the existing gate and account permissions. The clinical timeline, diagnostics, DICOM, pathology, archives, tools, chat, and comments keep their existing access controls.

Guest identities use `diana:public:<version>:education`. HTML marks the limited access mode, and the reader rejects a remembered full-wiki startup cache before painting. Manifest snapshots and prefetch recommendations from the full wiki are disabled in guest mode. Cookie-dependent responses are private and vary on Cookie and Host.

Verification: server API/app-shell tests cover scope, assets, redaction, aliases, and gate restoration. `e2e/education-access.spec.ts` checks the published curriculum in an anonymous browser, real cartoons, search, phone layout, protected navigation, and a seeded full-wiki cache. Run this against the standalone server using `PLAYWRIGHT_BASE_URL`; Vite development HTML does not own the production page gate.
