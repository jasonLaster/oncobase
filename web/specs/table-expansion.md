# Table Expansion Spec

Feature spec for the prose-table expansion behavior used by wiki documents.

This complements [table-expansion-qa.md](./table-expansion-qa.md), which captures measured results from local testing, and [table-expansion-testing.md](./table-expansion-testing.md), which defines the automated and manual QA plan. This document defines the intended behavior, geometry model, and the cases we should continue to verify as the implementation evolves.

## Goal

Expanded prose tables should break out of the article column and use the full horizontal lane between the left navigation rail and the right comments rail, while keeping the original in-flow shell in place so:

- the toggle stays understandable and discoverable in both collapsed and expanded states
- the page does not jump when the table expands or collapses
- the expanded table remains visually aligned with its source position in the article
- vertical and horizontal scrolling continue to feel natural while the table is open

## Scope

This spec applies to markdown tables enhanced by [interactive-tables.tsx](/Users/jasonlaster/src/projects/diana-tnbc/web/src/components/interactive-tables.tsx) inside document prose.

It does not define the non-prose `SmartTable` component API. That path can continue using different expansion rules if needed, but the long-term goal should be for both implementations to converge on the same mental model.

## Product Requirements

### Collapsed State

- Tables render in the prose column inside a horizontally scrollable wrapper.
- The wrapper preserves the polished default table styling:
  - rounded outer shell
  - shaded uppercase header row
  - zebra striping
  - hover state
  - right-edge overflow fade when horizontally scrollable
- The expand toggle sits in a stable slot above the table while collapsed.

### Expanded State

- Expanding a prose table moves the scroll wrapper into an out-of-flow expansion layer.
- The expansion layer is positioned over the page, not resized inside the prose container.
- The expanded wrapper fills the expansion layer width so overlay styling such as the right-edge fade stays aligned to the expanded table.
- The original shell remains in the article and reserves enough height to prevent layout collapse.
- Reserved shell height must be based on the expanded wrapper's actual height, not the pre-expansion height.
- The expanded layer inherits the same table styling as the in-flow version.
- The expanded wrapper must remain horizontally scrollable when its inner table exceeds the available lane width.
- Vertical page scroll must continue to work while the expanded table is open.
- Vertical wheel input over the expanded wrapper should move the real page scroll container rather than trapping the user inside the overlay.
- The expand toggle moves with the expanded lane and sits near the expanded table's right edge while open.

### Sidebar Awareness

- The available expansion lane must respond to both sidebar systems:
  - left navigation rail, including expanded and collapsed widths
  - right comments rail, including expanded and collapsed widths
- Toggling either sidebar while a table is already expanded must update the expanded layer geometry without requiring the table to be collapsed and reopened.
- Collapsing the left rail should meaningfully increase the available expansion width.
- Opening the right comments rail should shrink the lane.
- Closing the right comments rail should widen the lane again.
- Rail-driven rerenders must not silently collapse an already expanded table.
- Rail-driven rerenders must not clear manual column widths.

## Geometry Model

### Terms

- `shell`: the in-flow wrapper that owns the toggle and reserves layout height
- `wrapper`: the horizontal scroll container that owns the actual table
- `expansion layer`: the fixed-position overlay parent used only while expanded
- `left rail`: the desktop navigation rail on the left side of the app
- `right rail`: the desktop comments or outline rail on the right side of the app
- `gutter`: the visual buffer between the expanded table and either rail
- `scroll owner`: the real vertical scroll container for the document page

### Lane Math

On desktop, the target lane is the horizontal interval between the two rails:

```ts
left = leftRail ? leftRail.right + gutter : contentLeft
right = rightRail ? rightRail.left - gutter : contentRight
width = right - left
top = shellRect.top + shellOffsetTop
```

Current constants and assumptions:

- `gutter = 20`
- `contentLeft` and `contentRight` are fallbacks used only when a rail is absent
- the expansion layer is attached to `document.body`
- the expansion layer is fixed-positioned and tracks the shell's visible offset, not the moved wrapper's stale document position

### Height Reservation

Shell reservation is a first-class requirement, not a cosmetic detail.

Expanded tables can become shorter when the wider lane reduces wrapping, so shell reservation must follow:

```ts
reservedHeight = shellOffsetTop + expandedWrapperHeight
```

Not:

```ts
reservedHeight = collapsedShellHeight
```

Using collapsed height causes the article to leave stale empty space or collapse incorrectly once the wrapper is moved into the wider lane.

### Why This Model

The prose column is not the right bounding box for expansion. Using the prose or content wrapper as both the minimum and maximum lane causes two failures:

- expansion looks modest even when the sidebars leave much more room available
- collapsing the left rail does not reclaim the released space for the table

Using the rail-to-rail lane fixes both problems and matches the visual expectation of "expand this table into the central workspace."

## Layout Invariants

