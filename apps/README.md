# Applications

This directory contains runnable Oncobase applications.

## [`web`](web/README.md)

The current production Next.js app. It owns:

- App Router pages and API routes
- Convex functions and schema
- publishing endpoints consumed by the `oncobase` CLI
- site admin tooling
- production comments, chat, search, downloads, and file serving
- Playwright and Endform coverage for the production surface

Most current architecture docs live under [`web/docs/architecture`](web/docs/architecture/README.md), and detailed product specs live under [`web/specs`](web/specs/features.md).

## [`wiki-vite`](wiki-vite/README.md)

The standalone Vite + LiveStore reader. It owns:

- client-rendered wiki shell
- LiveStore-backed public/session read caches
- standalone Bun server for same-origin preview behavior
- migrated reader E2E coverage
- Vercel replacement rehearsal for the reader surface

The migration plan is tracked in [`../plans/vite-livestore-wiki-reader.md`](../plans/vite-livestore-wiki-reader.md).
