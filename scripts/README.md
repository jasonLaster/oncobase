# Scripts

Workspace-level scripts live here. They are intentionally small wrappers around CI or repository-wide checks.

## Current Scripts

- [`ci/preview-e2e-scope.ts`](ci/preview-e2e-scope.ts) decides when the preview E2E workflow needs to run based on changed paths.

App-specific operator scripts live beside the app that owns them, primarily in [`../apps/web/scripts`](../apps/web/scripts).
