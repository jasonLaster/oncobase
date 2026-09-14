# Quiet loading and refresh cues

The reader keeps its cached-first React/LiveStore handoff. These details communicate state without delaying readable content, remounting navigation, or adding network requests.

| State | Cue |
| --- | --- |
| Application launching | A softly breathing D mark above “Launching Diana TNBC...” in both initial HTML and React. |
| Page has no body yet | The existing skeleton breathes more slowly; a small “Loading page…” cue distinguishes this from launch. |
| Opening another page | Keep the current article readable and show a small “Opening page…” cue. |
| Updating a stale page | Keep the article readable and show “Updating page…”, replacing the large technical notice. |
| Checking navigation | A quiet “Checking…” label in a fixed-height Pages row; saved tree icons soften while labels stay fully readable. |
| Fresh navigation | The status clears and icons settle back to full strength. No success animation. |
| Offline or retrying | Static “Saved · offline” or “Saved · retrying” cues; links remain usable. Empty navigation does not claim to have saved pages. |

Transient cues wait 180 ms before a 160 ms opacity reveal, avoiding flashes on fast loads. Pulse duration is 2.4 seconds. Reduced-motion preferences disable these animations and icon transitions. Page cues do not intercept pointer events; the mobile position clears the existing floating action. Status is announced politely without marking the usable file tree busy.

Navigation freshness is an explicit optional sync metric, separate from general reader readiness: a failed or partial manifest refresh cannot falsely display the tree as current. No access checks, retry schedules, storage policy or fetch behavior changed.

## Validation

- Fifteen cached-startup checks passed in Chromium and WebKit, including saved content before identity verification, unchanged article/navigation nodes, scroll/search continuity, offline and retry states, and reduced motion.
- Focused page-opening and stale-page replacement checks passed. The navigation test now waits for the fixture body and excludes asynchronously attached heading-link decorations when comparing article content.
- Reviewed synthetic screenshots of launch, loading, page opening, stale-page refresh, desktop checking, and mobile dark-mode offline navigation. Screenshots remain in local test output.
- Build/typecheck and bundle budgets passed. Eager assets measured about 1131 KiB gzip (less than 1 KiB additional); the shell remained within its existing budget. Lint has no errors and one pre-existing mobile-outline effect warning.

The synthetic server must restart after a production rebuild so its in-memory HTML references the current hashed assets. Final browser checks use the matching HTML and assets.
