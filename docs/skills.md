# Implemented Skills

Oncobase has two bundled CLI-distributed vault skills. Current app access-control guidance lives in the [request-flow documentation](../apps/wiki-vite/docs/architecture/02-request-flow.md).

## Skill Inventory

| Skill | Location | Status | Purpose |
| --- | --- | --- | --- |
| `wiki-quickstart` | [`packages/oncobase/skills/wiki-quickstart/SKILL.md`](../packages/oncobase/skills/wiki-quickstart/SKILL.md) | bundled with CLI | Guides first-time vault setup, orientation, and the first sync/check/publish loop. |
| `check` | [`packages/oncobase/skills/check/SKILL.md`](../packages/oncobase/skills/check/SKILL.md) | bundled with CLI | Guides safe pre-publish validation of a vault. |

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
- [Role-based access spec](../apps/wiki-vite/specs/role-based-access.md)
- [PII redaction spec](../apps/wiki-vite/specs/pii-redaction.md)
- [Oncobase CLI](../packages/oncobase/README.md)
