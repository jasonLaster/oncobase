# PDF library

Repo PDFs remain at their original vault paths. The publisher supports a reviewed
`--asset-files-from` allowlist, including standalone files without Markdown siblings,
and resolves ownership across the full vault before selecting upload bytes.

The manifest includes authorized PDFs in every directory. Markdown and PDF siblings
with the same name have distinct entries; neither replaces the other in the tree.

Browser navigation to `/api/file?path=...pdf` authorizes the asset before redirecting
to `/tools/pdf-viewer?path=...pdf`. Repository-relative PDF URLs also resolve through
the file API. API fetches and range requests retain the original binary response;
`download=1` requests an attachment and `raw=1` keeps native browser viewing available.

The lazy PDF.js viewer renders pages with selectable text, page navigation, fit width,
zoom, an original-file download, and explicit permission/unavailable/invalid-file
states. Codecs, fonts and character maps are served from the app origin; the static
asset guard accepts only the installed package's support files. PDF scripting is not
enabled and its QuickJS runtime is not shipped.

Verification covers byte-preserving API responses and restricted-file denials,
standalone asset publishing, file/Markdown/directory collisions, desktop/mobile
rendering, aligned text selection, pagination, zoom, download and failure states.
