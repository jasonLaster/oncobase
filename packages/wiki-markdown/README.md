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

## MDX components

A page can import components and use them as block JSX elements. The page is
still parsed as markdown: imports are recognised only at the start of a line
outside code fences, and nothing in the page is executed.

```mdx
import YieldChart from "./components/yield-chart.html"
import { SlidesViewer } from "@oncobase/wiki-markdown"

<YieldChart height={450} title="Yield by specimen"
  fallback="./images/yield-chart.png" alt="Bar chart of expected yield" />
```

- **HTML components.** A default import of a local `.html` file inside a
  `components/` folder renders as an iframe with
  `sandbox="allow-scripts allow-popups"`, and the file API serves it with the
  same sandbox CSP, so its scripts never receive the wiki origin. The publisher
  uploads only `.html` files in `components/` folders (and `wiki/education/`
  labs), owned by the importing page. The frame inherits the reader's
  `color-scheme`, so `prefers-color-scheme` inside the component follows the
  app theme. To size the frame to its content, the component can post
  `parent.postMessage({ type: "oncobase:component-height", height }, "*")`.
- **React components.** Named imports from `@oncobase/wiki-markdown` resolve
  against the built-ins (`SlidesViewer`) plus the host's `mdxComponents` prop.
  `currentSlug` is passed automatically. Static HTML renders show only the
  fallback.
- **Props** must be literals: `"strings"`, `{450}`, `{true}`, or JSON such as
  `{[{"src":"a.png"}]}`. Expressions render a visible component error.
- **`fallback`** names a static image of the component. Copy as markdown
  (`toPortableMarkdown`, also used by `/api/page-copy`) and print use it in place
  of the live component. Without one, copy emits a link to the HTML source.