- The shell reserves height equal to the expanded wrapper height plus the wrapper's offset inside the shell.
- The expanded wrapper is reparented back into the shell on collapse.
- Styling must not depend on the table staying under `.prose`; expanded tables need equivalent selectors in the overlay layer.
- The expanded layer must never overlap the right rail.
- The expanded layer must never start underneath the left rail.
- The expanded wrapper should fill the expansion layer width.
- The expand toggle should render at the expanded edge while open, and return to the shell while collapsed.
- Manual column widths should persist across sidebar-driven rerenders.
- Expanded state should persist across sidebar-driven rerenders when the same prose table is being restored.
- Expanded state should reset on full page refresh so reload cannot restore an orphaned overlay.

## Responsive Rules

### Desktop

- Desktop uses the rail-to-rail geometry model.
- The expansion layer may become substantially wider than the article column.
- Sidebar width changes should be observed through resize, mutation, and pane-state signals.
- Comments pane state changes should trigger layout refreshes even when the rail DOM changes in place or remounts.

### Tablet And Mobile

- When the desktop rails are absent, expansion falls back to the local content bounds.
- The system should prefer a stable, scrollable table over aggressive overlay behavior.
- The toggle should remain visible and clickable without relying on hover.

## Interaction Rules

- Expand and collapse must be idempotent across repeated toggles.
- Expanding one table must not permanently disturb the layout of another table.
- If a table is manually column-resized and then expanded, the manual widths should remain intact.
- If a table is manually column-resized and the right pane opens or closes, the manual widths should remain intact.
- The system should avoid automatic re-expansion or automatic toggling on load.
- Exception: if the same expanded prose table is remounted because the surrounding layout rerendered, restoring that expanded state is acceptable and expected.
- Full page refresh is not a rerender-restoration case; refreshed pages should come back collapsed.

## Scroll Rules

- The wrapper remains the horizontal scroll container in both collapsed and expanded states.
- If the layout engine can fit the table within the lane, horizontal scrolling may not be needed.
- If the user manually widens columns beyond the lane, horizontal scrolling must still work.
- Page scroll should remain stable while the expanded table is open.
- Wheel events over the expanded table should forward vertical intent to the scroll owner.
- Horizontal wheel or trackpad intent should continue to operate on the wrapper.
- The expanded layer must stay visually aligned to the document while the scroll owner moves.

## DOM Ownership

Current ownership is:

- [interactive-tables.tsx](/Users/jasonlaster/src/projects/diana-tnbc/web/src/components/interactive-tables.tsx)
  - enhancement lifecycle
  - toggle behavior
  - expansion layer creation
  - rail-aware geometry updates
  - expanded-state persistence across layout rerenders
- [globals.css](/Users/jasonlaster/src/projects/diana-tnbc/web/src/app/globals.css)
  - visual styling for both in-flow and expanded tables
  - expansion layer positioning rules
- [document-comments.tsx](/Users/jasonlaster/src/projects/diana-tnbc/web/src/components/document-comments.tsx)
  - stable sidebar state and width persistence that expansion logic depends on
- [smart-table-layout.ts](/Users/jasonlaster/src/projects/diana-tnbc/web/src/lib/smart-table-layout.ts)
  - content-aware widths
  - manual width locking
  - manual width persistence across remounts

## QA Matrix

The minimum desktop matrix should include these four sidebar combinations:

1. Left open, right collapsed
2. Left collapsed, right collapsed
3. Left open, right open
4. Left collapsed, right open

Each case should verify:

- expanded width is greater than or equal to collapsed width
- the layer ends before the right rail begins
- the layer begins after the left rail ends
- the toggle moves to the correct edge for the active state
- repeated open and close cycles are stable
- the shell reserves the correct height after expansion
- the right-edge fade is attached to the expanded wrapper
- refresh returns the table to a collapsed, scrollable state with no orphaned layers

Additional cases:

- left rail manually resized to a custom width
- right rail manually resized to a custom width
- page scrolled deep into the article before expansion
- horizontal scroll after manual column resize
- toggle sidebar states while a table is already expanded
- open one table, then open another farther down the page
- manual resize, then open right rail, then expand
- expand, then open right rail, then close right rail again
- expand, then scroll using wheel input directly over the table
- rerender of the prose shell while a table is expanded

## Known Risks

- The smart layout engine can make expansion appear less dramatic when it successfully reflows columns to fit the lane.
- Browser auth state on localhost can make QA inconsistent if the document route redirects to `/login`; authenticated testing should use a stable session or an explicit token flow.
- The separate `SmartTable` path still uses older margin-based bleed math and may diverge from prose behavior until it is unified.
- The right comments rail is the most failure-prone dependency because its controls, DOM shape, and mounted width can all change across states.
- In the current local environment, comments activation is further complicated by suspended Liveblocks access, so outline-rail automation is the most reliable right-rail regression path.

## Open Follow-Ups

- Unify the prose-table and `SmartTable` expansion strategies around one shared geometry system.
- Decide whether only one table should be allowed to remain expanded at a time.
- Consider whether the expansion layer should live in a React portal instead of manual DOM reparenting.
- Decide whether the expansion system should subscribe directly to shared pane state instead of inferring everything from DOM geometry.
