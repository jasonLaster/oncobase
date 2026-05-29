# Oncobase Web

`apps/web` is the current production Oncobase app. It is a Next.js App Router application with Convex functions, Vercel deployment hooks, publishing APIs, site admin tools, chat, search, comments, downloads, and the production wiki reader.

The public feature overview starts at [`../../docs/features.md`](../../docs/features.md). Architecture docs live in [`docs/architecture`](docs/architecture/README.md), and app-level product specs live in [`specs`](specs/features.md).

## What This App Owns

- site resolution and password-gated routing
- wiki page rendering and route metadata
- Convex schema/functions for sites, documents, comments, users, roles, chat, and metadata
- publishing endpoints consumed by `@oncobase/oncobase`
- text search, AI search, and chat routes
- Liveblocks comments routes and UI integration
- admin scripts for site creation, publish tokens, locks, archive/restore, and user passwords
- Playwright and Endform tests for the production surface

Reusable behavior should move into packages under [`../../packages`](../../packages/README.md) when it is no longer app-specific.

## Run Locally

Install dependencies from the workspace root:

```sh
bun install
```

Start the app:

```sh
bun --cwd apps/web dev
```

Open [http://localhost:3000](http://localhost:3000).

By default, local development can point at the production-shaped Convex data model. Set `NEXT_PUBLIC_CONVEX_URL` to use a specific Convex deployment. Use the local Convex process when you need schema/function changes:

```sh
bun --cwd apps/web dev:local-convex
```

## Verification

From this app:

```sh
bun --cwd apps/web typecheck
bun --cwd apps/web lint
bun --cwd apps/web test:unit
bun --cwd apps/web test
```

From the repository root:

```sh
bun run typecheck
bun run test:unit
bun run lint
bun run build
```

## Endform And Preview Tests

Run the local Playwright suite on Endform:

```sh
bun x endform login
bun --cwd apps/web test:endform
```

Target a deployed preview:

```sh
TEST_ENV=prod PROD_URL=https://your-preview-url.vercel.app bun --cwd apps/web test:endform
```

The preview workflow expects:

- `ENDFORM_API_KEY`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

## Operator Docs

- [Operator runbook](specs/operator-runbook.md)
- [Publishing architecture](docs/architecture/04-publishing.md)
- [Multi-site spec](specs/multi-site.md)
- [Role-based access](specs/role-based-access.md)
- [PII redaction](specs/pii-redaction.md)
- [Comments](specs/comments.md)
