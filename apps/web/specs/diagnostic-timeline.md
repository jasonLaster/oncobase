# Diagnostic Timeline Feature Spec

This document describes the behavior verified by
`apps/web/e2e/diagnostic-timeline.spec.ts`. Route, header, sidebar, legacy
redirect, and diagnostics subpage regressions are covered by
`apps/web/e2e/diagnostics-regression.spec.ts`.

## Route

- `/diagnostics` renders the diagnostic timeline returned by `/api/timeline`.
- The page title is `Diagnostics`.
- The left navigation and bottom navigation expose a single `Diagnostics` route.
- The legacy `/timeline` route redirects to `/diagnostics` so older links and
  open tabs continue to land on the timeline.
- `/diagnostics/imaging` renders the diagnostic imaging table; it is a
  diagnostics subpage, not the timeline.

## Page Header Contract

- The `/diagnostics` page header contains only the `Diagnostics` heading and
  compact navigation links.
- The compact header links are:
  - `Imaging` -> `/diagnostics/imaging`
  - `Summary` -> `/wiki/diagnostics/test-results-summary`
  - `ctDNA` -> `/wiki/diagnostics/ctdna-mrd`
- The page header intentionally omits the older `As of ...` badge, event-count
  badge, and descriptive paragraph.
- Header labels are independent of the Convex seed labels: source metadata such
  as `Test results summary` or `ctDNA / MRD monitoring` is normalized into the
  compact `Summary` and `ctDNA` buttons.

## Navigation Contract

- Desktop and mobile app navigation expose one top-level `Diagnostics` entry
  linked to `/diagnostics`.
- `/diagnostics` and `/diagnostics/imaging` both use the normal app sidebar/file
  tree, not the DICOM biopsy shortcut sidebar.
- The separate `Timeline` app navigation entry is intentionally removed.
- The DICOM biopsy shortcut sidebar is reserved for `/tools/dicom-viewer`.

## Data Contract

- Timeline content is backed by the site-scoped Convex `meta` key
  `diagnosticTimeline:data` and fetched by the page through `/api/timeline`.
- The local seed command `bun --cwd apps/web run timeline:seed`
  writes the current timeline results into Convex.
- Each sleeve groups related diagnostic activity:
  - imaging and staging
  - pathology and tissue
  - ctDNA and molecular response
  - blood counts
  - chemistry and endocrine markers
- Imaging events with known diagnostic IDs must link back to
  `/diagnostics/imaging` and to the DICOM viewer at
  `/tools/dicom-viewer?id=<diagnostic-id>` when image stacks are available.
- Result events with source pages must include a `Source page` link in the
  hover tooltip.

## Timeline Interaction Contract

- The default date window is April 2, 2026 through the current Pacific date.
- Markers show their result details in a hover/focus tooltip.
- Result details must not appear in a persistent side panel.
- The tooltip follows the hovered marker, includes the event date, sleeve,
  status, result text, details, and links, and remains usable long enough to
  move into tooltip links.
- The active marker draws an aligned guide line across the axis and track row
  while the tooltip is visible.

## Axis Contract

- The top timeline header remains sticky while scrolling through the channel rows.
- The sticky header combines the visible date window, filter, diagnostic
  overview, and calendar axis.
- The diagnostic overview highlights the visible window and allows dragging that window to pan the timeline.
- The calendar axis displays labeled month ticks.
- The calendar axis also displays week tick marks between month ticks.
- Track rows include faint week grid lines and stronger month grid lines aligned to the same visible range.

## Controls

- The sticky header toolbar contains the filter input plus `Zoom in`, `Zoom
  out`, and `Reset range`.
- `Zoom in`, `Zoom out`, and `Reset range` update the visible date range.
- Timeline preset controls, shown counts, and status legend chips are intentionally omitted.
- Plain vertical scrolling inside the plot does not zoom the timeline.
- Horizontal scrolling inside the plot pans the shared date window across all timeline rows.
- Horizontal scrolling works in both directions, including leftward panning to earlier dates.
- `Cmd + scroll` zooms the timeline around the cursor position.
- Filtering keeps matching tracks and removes non-matching tracks from the rendered timeline.
- Category and swimlane magnifier buttons open a wide drill-in dialog.
- Drill-in dialogs render a larger chart with color-coded series, y-axis
  domains, and log-scale labeling where the track uses log scale.
- Category drill-ins overlay numeric swimlanes in the category, such as
  Signatera and NeXT Personal in the ctDNA sleeve.
- Grouped drill-ins render one color-coded y-axis per numeric swimlane on the
  left side of the plot so the normalized overlay is still traceable back to
  each original value domain.
- Drill-in y-axis titles are vertical and include the swimlane label plus unit
  and log-scale marker when applicable, saving horizontal space while keeping
  tick values readable.
- Drill-in SVGs use uniform x/y scaling; markers must sit directly on their
  series paths in rendered geometry.
- Drill-in markers and event diamonds expose hover/focus tooltips with the date,
  value or event label, result text, details, and source links.
- Drill-in marker, series, or axis hover activates the relevant y-axis and dims
  the other y-axes so grouped numeric overlays remain readable.

## Automated Timeline Coverage

`apps/web/e2e/diagnostic-timeline.spec.ts` verifies:

- `/diagnostics` renders the timeline and grouped sleeves.
- No persistent detail panel is present.
- The integrated top header is sticky and shows the prominent visible date range.
- The filter is visible in the sticky top header.
- Week ticks render in addition to month ticks in the sticky calendar axis.
- Zoom changes the serialized visible date range.
- Plain wheel scroll does not zoom, while `Cmd + wheel` does.
- Horizontal wheel scroll pans the serialized visible date range in both directions.
- Dragging the highlighted overview window pans the serialized visible date range.
- A swimlane magnifier opens a drill-in dialog with the larger chart and log-scale label when appropriate.
- A category magnifier opens a drill-in dialog that overlays the category's numeric swimlanes.
- Hovering a Signatera marker opens a tooltip with the ctDNA result and source link.
- Hovering a PET/CT marker opens a tooltip with the image viewer link.
- Filtering isolates the matching Guardant360 track.

## Automated Route Regression Coverage

`apps/web/e2e/diagnostics-regression.spec.ts` verifies:

- `/diagnostics` uses the compact header and renders the timeline.
- `/timeline` forwards to `/diagnostics`.
- The header `Imaging` link navigates to `/diagnostics/imaging`.
- `/diagnostics/imaging` renders the imaging table and uses the normal app
  sidebar.
- Mobile page navigation exposes only the single `Diagnostics` app route.
- Timeline imaging tooltips link to `/diagnostics/imaging` and the DICOM viewer.
- The ctDNA category drill-in keeps the explanatory note outside the SVG chart,
  renders Signatera, NeXT Personal, and Guardant360 y-axes on the left with
  vertical titles, supports track toggles and `Cmd + scroll` zooming, and shows
  popup tooltips for points.
- The Blood Counts category drill-in renders ANC, Hemoglobin, and Platelets
  y-axes on the sticky left axis panel with vertical titles, keeps SVG scaling
  uniform, verifies dots align with their paths, dims non-active axes on hover,
  and shows point tooltips with CBC source links.
