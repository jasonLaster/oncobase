# Image viewer focus regression

This isolated fixture mounts the real `TheaterImage` button opener and delegated
`ImageTheater` IMG opener, with the shared native dialog and synthetic SVGs. It
uses the existing workspace React, Bun, and Playwright dependencies and reads no
wiki corpus or credentials.

From the repository root:

```sh
FOCUS_REPORT=/tmp/image-theater-focus-results.json FOCUS_OUTPUT=/tmp/image-theater-focus-results node node_modules/@playwright/test/cli.js test -c packages/wiki-markdown/e2e/playwright.focus.config.ts
```

The fixture server binds only `127.0.0.1:62828`; override `FOCUS_FIXTURE_PORT` to
use another isolated port. Playwright starts and stops it. The Bun build writes
generated JS/CSS under the ignored `e2e/.fixture-dist` directory.

Eight projects cover both shared opening paths, light/dark, and 1280/390 × 900.
Each checks Enter/Escape and keyboard reopening, visible and keyboard Close,
Space/scrim, scroll preservation, removed/replaced targets, StrictMode cycles,
and focus assigned after DOM removal. Four additional direct-modal projects
exercise Escape and visible Close with focus explicitly assigned to a connected
reading control before cleanup, under both actual themes and widths. Removed or replaced triggers are skipped rather than
finding a different element by label. Continue-reading controls remain usable.

These native Chromium fixture tests prove the bounded shared-component behavior.
Actual Diana and OncoGuide keyboard checks must still run after a separately
scoped application release; they do not establish public-reader, scientific,
human-review, or curriculum coverage acceptance.
