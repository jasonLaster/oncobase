# DICOM Viewer Feature Spec

This document describes the behavior verified by `apps/web/e2e/dicom-viewer.spec.ts`.

## Routes

- `/diagnostics` lists the biopsy imaging shortcuts.
- `/tools/dicom-viewer?id=biopsy-2026-04-10` opens the April 10 biopsy stack.
- `/tools/dicom-viewer?id=biopsy-2026-03-23` opens the March 23 axilla biopsy stack.
- `/tools/dicom-viewer?id=biopsy-2026-03-13` opens the March 13 biopsy stack.

The viewer also accepts `biopsyId` and `seriesId` query parameters. `id` and
`biopsyId` are human-facing biopsy IDs. `seriesId` is the raw DICOM series id.

## Diagnostics Page Contract

The diagnostics page must show the three known biopsy IDs:

- `biopsy-2026-04-10`
- `biopsy-2026-03-23`
- `biopsy-2026-03-13`

Each card must link to the DICOM viewer with `id=<biopsy-id>`. The page is a
workflow surface, not a marketing page.

## Viewer Deep-Link Contract

When a biopsy ID is present, the viewer selects the largest renderable DICOM
series matching that biopsy date and directory. Renderable means image-bearing
modalities only; `SR`, `PR`, and `OT` objects are excluded from the selectable
series list.

Expected stacks:

| Biopsy ID | Expected date | Expected directory | Expected count |
| --- | --- | --- | --- |
| `biopsy-2026-04-10` | `2026-04-10` | `4-10 biopsy` | `9` |
| `biopsy-2026-03-23` | `2026-03-23` | `3-23 - US Axilla biopsy` | `45` |
| `biopsy-2026-03-13` | `2026-03-13` | `3-13 - Biopsy` | `19` |

## Tool Mode Contract

The primary left-drag tool is selected by the toolbar:

- `W/L` is the default window/level tool.
- Clicking `Zoom` activates zoom.
- Clicking active `Zoom` again returns to `W/L`.
- Clicking `Pan` activates pan.
- Clicking active `Pan` again returns to `W/L`.
- Switching from `Zoom` to `Pan` changes the active primary tool without
  resetting the current viewport camera.
- On touch devices, one-finger drag uses the selected toolbar tool.
- Two-finger pinch or drag remains available for zooming and panning the image.

Each tool button exposes `aria-pressed` so tests and assistive technology can
read the active state.

## Slice Loading Contract

Slice navigation must distinguish between the currently rendered image and the
requested image:

- Clicking next/previous or changing the slice slider requests a new image.
- If the image is not already decoded and cached, the viewport keeps the old
  image visible and shows a `Loading image N` overlay.
- When Cornerstone finishes loading and rendering the requested image, the
  overlay disappears and the slice counter reflects the newly rendered image.
- Cached images may transition immediately without showing the overlay.

## Prefetch Contract

After initial stack load and after each successful slice change, the viewer
prefetches nearby slices with Cornerstone's image cache:

- next slice
- previous slice
- second next slice
- second previous slice

Prefetch is opportunistic. Failures are ignored because normal navigation will
surface real image-load errors.

## Out Of Scope

- File upload and folder selection are intentionally not supported in this
  viewer surface.
- Full diagnostic report parsing is intentionally out of scope.
- Window/level, pan, and zoom persistence across page reloads is not required.
