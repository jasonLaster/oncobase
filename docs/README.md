# Oncobase Docs

This directory is the public documentation hub. App-specific implementation specs still live beside the app they describe, but this index links them into one readable map.

## Start Here

- [Feature overview](features.md) - product features, user-facing behavior, and links to deeper specs.
- [Implemented skills](skills.md) - checked-in agent skills and how the CLI copies them into vaults.
- [Root README](../README.md) - repository layout, quick start, and publishing commands.
- [Apps README](../apps/README.md) - application boundaries.
- [Packages README](../packages/README.md) - package boundaries and reusable modules.

## Deep Dives

- [Next retirement and retained-logic consolidation](next-retirement-2026-09-05.md)
- [Architecture index](../apps/wiki-vite/docs/architecture/README.md)
- [Multi-site model](../apps/wiki-vite/specs/multi-site.md)
- [Role-based access](../apps/wiki-vite/specs/role-based-access.md)
- [PII redaction](../apps/wiki-vite/specs/pii-redaction.md)
- [Comments](../apps/wiki-vite/specs/comments.md)
- [Smart table expansion](../apps/wiki-vite/specs/table-expansion.md)
- [Chat package](../apps/wiki-vite/specs/chat-package.md)
- [Chat pattern library](../apps/wiki-vite/specs/chat-patterns/00-overview.md)
- [Operator runbook](../apps/wiki-vite/specs/operator-runbook.md)
- [Vite reader plan](../plans/vite-livestore-wiki-reader.md)

## Link Style

Docs should prefer ordinary relative Markdown links because they work in GitHub, editors, and the Oncobase renderer. When a page is meant to be copied into a vault, keep the link text natural so it can be converted to wiki-link style without changing the surrounding prose.
