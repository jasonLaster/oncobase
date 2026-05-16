# Table Expansion Testing Plan

Test plan for the prose-table expansion feature.

This document answers two questions:

1. Which behaviors should be protected by automated tests?
2. Which behaviors still need manual QA because they depend on visual judgment, input ergonomics, or layout transitions that are hard to drive reliably in automation?

It complements:

- [table-expansion.md](./table-expansion.md) for product and layout requirements
- [table-expansion-qa.md](./table-expansion-qa.md) for measured local geometry results

## Testing Strategy

We should use three layers of QA:

- **Playwright e2e** for deterministic regressions in geometry, scrolling, toggling, width persistence, and remount behavior
- **Agent-browser exploratory checks** for real browser interaction against localhost with visual confirmation
- **Manual QA** for the browser-input and visual cases that are still easy to miss even when automation is green

The biggest lesson from this feature is that width-only assertions are not enough. Table expansion is a combined geometry, scrolling, overlay, and remount feature, so every QA pass should validate:

- horizontal lane math
- vertical scroll ownership
- shell height reservation
- overlay descendant alignment
- manual-width persistence
- behavior across sidebar-driven rerenders

## Automated Coverage

The Playwright suite should cover these flows on `sources/research/ai-models/index`, since it contains multiple dense markdown tables.

### Core Expansion

- collapsed table renders with an expand toggle
- expanding creates an expansion layer
- collapsing removes the expansion layer and restores the in-flow shell
- repeated expand and collapse cycles stay stable
- shell reserved height matches the expanded shell height
- the expanded wrapper fills the expansion layer width
- the expanded toggle moves to the expanded edge

### Sidebar Geometry

- collapsing the left sidebar widens the expanded lane
- opening the right rail shrinks the expanded lane
- closing the right rail widens the lane again
- the expanded layer remains between the left and right rails

### Scroll Ownership

- while expanded, scrolling the real document scroll container moves the expanded table with the article
- the relative offset between the shell and the expansion layer stays stable during vertical scrolling
- expanded tables do not get stranded in viewport space while the article scrolls underneath them
- wheel scrolling over the expanded table moves the underlying page

### Horizontal Overflow

- manual column resizing can create horizontal overflow in the collapsed state
- after expansion, the wrapper still scrolls horizontally
- deterministic overflow injection can be used in automation to verify the expanded wrapper's horizontal scroller
- the overflow fade remains attached to the expanded wrapper rather than the collapsed prose width

### Persistence And Rerender Safety

- manual column widths survive sidebar changes and expansion
- expanded state survives layout rerenders for the same prose table
- remount cleanup must not wipe persisted expanded state
- remount cleanup must not wipe persisted manual widths
- full page refresh returns expanded tables to a collapsed state with no orphaned overlay

### Regression Hooks

- tests should inspect the actual scroll owner, not just `window.scrollY`
- tests should inspect the expansion layer's wrapper and button, not accidentally read a later in-flow table
- tests should run with desktop viewport and authenticated state
- local Playwright should assume a running localhost dev server

## Current Automated Coverage

Current [table-expansion.spec.ts](/Users/jasonlaster/src/projects/diana-tnbc/web/e2e/table-expansion.spec.ts) covers:

- expand/collapse
- left-sidebar lane widening
- scroll-owner tracking
- wheel scrolling over the expanded table
- collapsed manual resize overflow
- manual width persistence across sidebar change plus expansion
- expanded horizontal scrolling when content exceeds the lane
- expanded wrapper and toggle alignment

## Current Automation Gaps

The main remaining weak spot is the full comments-rail UI transition:

- opening and closing the desktop comments pane through the visible controls while an expanded overlay is present is still less reliable in automation than the underlying layout-state probes
- because of that, a green Playwright run should not be treated as sufficient evidence for the full right-rail interaction without a browser pass

These should remain explicitly tracked:

- right comments rail opens while a table is already expanded and the lane shrinks
- right comments rail closes while a table is already expanded and the lane widens again
- comments-pane remounts do not leave duplicate expansion layers behind
- outline-rail open/close is the preferred automated right-rail regression path while Liveblocks is unavailable locally

## Manual QA Matrix

These cases still benefit from a human pass even when Playwright is green.

### Visual Quality

- expanded table styling matches the collapsed version
- toggle button placement feels stable and intentional in both states
- the table uses meaningfully more space when expanded
- the right-edge overflow fade moves with the expanded wrapper
- the expanded wrapper does not visually inherit stale collapsed spacing

### Input Ergonomics

- trackpad vertical scrolling over the expanded table behaves naturally
- mouse-wheel scrolling over the expanded table behaves naturally
- horizontal scrolling with trackpad or shift-wheel works when overflow exists
- resize handles feel usable and do not fight the expand toggle

### Sidebar Interaction

- toggle left sidebar while a table is already expanded
- toggle right comments rail while a table is already expanded
- toggle right outline rail while a table is already expanded
- resize the right rail while a table is already expanded
- resize the left rail while a table is already expanded
- open and close the right rail repeatedly while a table stays expanded

### Multi-Table Behavior

- expand one table, scroll, then expand a second table farther down
- collapse the first after interacting with the second
- ensure only the intended table is affected by each toggle
- ensure no duplicate expansion layers remain after several table and sidebar transitions

### Persistence

- manual-resize-then-expand survives a right-pane open/close cycle
- expanded state survives a sidebar-driven rerender
- collapsing intentionally clears persisted expanded state
- manual widths persist only for the intended table, not neighboring tables

### Mobile And Tablet

- mobile renders a visible toggle without hover
- mobile expanded state remains usable and does not trap scrolling
- tablet falls back cleanly when the desktop rail assumptions are absent
- mobile/tablet do not inherit desktop-only overlay assumptions

## Agent-Browser Exploratory Flow

Use `npx agent-browser` for quick live verification when debugging layout regressions.

Recommended flow:

1. Open the page with an authenticated local URL
2. Snapshot the page and confirm the expand controls are present
3. Expand the first table
4. Verify the expanded wrapper and toggle are attached to the expanded layer
5. Scroll the document container vertically and verify the table tracks the article
6. Use wheel input over the table and verify the page still scrolls
7. Change left and right sidebar state and verify the lane updates
8. Resize a column and verify horizontal scrolling still works
9. Capture a screenshot when the issue is visual, spacing-related, or tied to overlay descendants

Important note:

- the document route may redirect to `/login` in clean sessions, so local debugging should use a stable authenticated session or the `?token=diana` flow

## Release Checklist

Before shipping changes to table expansion:

- run the Playwright table-expansion spec locally
- run typecheck
- manually verify the vertical-scroll case in the browser
- manually verify one wheel-scroll-over-table case
- manually verify one horizontal-overflow case after manual column resize
- manually verify one left-sidebar toggle case while expanded
- manually verify one right-sidebar open/close case while expanded
- manually verify one refresh-after-expand case
- manually verify the resize-then-expand path
- manually verify the overlay fade and toggle placement in expanded state

## Ownership

- [e2e/table-expansion.spec.ts](/Users/jasonlaster/src/projects/diana-tnbc/web/e2e/table-expansion.spec.ts) owns the automated regression coverage
- [interactive-tables.tsx](/Users/jasonlaster/src/projects/diana-tnbc/web/src/components/interactive-tables.tsx) owns the prose expansion behavior
- [globals.css](/Users/jasonlaster/src/projects/diana-tnbc/web/src/app/globals.css) owns the overlay styling contract
- [smart-table-layout.ts](/Users/jasonlaster/src/projects/diana-tnbc/web/src/lib/smart-table-layout.ts) owns content-aware sizing and manual-width persistence
