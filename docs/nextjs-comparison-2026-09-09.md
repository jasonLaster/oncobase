# Next.js comparison branch

The prior Next.js reader is retained on `codex/nextjs-comparison`, based on
`52e12889` (the final tree before Next retirement). This is an independent
comparison branch, not a rollback of main or a production-domain change.

## Source selection

| Source | Selection |
| --- | --- |
| `52e12889` | Complete retained Next app under `apps/web`, with its pre-retirement shared packages and original reader/sidebar UI. |
| `0ee4c214` | Cherry-picked with provenance: remove the legacy public report and reject unreviewed public assets before Next startup/build. |
| `f4786a78` | Port only the current research URL mapping into Next redirect syntax. Preserve current reviews/essays/index pages while retaining legacy redirects. The Vite route matcher and tests are excluded. |
| Backend-auth work after the base | Narrow application-side compatibility adapter for the currently enforced service JWT and site-scoped browser conversation token. Existing Next request handlers and provider use that adapter. No Convex functions, schemas, data, or deployment configuration are changed. |

The 70 commits on main between `52e12889` and the inspected `989fbc83`
contain no new standalone vault-content or diagnostic-data commits to
cherry-pick. Most change Vite startup, styling, APIs, backend authorization,
performance, tests, or documentation. Replaying those wholesale would destroy
the usefulness of the original UI comparison. The relevant content-route fix
is ported separately as described above. Earlier diagnostic content changes
are already in the base.

Vault articles are published to Convex from the separate Diana vault; they are
not bundled with either frontend. Both versions read the current published
content from the same backend. On September 9, the local Next API and the live
Vite API each returned 6,583 public pages with identical slug/content-hash
mappings: zero pages missing in either direction and zero changed hashes.
The sorted mapping SHA-256 was
`73b0f5172a2b29a9b7aa5e708fe810ed26a4c050028f6beea16f3fa093bf949d`.
This verifies manifest content identity at that time, not an independent byte
hash of every article body. Later vault publication updates both versions.

## Local comparison

- Next production build: `http://127.0.0.1:62174`
- Vite production: `https://diana-tnbc.com`
- Worktree: `/Users/jasonlaster/.codex/worktrees/nextjs-comparison/oncobase`
- Start the same article in both versions to compare the original sidebar,
  file palette, sign-in dialog, reader styling, and chat navigation.

Dependencies install with `bun install --frozen-lockfile`. Build shared
`packages/smart-table` and `packages/diagnostics`, then run `bun run build`
and `bun run start --hostname 127.0.0.1 --port 62174` from `apps/web`.
Provide existing authorized app configuration through the process environment:
`NEXT_PUBLIC_CONVEX_URL`, `WIKI_BACKEND_SIGNING_KEY`,
`WIKI_GATE_SESSION_SECRET`, and the normal gate password hash. Optional
chat/provider and comment configuration must match the app being compared.
Never place the signing key in a public environment variable or Git.
The local ignored launcher and evidence are under
`.playwright/nextjs-comparison/`; no environment file or credentials are
committed. The current launcher reads only required fields from existing
local configuration and binds the server to loopback.

## Validation and limits

- Frozen dependency installation, Next production build, and TypeScript check passed.
- Scoped ESLint and `git diff --check` passed.
- Ten security/authentication unit tests passed, covering the public-asset
  guard, signed service token lifetime/refresh, outbound credential scope,
  and browser token site scope, lifetime, signature, and gate rotation.
- Browser checks confirm current article rendering, original sidebar,
  Search palette, a Sign in dialog that keeps the current URL, current
  research URLs, and the chat composer.
- Backend content is shared. Do not create accounts, send chat prompts,
  annotate, publish, or run database-seeding suites merely to compare visuals.
- This branch is not independently certified for production deployment.
  Provider response generation, user-account mutations, and the full older
  Next suite are outside this comparison validation.
