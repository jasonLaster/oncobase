# @oncobase/wiki-comments

Liveblocks-backed document comments for Oncobase wiki apps.

The package currently carries the production comments rail extracted from `apps/web`. It is reusable for the current app and documents the remaining dependency surface before comments can be considered fully framework-neutral.

## Main Features

- document comments rail
- page-level comment composer
- text-selection anchored comments
- outline/comments rail mode switching
- persisted pane open state and width
- Liveblocks room/provider wrappers
- global comments page client
- thread metadata helpers
- comment plain-text extraction
- user display formatting and resolution helpers
- per-site Liveblocks credential resolution

## Entry Points

- `@oncobase/wiki-comments` - document comments component
- `@oncobase/wiki-comments/room` - Liveblocks room wrapper
- `@oncobase/wiki-comments/provider` - provider shell
- `@oncobase/wiki-comments/threads` - thread metadata, sorting, anchors, and plain-text helpers
- `@oncobase/wiki-comments/site` - site-scoped Liveblocks credential resolution
- `@oncobase/wiki-comments/user-resolution` - user lookup helpers
- `@oncobase/wiki-comments/user-format` - display-name helpers
- `@oncobase/wiki-comments/page-client` - global comments page client

## Current Boundary Notes

This package still imports a small set of generated Convex, site, auth, and UI helpers from [`../../apps/web`](../../apps/web/README.md). That is intentional for the current production extraction, but it is not the final package boundary.

Before using this package in another host, extract or adapterize:

- generated Convex API references
- site slug resolution
- Convex server client access
- app-local utility and dropdown-menu components
- any Diana migration fallback logic in Liveblocks credential resolution

## Related Docs

- [Comments spec](../../apps/web/specs/comments.md)
- [Multi-site spec](../../apps/web/specs/multi-site.md)
- [Feature overview](../../docs/features.md#comments-and-review)
