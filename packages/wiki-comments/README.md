# @oncobase/wiki-comments

Liveblocks-backed document comments for Oncobase wiki apps.

The package carries the production comments rail extracted from `apps/web` with host-owned adapters for routing, user resolution, guest identity persistence, and site-scoped Liveblocks credential lookup.

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
- `@oncobase/wiki-comments/guest-user` - framework-neutral guest identity helpers
- `@oncobase/wiki-comments/threads` - thread metadata, sorting, anchors, and plain-text helpers
- `@oncobase/wiki-comments/site` - site-scoped Liveblocks credential resolution
- `@oncobase/wiki-comments/user-resolution` - user lookup helpers
- `@oncobase/wiki-comments/user-format` - display-name helpers
- `@oncobase/wiki-comments/page-client` - global comments page client

## Boundary Notes

This package does not import app internals. Hosts provide adapters for:

- Liveblocks API endpoint URLs and optional public key overrides
- site slug lookup and site config reads
- user and guest-name persistence
- document links on the global comments page

## Related Docs

- [Comments spec](../../apps/web/specs/comments.md)
- [Multi-site spec](../../apps/web/specs/multi-site.md)
- [Feature overview](../../docs/features.md#comments-and-review)
