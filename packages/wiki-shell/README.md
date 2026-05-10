# Wiki Shell

Reusable Diana wiki shell components shared by the current `web` app and the Vite reader.

The package is intentionally adapter-shaped. It owns visual behavior, layout state, CSS variables, and accessibility semantics, while host apps supply routing, data, and product-specific actions.

Current exports:

- `DocumentOutlineShell`: outline-only right rail with the current app's collapsed desktop rail, mobile bottom rail, persisted pane state, resize behavior, heading collection, hash navigation, and `comments-content-wrapper` layout variables.
- `ResizableLayout`: shared left navigation rail collapse/resize primitive.
- `WikiHeader`, `WikiHeaderSearchForm`, `WikiHeaderButton`, `WikiHeaderLink`, and `WikiLogo`: header chrome primitives with host-owned routing/search/action behavior.
- `WikiBreadcrumbs`, `WikiPageHeader`, `WikiPageActions`, `WikiSourceLinks`, `WikiTagList`, `WikiPageFooter`, and related action/badge primitives: page chrome components with host-owned routing, copy, and download behavior.
- `WikiPageLoading`, `WikiPageSkeleton`, and `WikiEmptyState`: shared loading, skeleton, missing, and retry state shells with host-owned actions.
- `WikiSearchPage`, `WikiSearchHeader`, `WikiSearchForm`, `WikiSearchModeToggle`, `WikiSearchResults`, and `WikiSearchResultLink`: search route chrome with host-owned backend calls, routing, and keyboard state.
- `WikiCommandBackdrop`, `WikiCommandPanel`, `WikiCommandSearch`, `WikiCommandTabs`, `WikiCommandList`, `WikiCommandEmpty`, and `WikiCommandFooter`: command-palette shell chrome with host-owned data and action handling.
- `WikiSidebar`, `WikiTree`, `WikiMobileNavigation`, and tree helpers: navigation chrome with host-owned tree data, route links, file URLs, and persisted expansion state.
- `collectOutline`, `scrollToOutlineItem`, and related helpers for command palette and outline adapters.
- `styles.css`: shell styles that do not depend on Next, Vite, LiveStore, or Convex.

The right rail keeps the existing `comments-pane-*` storage/event names on purpose. Comments and Liveblocks are parked for the Vite replacement, but smart tables and future comments should coordinate through the same rail contract instead of inventing a second layout channel.
