# @oncobase/diagnostics

Shared diagnostics UI and data utilities used by the Next app and the Vite wiki reader.

## Structure

- `src/timeline/` owns the diagnostic timeline component, timeline data contracts, and timeline response shaping.
- `src/studies/` owns diagnostic study metadata contracts and small URL/parsing helpers used by timeline enrichment.

Viewer and comparison components can be added under their own subpaths without coupling them to the timeline route.
