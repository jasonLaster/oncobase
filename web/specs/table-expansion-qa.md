# Table Expansion Math And QA

Measured notes for the prose-table expansion feature.

This document captures the current geometry model, the behavioral checks that proved necessary during local debugging, and the known weak spots that still deserve extra scrutiny.

## Goal

Expanded prose tables should use the full lane between the desktop left navigation rail and the right comments rail, while keeping the collapsed in-flow shell in place for the toggle and document flow.

## Current Math

For expanded prose tables, the out-of-flow layer uses:

```ts
left = leftRail ? leftRail.right + gutter : contentLeft
right = rightRail ? rightRail.left - gutter : contentRight
width = right - left
top = shellRect.top + shellOffsetTop
```

Where:

- `leftRail` is either:
  - the collapsed left rail container (`Expand sidebar` button parent, width `48px`)
  - the expanded left rail container (`Collapse sidebar` button parent, width `256px` by default)
  - an `aside` fallback if neither button exists
- `rightRail` is the fixed comments or outline rail on large screens
- `gutter` is `20px`
- `contentLeft` and `contentRight` are only fallbacks when one or both rails are not present
- `shellOffsetTop` is the wrapper's offset inside the shell before the wrapper is moved into the expansion layer

Shell reservation uses:

```ts
shell.minHeight = shellOffsetTop + expandedWrapperHeight
```

This matters because the expanded table can become shorter once it has more horizontal width.

## Why The Old Math Was Wrong

The earlier implementation clamped the lane to the prose or content wrapper:

```ts
left = max(contentLeft, leftRail.right + gutter)
right = min(contentRight, rightRail.left - gutter)
```

That caused two regressions:

1. When the left sidebar collapsed, the table still started near the article column instead of moving left into the released space.
2. Expansion felt modest even when there was clear room between the sidebars.

Another later bug came from computing vertical alignment off the moved wrapper rather than the shell. That caused the page to scroll while the expanded table stayed visually stuck.

## Desktop QA Matrix

Viewport: `1440x900`

Measured on:

- `http://localhost:3000/sources/research/ai-models/index?token=diana`

### 1. Left Open, Right Collapsed

- Left rail: `0 -> 256`
- Right rail: `1376 -> 1440`
- Expanded layer: `276 -> 1356`
- Expanded width: `1080px`

### 2. Left Collapsed, Right Collapsed

- Left rail: `0 -> 48`
- Right rail: `1376 -> 1440`
- Expanded layer: `68 -> 1356`
- Expanded width: `1288px`

### 3. Left Open, Right Open

- Left rail: `0 -> 256`
- Right rail: `1056 -> 1440`
- Expanded layer: `276 -> 1036`
- Expanded width: `760px`

### 4. Left Collapsed, Right Open

- Left rail: `0 -> 48`
- Right rail: `1056 -> 1440`
- Expanded layer: `68 -> 1036`
- Expanded width: `968px`

## Behavioral Checks That Became Necessary

Simple width checks were not enough. These additional probes proved necessary during debugging:

### Scroll Ownership

- Verify the real document scroll owner, not just `window.scrollY`
- Verify the expanded layer moves when the scroll owner moves
- Verify wheel scrolling over the expanded table scrolls the page

### Overlay Alignment

- Verify the expanded wrapper fills the expansion layer width
- Verify the right-edge fade belongs to the expanded wrapper
- Verify the toggle moves to the expanded edge while open

### Height Reservation

- Verify shell reserved height matches the expanded shell height
- Verify widening the lane can reduce table height without leaving stale empty space

### Persistence

- Verify manual widths survive a sidebar-driven rerender
- Verify expanded state survives a sidebar-driven rerender for the same table
- Verify cleanup does not wipe persistence during remount
- Verify full page refresh clears expanded state and leaves no orphaned layer behind

## Cases To QA

### Geometry

- Desktop, left open, right collapsed
- Desktop, left collapsed, right collapsed
- Desktop, left open, right open
- Desktop, left collapsed, right open
- Desktop, after resizing the left sidebar to a custom width
- Desktop, after resizing the right comments pane to a custom width
- Desktop, after toggling either sidebar while a table is already expanded

### Interaction

- Expand first table, collapse it, expand it again
- Expand one table, then expand a different table farther down the page
- Expand after manual column resize
- Expand while scrolled deep into the article
- Collapse after scrolling horizontally inside the expanded wrapper
- Open and close the right rail while the table remains expanded

### Scrolling

- Page vertical scroll still works while hovering the expanded table
- Wheel scrolling over the expanded table moves the underlying page
- Horizontal scroll works if a table is manually widened beyond the available lane
- Expanded layer stays aligned after page scroll

### Styling

- Header background, padding, uppercase labels, zebra rows, and hover states match the in-flow table
- Toggle stays anchored in the correct place for collapsed and expanded states
- Expanded table does not overlap the right rail
- Expanded table uses more space than the collapsed prose column
- The right-edge fade travels with the expanded table

### Breakpoints

- Desktop (`>= 1024px`) uses between-rails lane math
- Tablet and mobile fall back cleanly without relying on desktop rails

## Current Known Behavior

- The smart layout engine reflows columns to fit the available lane, so expanded tables are often not horizontally scrollable by default.
- Horizontal scrolling becomes relevant mainly after manual column resizing or if content still exceeds the computed lane.
- Manual column widths now persist across the tested sidebar-plus-expand path.
- Expanded state persists across same-page rerenders only; a full refresh returns the page to a collapsed state.
- The right comments rail remains the most fragile transition because its visible controls and mounted DOM are harder to drive reliably under automation than the other flows.
- Because Liveblocks is suspended locally, outline-rail open/close is the most reliable automated right-rail probe in this environment.
