# @diana-tnbc/wiki-markdown

Shared markdown runtime for the Diana wiki.

The package owns the framework-neutral behavior that both the current Next app and the Vite + LiveStore prototype need:

- wikilinks, citation preprocessing, math cleanup, and asset URL rewriting
- server-side HTML rendering with smart-table, PDF, image, citation, math, and Mermaid transforms
- client markdown rendering for streamed/search-style content
- routed heading anchors, hash scrolling, image theater, and table enhancement islands

Framework adapters stay outside the package. The Next app supplies `next/navigation`, `next/link`, Sonner toast notifications, and the existing `.next/cache` wrapper. The Vite app supplies React Router navigation and LiveStore data. That keeps future framework changes focused on route/data plumbing instead of duplicating the markdown feature set.
