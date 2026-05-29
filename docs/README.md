# Oncobase Docs

This directory is the public documentation hub. App-specific implementation specs still live beside the app they describe, but this index links them into one readable map.

## Start Here

- [Feature overview](features.md) - product features, user-facing behavior, and links to deeper specs.
- [Implemented skills](skills.md) - checked-in agent skills and how the CLI copies them into vaults.
- [Root README](../README.md) - repository layout, quick start, and publishing commands.
- [Apps README](../apps/README.md) - application boundaries.
- [Packages README](../packages/README.md) - package boundaries and reusable modules.

## Deep Dives

- [Architecture index](../apps/web/docs/architecture/README.md)
- [Multi-site model](../apps/web/specs/multi-site.md)
- [Role-based access](../apps/web/specs/role-based-access.md)
- [PII redaction](../apps/web/specs/pii-redaction.md)
- [Comments](../apps/web/specs/comments.md)
- [Smart table expansion](../apps/web/specs/table-expansion.md)
- [Chat package](../apps/web/specs/chat-package.md)
- [Chat pattern library](../apps/web/specs/chat-patterns/00-overview.md)
- [Operator runbook](../apps/web/specs/operator-runbook.md)
- [Vite reader plan](../plans/vite-livestore-wiki-reader.md)

## Link Style

Docs should prefer ordinary relative Markdown links because they work in GitHub, editors, and the Oncobase renderer. When a page is meant to be copied into a vault, keep the link text natural so it can be converted to wiki-link style without changing the surrounding prose.
