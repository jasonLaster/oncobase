# Implemented Skills

Oncobase has two bundled CLI-distributed vault skills plus one checked-in app-maintenance skill for the current production web app.

## Skill Inventory

| Skill | Location | Status | Purpose |
| --- | --- | --- | --- |
| `wiki-quickstart` | [`packages/oncobase/skills/wiki-quickstart/SKILL.md`](../packages/oncobase/skills/wiki-quickstart/SKILL.md) | bundled with CLI | Guides first-time vault setup, orientation, and the first sync/check/publish loop. |
| `check` | [`packages/oncobase/skills/check/SKILL.md`](../packages/oncobase/skills/check/SKILL.md) | bundled with CLI | Guides safe pre-publish validation of a vault. |
| `diana-web-access-control` | [`apps/web/.agents/skills/diana-web-access-control/SKILL.md`](../apps/web/.agents/skills/diana-web-access-control/SKILL.md) | implemented | Guides access-control edits for the current Oncobase web app, especially the Diana production site. |

## `wiki-quickstart`

Use this skill when setting up or orienting inside a vault:

- confirm the vault root
- check `.wiki-site.json` or user-level wiki config
- initialize site config
- sync remote content before local work
- run a dry-run check
- publish only after the site slug, publish URL, and token are clear

## `check`

Use this skill before a publish or release:

- inspect the vault git status
- run `oncobase check --site <slug>`
- summarize changed documents and assets
- identify stale remote records that would be tombstoned
- flag dirty-tree, token, protocol-version, and large-upload blockers

## `diana-web-access-control`

Use this skill when changing the access model in [`apps/web`](../apps/web/README.md):

- role-based access control
- email-domain role assignment
- path and tag permissions
- sensitive/private page behavior
- `/admin/access` UX
- sign-in prompts around protected content
- tag-grouped admin views

The skill maps requests to the important implementation areas:

- auth/session helpers in `apps/web/src/lib`
- site-scoped access tables in `apps/web/convex`
- admin access routes in `apps/web/src/app/(main)/admin/access`
- markdown, chat, and route readers that must hide restricted content
- sensitive-page helpers that must stay separate from RBAC
- tag grouping helpers and tests

It also records the expected verification commands: typecheck, lint, targeted unit tests, Playwright when UI changes, and `git diff --check`.

## CLI Skill Sync

The `oncobase skills --site <slug>` command copies the bundled default skill set into a configured vault:

```sh
npx oncobase skills --site acme
```

Implementation lives in [`packages/oncobase/src/skills.ts`](../packages/oncobase/src/skills.ts). The command:

- loads the site config
- looks for a local `.claude/skills` or `.agents/skills` directory near the current working directory
- falls back to bundled package skills when local platform skills are not present
- copies the default `wiki-quickstart` and `check` skills into `<vault>/.claude/skills`
- reports copied and missing skills

## Related Docs

- [Feature overview: access, auth, and identity](features.md#access-auth-and-identity)
- [Role-based access spec](../apps/web/specs/role-based-access.md)
- [PII redaction spec](../apps/web/specs/pii-redaction.md)
- [Oncobase CLI](../packages/oncobase/README.md)
