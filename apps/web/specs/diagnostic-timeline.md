# Diagnostic Timeline Feature Spec

This document describes the behavior verified by `apps/web/e2e/diagnostic-timeline.spec.ts`.

## Route

- `/timeline` renders the diagnostic timeline returned by `/api/timeline`.
- The page title is `Diagnostic Timeline`.
- The left navigation and bottom navigation expose the route as `Timeline`.

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
- Imaging events with known diagnostic IDs must link back to `/diagnostics` and to the DICOM viewer at `/tools/dicom-viewer?id=<diagnostic-id>` when image stacks are available.
- Result events with source pages must include a `Source page` link in the hover tooltip.

## Timeline Interaction Contract

- The default date window is April 2, 2026 through the current Pacific date.
- The `All` preset expands back to the full timeline range.
- Markers show their result details in a hover/focus tooltip.
- Result details must not appear in a persistent side panel.
- The tooltip follows the hovered marker, includes the event date, sleeve, status, result text, details, and links, and remains usable long enough to move into tooltip links.
- The active marker draws an aligned guide line across the axis and track row while the tooltip is visible.

## Axis Contract

- The axis displays labeled month ticks.
- The axis also displays week tick marks between month ticks.
- Track rows include faint week grid lines and stronger month grid lines aligned to the same visible range.

## Controls

- `Zoom in`, `Zoom out`, and `Reset range` update the visible date range.
- Plain vertical scrolling inside the plot does not zoom the timeline.
- Horizontal scrolling inside the plot pans the shared date window across all timeline rows.
- `Cmd + scroll` zooms the timeline around the cursor position.
- The `All`, `MRD`, and `Recent` presets move the visible date range to useful windows.
- Filtering keeps matching tracks and removes non-matching tracks from the rendered timeline.

## Automated Coverage

The Playwright spec verifies:

- `/timeline` renders the timeline and grouped sleeves.
- No persistent detail panel is present.
- Week ticks render in addition to month ticks.
- Zoom changes the serialized visible date range.
- Plain wheel scroll does not zoom, while `Cmd + wheel` does.
- Horizontal wheel scroll pans the serialized visible date range.
- Hovering a Signatera marker opens a tooltip with the ctDNA result and source link.
- Hovering a PET/CT marker opens a tooltip with the image viewer link.
- Filtering isolates the matching Guardant360 track.
