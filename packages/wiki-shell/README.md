# Wiki Shell

Reusable Diana wiki shell components shared by the current `web` app and the Vite reader.

The package is intentionally adapter-shaped. It owns visual behavior, layout state, CSS variables, and accessibility semantics, while host apps supply routing, data, and product-specific actions.

Current exports:

- `DocumentOutlineShell`: outline-only right rail with the current app's collapsed desktop rail, mobile bottom rail, persisted pane state, resize behavior, heading collection, hash navigation, and `comments-content-wrapper` layout variables.
- `ResizableLayout`: shared left navigation rail collapse/resize primitive.
- `collectOutline`, `scrollToOutlineItem`, and related helpers for command palette and outline adapters.
- `styles.css`: shell styles that do not depend on Next, Vite, LiveStore, or Convex.

The right rail keeps the existing `comments-pane-*` storage/event names on purpose. Comments and Liveblocks are parked for the Vite replacement, but smart tables and future comments should coordinate through the same rail contract instead of inventing a second layout channel.
