# @oncobase/wiki-markdown

Shared markdown runtime for Oncobase wikis.

The Vite + LiveStore reader consumes this package through host-owned routing and data adapters.

The package owns framework-neutral markdown behavior:

- wikilinks, citation preprocessing, math cleanup, and asset URL rewriting
- server-side HTML rendering with smart-table, PDF, image, citation, math, and Mermaid transforms
- client markdown rendering for streamed/search-style content
- shared `.wiki-markdown prose max-w-none` frame and package-owned prose/media styles
- routed heading anchors, hash scrolling, image theater, and table enhancement islands

Framework adapters stay outside the package. The Vite app supplies React Router navigation, notifications, server caching, and LiveStore data.

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

## Drug explanation pills

An authored abbreviation can opt into a shadcn tooltip. The explanation stays
in the Markdown document, and works on hover, keyboard focus, or tap. Ordinary
abbreviations and inline code remain unchanged. Raw server HTML retains the
`title` explanation as a native fallback; the React reader adds the visual pill.

```html
<abbr data-tooltip="drug" data-name="Drug name" data-category="Drug class" data-target="Target" data-effect="Effect" title="One-sentence explanation.">Short name</abbr>
```

`title` is required. Name, category, target and effect are optional presentation
fields. Keep tooltip content concise and informational; put sources and detailed
clinical evidence in the surrounding page.

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
