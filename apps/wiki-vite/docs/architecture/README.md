# Architecture

The production application lives in `apps/wiki-vite`; there is no Next runtime.

- Browser: `src` uses React Router, shared UI packages and a persistent LiveStore read cache.
- HTTP: `server/app-shell.ts` enforces page gates and metadata; `server/wiki-api.ts` dispatches same-origin APIs.
- Persistence: `convex` owns the shared multi-site schema and functions. Moving this directory does not move the deployment or data.
- Publishing: `server/publish-api.ts`, `scripts/publish`, and `@oncobase/oncobase` retain the existing publishing protocol.
- Authentication: `server/user-auth.ts` owns account hashing/session helpers; shared gate-session helpers remain in `@oncobase/wiki-content`.
- Hosting: root `vercel.json` builds the app and its Vercel Functions. `server/standalone.ts` runs the same handlers locally.

See the [app guide](../../README.md), [publishing protocol](04-publishing.md), [product specifications](../../specs/features.md), and [cutover evidence](../../../../docs/vite-cutover-qa-2026-09-05.md).
