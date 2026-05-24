---
name: diana-web-access-control
description: Use when editing the Diana TNBC web app access model, including RBAC, email-domain roles, tag/path permissions, sensitive/private page behavior, /admin/access UX, tags grouped by path, or sign-in prompts around protected content.
---

# Diana Web Access Control

Use this for Diana-specific auth, access, and admin work in `web/`.

## Start Here

Map the request to the existing model before editing:

- **User identity/session:** `src/lib/user-auth.ts`, `src/lib/session-user.ts`, auth routes under `src/app/api/auth/`.
- **Roles and permissions:** `convex/access.ts` and the admin wrappers in `src/lib/site-data.ts`.
- **Admin UX:** `src/app/(main)/admin/access/`, `src/app/(main)/admin/users/`, `src/app/(main)/admin/roles/`, and `src/app/(main)/admin/admin-sidebar.tsx`.
- **Document access:** `convex/documents.ts`, `src/lib/markdown.ts`, `src/lib/chat-page-reader.ts`, route pages under `src/app/(main)/`.
- **Sensitive pages:** `src/lib/sensitive-pages.ts` and `src/app/(main)/_components/document-page.tsx`.
- **Tags pages:** `src/lib/tag-page-groups.ts` and `src/app/(main)/tags/[tag]/page.tsx`.

Do not create a parallel auth/access layer. Extend the Convex role and permission model unless the existing model cannot represent the requested behavior.

## Access Rules

- Keep every role, permission, assignment, and document query site-scoped via the existing `requireSite` / `rowBelongsToSite` helpers.
- Permissions may match paths, include tags, and exclude tags. Preserve the current rule shape instead of adding special-case page lists.
- Email-pattern roles should be derived, not duplicated as permanent user-role rows. `convex/access.ts` already accepts exact emails, bare domains, `@domain`, and `*@domain`.
- Normalize emails and tags to lowercase before matching.
- A protected page is allowed only when at least one assigned or email-derived role has a matching permission rule.

## Sensitive vs Restricted

Keep these states separate:

- **Sensitive source marker:** `sensitive: true` or exact `sensitive` tag in authored content.
- **Restricted access:** role/path/tag rules that decide which signed-in users can read a page.
- **Unavailable UI:** the app should distinguish `sensitive-unavailable` from `not-found` so private pages do not look deleted.

Public academic analysis is not sensitive by topic alone. Do not add sensitivity merely because a page mentions companies, biomarkers, drugs, trials, strategy, or ADC selection.

## Admin UX Defaults

- Keep `/admin/access` as the primary operator surface for bulk role assignment, user deletion, page/rule inspection, and filtering.
- Prefer inline filters, checkboxes, segmented views, and existing admin layout patterns over separate one-off tools.
- When showing tag-based access, group tags or pages by path when that makes the operator's decision easier to audit.
- Make sign-in prompts more prominent without blocking public reading or hiding the wiki navigation unless the route is actually restricted.

## Verification

From `web/`, use the real local checks:

```bash
bun run typecheck
bun run lint
bun test src/lib/*.test.ts
git diff --check
```

Run targeted Playwright only when the browser flow is stable enough to exercise the changed UI. If local auth redirects or `*.localhost` hydration make `/admin/access` flaky, verify the Convex mutations and pure utilities directly and call out the browser-environment limitation.

For production-facing UI changes, inspect the page with a browser at desktop and mobile widths before pushing.

## Common Pitfalls

- `bun run check` does not exist in `web/package.json`; use `bun run typecheck` and `bun run lint`.
- Local admin browser tests can fail because of auth/session setup rather than the access logic itself. Confirm with direct utility or mutation coverage before changing unrelated UI.
- Unrelated dirty files are common in this repo family. Inspect `git status`, stage only intended files, and keep commits scoped to the access/admin change.
