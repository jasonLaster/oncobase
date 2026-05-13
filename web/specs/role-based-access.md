# Role-Based Access Permissions

Role-based access control protects specific source-page paths without changing the site-wide password gate or the sensitive-page model.

## Goals

- Let operators create named roles for a site.
- Let each role grant include and exclude path-prefix permissions.
- Let each role optionally include or exclude matching source tags.
- Let operators assign roles to signed-in account users.
- Keep public source pages readable when a role system exists.
- Return 404 for protected source pages when the visitor is anonymous or lacks a matching role.

## Non-Goals

- Per-span authorization.
- A second privacy concept beyond `sensitive`.
- Broad gating of normal public wiki pages.
- Cross-site roles or global role assignments.

## Data Model

RBAC uses three site-scoped Convex tables:

| Table | Key fields | Notes |
|---|---|---|
| `roles` | `siteId`, `name`, `description` | A named permission bundle for one site. |
| `rolePermissions` | `siteId`, `roleId`, `includePathPatterns`, `excludePathPatterns`, `includeTags`, `excludeTags` | Prefix-style path patterns and tag filters granted or carved out by the role. |
| `userRoles` | `siteId`, `userId`, `roleId` | Assignment from a site user to a site role. |

Every query and mutation must resolve the active site through `requireSite` and ignore rows that do not belong to that site.

## Permission Semantics

Path patterns are prefix matches:

| Pattern | Matches |
|---|---|
| `sources/private/*` | Any slug starting with `sources/private/`. |
| `sources/private/report` | That exact prefix, including child paths. |
| `*` | Every slug. |

A slug is protected only if it matches at least one role permission for the current site. A rule matches when the slug matches one included path prefix or one included tag, and does not match an excluded path prefix or excluded tag. If no role permission matches, the slug remains public. If a role permission matches, the user must be signed in and have an assigned role with a matching permission.

## Request Contract

1. `proxy.ts` resolves the site and sets `x-site-slug`.
2. The source-page route first attempts a public document lookup.
3. If that lookup returns a document, the page renders without consulting RBAC.
4. If the public lookup returns no document, the route resolves `wiki_user_session`.
5. Signed-in users are checked through `access.canUserAccessSlug({ userId, slug })`.
6. Anonymous users and signed-in users without a matching permission receive 404.

This order is important: public source pages must not become role-gated simply because a role system exists.

## Admin Contract

`/admin/access` is the operator UI for this first pass:

- create a role with comma-separated include/exclude path patterns and tag filters
- list roles and their include/exclude path and tag permissions
- list site users with assigned role names
- assign a role to a user

The page requires an account session. It is not a public self-service permission surface.

## Regression Coverage

Playwright coverage lives in `e2e/role-based-access.spec.ts`. It seeds a temporary site, a public source document, a protected sensitive source document, two users, and one role assignment. The suite asserts:

- public source pages still render without an account
- anonymous users cannot read the protected source page
- signed-in users without a matching role cannot read it
- signed-in users with the matching role can read it
- include/exclude path rules and include/exclude tag rules are enforced
