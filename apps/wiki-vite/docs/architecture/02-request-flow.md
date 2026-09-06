# 2. Request Flow and Multi-Tenancy

A browser navigation enters [app-shell.ts](../../server/app-shell.ts), which applies route normalization, page metadata and the signed password gate. React then uses the same-origin APIs dispatched by [wiki-api.ts](../../server/wiki-api.ts).

## Site boundary

`resolveSiteSlug` resolves the actual request host, supports explicit deployment configuration and local-development hostnames, and consults Convex site records. Caller-supplied `x-site-slug` does not grant authority. Unknown or archived sites fail closed. Site-resolution results have a bounded host cache.

Every tenant query/mutation must carry the resolved site slug. Convex's `requireSite` and `rowBelongsToSite` enforce the persisted boundary. Do not replace these checks with browser filtering.

## Gate, identity and permissions

These are separate controls:

- The signed site gate cookie grants entry to a password-protected site. An unsigned `authed=true` cookie is invalid.
- The account session identifies the user. Hashing/session helpers live in [user-auth.ts](../../server/user-auth.ts); persisted revocation is authoritative.
- Site-scoped roles and path/tag rules determine access to protected content. A signed-in account alone is not sufficient.

Public and session manifests use separate cache identities. Sensitive source data must be authorized before it reaches pages, search, chat, downloads, or assets. Preserve authored sensitivity separately from role restrictions; a clinical or research topic alone is not a sensitivity rule.

Password-gated and signed-in responses are private and non-cacheable. Public login/terms routes and signed service integrations have their own explicit boundaries; they are not permission to bypass content API gates. In particular, `/api/file` validates gate, ownership and visibility before fetching bytes.

See [security regression cases](../../parity-e2e/security.spec.ts) and [backend tests](../../server/wiki-api.test.ts).
