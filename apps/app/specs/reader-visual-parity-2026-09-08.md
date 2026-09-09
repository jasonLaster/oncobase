# Reader visual parity audit

Compared production with the final Next.js source (`52e12889`) in the isolated reference worktree, using the same published homepage and insurance article. Captured light/dark screenshots at 393×852, 1440×1000, and 1920×1080, plus workspace menu, collapsed sidebar, file palette and mobile navigation states. Wait for the reference's full file tree: its partial navigation paint otherwise creates misleading typography/content differences. Its green development logo and Next.js badge are environmental.

## Corrections

- Initial article headers now use the interactive header structure, copy-control footprint and tag links. Header, title and tag bounding boxes remain equal through delayed-script handoff at 393, 768, 1440 and 1920px.
- The initial mobile header shows the current page title and consistently sized navigation/search/comments controls, plus the original floating chat glyph. A head observer closes the native menu while the article is still streaming, preventing it from covering the first paint until the response finishes.
- Native page copying works once the embedded public page payload arrives, without waiting for application modules. Its keyboard focus transfers to the interactive copy button. Without a usable payload/clipboard, the control stays disabled.
- Native table columns have readable minimum widths and scroll within the table wrapper on narrow screens. They no longer split ordinary words into tiny columns before enhancement.
- Heading permalink markers retain their generated classes after sanitization and match the reference's visible links and desktop gutter placement.
- Mobile file and utility rows use the reference's 14px type. Sidebar hover/focus reveals directory indicators across the rail; the workspace mark and page-copy/mobile-chat glyphs match the original shapes.

## Evidence and limits

Ignored local artifacts live in `.playwright/visual-audit`. `comparison.html` switches between the reference, updated native view and updated interactive view at matching viewports/themes. `pass-0` contains the reference/before captures and `pass-1` the updated captures. Keep clinical screenshots and authenticated browser artifacts out of version control.

This is a scoped parity improvement, not evidence that every route and state is identical. Native tables still use browser auto layout; adaptive column sizing and desktop outline controls arrive with the interactive application. Rich diagrams and image enhancement also remain application features. These differences are visible in the comparison rather than hidden by a passing test count.

The inline presentation fixes add no stylesheet/network dependency. The shared legacy glyphs raise the LiveStore shell's measured gzip size from 16,775 to 16,948 bytes. Its ceiling is 17,024 bytes; other bundle budgets are unchanged.

## Validation

- Production build/typecheck, bundle budgets and scoped lint pass (one unchanged outline-effect warning in Navigation).
- Server renderer/navigation tests: 12 passed.
- Chromium reader/visual/heading coverage: 75 passed across the main run and focused rerun. The mobile-navigation assertion previously encoded the replacement Lucide icon; it now checks the original Next.js artwork. Existing screenshot baselines required no updates.
- Firefox startup/header/streaming coverage: 11 passed.
- WebKit header/streaming coverage: 6 passed.
- Native page copying, streaming-prefix menu closure, title/tag geometry, mobile row typography and sidebar hover state have explicit regression assertions.

Production verification covered light/dark at 393px and 1440px: stable initial/live header geometry, readable native tables, mobile navigation, sidebar hover and Cmd+O, with zero browser errors. A follow-up streaming check also preserves a native menu opened before the response finishes; the body bootstrap no longer closes it a second time.
