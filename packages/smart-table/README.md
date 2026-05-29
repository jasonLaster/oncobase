# `@diana-tnbc/smart-table`

Adaptive React tables for dense content.

The package focuses on the awkward cases that basic table wrappers tend to miss:

- content-aware column sizing for prose-heavy cells
- manual column resize handles
- optional overlay expansion on wider viewports
- progressive enhancement for already-rendered HTML tables
- package-owned CSS classes and variables instead of host-app Tailwind scanning

## Installation

```bash
bun add @diana-tnbc/smart-table
```

or

```bash
npm install @diana-tnbc/smart-table
```

Import the stylesheet once near your app root:

```ts
import "@diana-tnbc/smart-table/styles.css";
```

## Entry Points

The package exposes two usage layers:

- `@diana-tnbc/smart-table`
  Client-facing React components such as `SmartTable` and `SmartTableEnhancer`
- `@diana-tnbc/smart-table/layout-adapter`
  Generic layout adapter types and helpers for overlay geometry
- `@diana-tnbc/smart-table/examples`
  Reusable example fixtures for QA, visual checks, and tests

If you need layout helpers in a server-safe module, import them from the
`/layout-adapter` subpath instead of the root component entry.

## Basic Usage

```tsx
"use client";

import {
  SmartTable,
  SmartTableBody,
  SmartTableCell,
  SmartTableHead,
  SmartTableHeader,
  SmartTableRow,
} from "@diana-tnbc/smart-table";

export function Example() {
  return (
    <SmartTable>
      <SmartTableHeader>
        <SmartTableRow>
          <SmartTableHead>Name</SmartTableHead>
          <SmartTableHead>Summary</SmartTableHead>
        </SmartTableRow>
      </SmartTableHeader>
      <SmartTableBody>
        <SmartTableRow>
          <SmartTableCell>Alpha</SmartTableCell>
          <SmartTableCell>
            Longer prose content wraps and informs sizing.
          </SmartTableCell>
        </SmartTableRow>
      </SmartTableBody>
    </SmartTable>
  );
}
```

## Enhancing Existing HTML Tables

Use `SmartTableEnhancer` when your app already renders raw HTML tables from
Markdown, CMS content, or sanitized rich text.

```tsx
"use client";

import { SmartTableEnhancer } from "@diana-tnbc/smart-table";

export function RenderedMarkdown({ html }: { html: string }) {
  return (
    <div className="prose">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <SmartTableEnhancer />
    </div>
  );
}
```

## Custom Layout Adapters

Overlay expansion is intentionally host-controlled. When your app has sidebars,
sticky rails, split panes, or custom resize events, provide a
`SmartTableLayoutAdapter`.

```tsx
import type { SmartTableLayoutAdapter } from "@diana-tnbc/smart-table/layout-adapter";

const adapter: SmartTableLayoutAdapter = {
  shouldUseOverlay() {
    return window.matchMedia("(min-width: 1024px)").matches;
  },
  getOverlayLayout({ shell, shellOffsetTop }) {
    const rect = shell.getBoundingClientRect();
    return {
      parent: document.body,
      left: 48,
      top: rect.top + shellOffsetTop,
      width: window.innerWidth - 96,
    };
  },
};
```

Then pass it into either `SmartTable` or `SmartTableEnhancer`.

```tsx
<SmartTable layoutAdapter={adapter} />
```

## Styling And Theming

The package ships its own class names and semantic CSS variables, so consumers
do not need to add `node_modules` or workspace package sources to Tailwind
scanning.

Available variables include:

- `--smart-table-surface`
- `--smart-table-surface-muted`
- `--smart-table-border-color`
- `--smart-table-foreground`
- `--smart-table-muted-foreground`
- `--smart-table-accent`
- `--smart-table-brand`

Override them in your app theme as needed:

```css
:root {
  --smart-table-surface: #fbfaf6;
  --smart-table-border-color: #d7d0c4;
  --smart-table-brand: #1f5f4a;
}
```

## Public API

Root entry:

- `SmartTable`
- `SmartTableHeader`
- `SmartTableBody`
- `SmartTableRow`
- `SmartTableHead`
- `SmartTableCell`
- `SmartTableEnhancer`
- `InteractiveTables`
- `defaultSmartTableToggleLabels`

Layout adapter subpath:

- `createViewportSmartTableLayoutAdapter`
- `defaultSmartTableLayoutAdapter`
- `getDefaultVerticalScrollContainer`
- `SmartTableLayoutAdapter`
- `SmartTableOverlayLayout`
- `SmartTableBleed`

Fixture subpath:

- `exampleTables`
- `buildExampleTablesDocument`
- `renderExampleTableSection`
- `renderMarkdownTable`

## Testing Fixtures

The `@diana-tnbc/smart-table/examples` export provides a shared corpus of table
fixtures so package-level tests and host-app browser tests can validate the same
inputs.

## Development

From the monorepo root:

```bash
bun run build
bun run test:unit
bunx playwright test apps/web/e2e/table-examples.spec.ts apps/web/e2e/table-expansion.spec.ts --project=tests
```
