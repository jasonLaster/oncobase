# Production reader verification — 2026-09-09

The opt-in production suite exercises real responses from `https://diana-tnbc.com` with fresh Chromium, Firefox, and WebKit contexts at 1440×1000 and 390×844. It covers 66 scenarios across refresh-time keyboard input, early Search/Ask wiki clicks, delayed chat downloads, browser history, chat reload and unsent composition, keyboard chords, file-tree visibility, layout, light/dark theme persistence, outline navigation, and unavailable-page recovery.

Run locally with `PRODUCTION_READER_TESTS=1` and `WIKI_VITE_PREVIEW_LOGIN_PASSWORD` supplied in the environment:

```sh
bunx playwright test --config playwright.production.config.ts
```

Run from `apps/app`. The suite never substitutes API responses or submits chats/comments. Delay gates hold actual production scripts to exercise startup races. Phone projects use narrow desktop-browser viewports; they are not physical-device or touch-emulation tests. Screenshots, failure traces, and timing/error attachments remain under the ignored `.playwright/production-reader/` directory, outside public CI artifacts. The suite refuses to run in CI.

The initial nine Chromium desktop flows passed. The first complete matrix recorded 63 passes and three failures. One test pressed Enter before the outline's first result existed; it now waits for the displayed heading. Both WebKit layouts found a real unhandled `TypeError: Load failed` from Convex `refetchToken` while chat reload canceled a token request. The UI eventually recovered, but the rejected authentication callback was an application error.

The token callback now resolves unavailable/canceled requests and body reads to `null`, consistent with its existing handling of unsuccessful HTTP responses. Unit regressions cover successful authenticated requests, request cancellation, response-body cancellation, retry after failure, unsuccessful responses, and malformed token payloads.

The initial run began on `14b5c765`. During the matrix, production advanced to `88d23056`, which added server-side chat reasoning summaries and changed no reader navigation code. Final verification results after the token fix will be recorded separately; the initial failures are retained in `.playwright/production-reader-initial/`.
