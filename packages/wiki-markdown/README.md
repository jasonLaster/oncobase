# @oncobase/wiki-markdown

Shared markdown runtime for Oncobase wikis.

See [`../../plans/vite-livestore-wiki-reader.md`](../../plans/vite-livestore-wiki-reader.md) for the productionization plan that explains why this package is the durable layer between the current Next app and the Vite + LiveStore reader.

The package owns the framework-neutral behavior that both the current Next app and the Vite + LiveStore prototype need:

- wikilinks, citation preprocessing, math cleanup, and asset URL rewriting
- server-side HTML rendering with smart-table, PDF, image, citation, math, and Mermaid transforms
- client markdown rendering for streamed/search-style content
- shared `.wiki-markdown prose max-w-none` frame and package-owned prose/media styles
- routed heading anchors, hash scrolling, image theater, and table enhancement islands

Framework adapters stay outside the package. The Next app supplies `next/navigation`, `next/link`, Sonner toast notifications, and the existing `.next/cache` wrapper. The Vite app supplies React Router navigation and LiveStore data. That keeps future framework changes focused on route/data plumbing instead of duplicating the markdown feature set.

## Package Boundary

This package may depend on React, markdown processors, smart tables, and browser APIs inside client islands. It should not depend on Next, Vite, LiveStore, Convex, app routes, or Diana-specific content. Host apps provide those pieces through adapters:

- route adapters for app navigation
- link components for framework-native client navigation
- notification adapters for copy/share feedback
- server cache wrappers for rendered HTML
- layout adapters for site-specific smart-table expansion behavior

Server-rendered hosts should wrap rendered HTML in `WikiMarkdownFrame` from
`@oncobase/wiki-markdown/frame` and import
`@oncobase/wiki-markdown/styles.css` from their global stylesheet. Client
hosts that render `WikiMarkdown` get the same frame contract automatically.

## Slides Viewer

Use a slides viewer when a wiki page should show a compact, step-through set of
images instead of a vertical stack. In markdown, add a `slides` marker comment
immediately before a normal list of markdown images:

```md
<!-- slides -->
- ![Baseline scan](images/baseline.png)
- ![Follow-up scan](images/follow-up.png)
- ![Treatment diagram](images/treatment-diagram.png)
```

The renderer converts that marked image list into a single viewer with Previous
and Next controls, a `1 / N` counter, and the same relative asset resolution used
by ordinary markdown images. Unmarked image lists continue to render as normal
markdown lists.

For React contexts that already have image data, import the component directly:

```tsx
import { SlidesViewer } from "@oncobase/wiki-markdown";

export function ExampleSlides() {
  return (
    <SlidesViewer
      currentSlug="wiki/treatment/index"
      images={[
        { src: "images/baseline.png", alt: "Baseline scan" },
        { src: "images/follow-up.png", alt: "Follow-up scan" },
      ]}
    />
  );
}
```

Server-rendered HTML hosts must include `SlidesViewerControls` as a client
enhancer inside the same `WikiMarkdownFrame` as the rendered HTML. The Next app's
`MarkdownRenderer` already does this. Hosts that render the shared
`WikiMarkdown` component get the controls automatically.
