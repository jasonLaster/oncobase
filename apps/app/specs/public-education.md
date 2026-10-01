# Public education

On Diana, non-sensitive pages under `wiki/education/` can be read without the shared wiki password. The landing page links directly to the curriculum. Other sites retain their configured password gate.

Guests use the normal reader with an education-only manifest, page API, text search, and Markdown downloads. Images, PDFs, and HTML labs are available only when their asset path is in education, their stored sensitivity is explicitly false, and all recorded owners are education pages. Unknown ownership and sensitive assets remain protected. HTML labs run in an origin-isolated CSP sandbox.

Existing inline/block PII redaction applies to guest pages, search, downloads, and server bootstraps. Sensitive pages inside education still require the existing gate and account permissions. The clinical timeline, diagnostics, DICOM, pathology, archives, tools, chat, and comments keep their existing access controls.

Guest identities use `diana:public:<version>:education`. HTML marks the limited access mode, and the reader rejects a remembered full-wiki startup cache before painting. Manifest snapshots and prefetch recommendations from the full wiki are disabled in guest mode. Cookie-dependent responses are private and vary on Cookie and Host.

Verification: server API/app-shell tests cover scope, assets, redaction, aliases, and gate restoration. `e2e/education-access.spec.ts` checks the published curriculum in an anonymous browser, real cartoons, search, phone layout, protected navigation, and a seeded full-wiki cache. Run this against the standalone server using `PLAYWRIGHT_BASE_URL`; Vite development HTML does not own the production page gate.
