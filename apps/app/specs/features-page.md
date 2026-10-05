# Public features page

`/features` is the public, indexable page for people deciding whether to use Oncobase and for agents that want to build on it. It is Oncobase green throughout (the landing page is Diana's plum with one green band) and reads as a marketing page first: each area leads with a visual, then a short list, with tables only where a table is the clearest form.

## Routing and access

- Signed-out visitors can open `/features` with no redirect (`PUBLIC_PAGES` in `server/app-shell.ts`). It renders without a wiki session or database (`rootRouteFor` returns `features`).
- Unlike the landing and sign-in pages it is **indexable**: the server injects a canonical URL and no `noindex`, and `robots.txt` allows `/features` on the default site. Its share card ("Everything Oncobase can do") comes from `featuresRouteMetadata()` and is also served to link-preview bots.
- `/llms.txt` and `/llms-full.txt` are static public files (`.txt` passes the gate; `.md` would be treated as a wiki page). Both are generated from `src/pages/features-data.ts` by `bun scripts/build-llms-txt.ts`, and `features-data.test.ts` fails when they drift.

## One source of truth

`src/pages/features-data.ts` holds the six areas, every feature (name, one sentence, where it lives, and the API/CLI interface when it has one), the interface table for agents, and the "details" list. The page's full table, interface table, and details cards, plus both text files, render from it. Add a feature there and run the generator.

## Sections

1. **Hero.** "Everything Oncobase can do." The lede names attention to detail. A real screenshot with three numbered pins (page tree, smart tables, outline) and a map of the areas.
2. **Read.** File palette, tables at two widths, the phone reader (three phones), illustrations in light and dark (draggable compare), and six cards.
3. **Ask.** A chat conversation showing the agent's steps and citations, a four-step flow of how it finds context, AI search, and a table of which tool to use when.
4. **Protect.** A five-layer flow, the interactive role and redaction demos from the landing page, six cards, and the rules agents follow for redaction.
5. **See the data.** Diagnostics timeline and imaging viewer cards, plus cards for comparison, pathology, touch, lab import, comments, and previews.
6. **The details.** "Built with attention to detail." 18 cards, most tagged with how they are verified.
7. **Build.** The publish loop, starter commands, and the interface table for agents and scripts.
8. **The full list**, a closing call to action, and a footer that keeps the osteosarc.com credit and the CC BY credit for the MRI image.

## Accuracy rules

Claims come from the code, checked in October 2026. Do **not** claim: sorting, filtering, or search inside tables; an MCP server; automatic dark-theme swapping of `data-theme-pair` images in the reader (only the `-light` file shows there; the landing, sign-in, and this page choose the matching file themselves); table column widths beyond the session; or that link previews are re-redacted. The redaction skills that spell out what to hide live in Diana's vault, not in this repository; the CLI ships only `wiki-quickstart` and `check`.

## Screenshots

Real UI rendered through the e2e mocks (`omitBasePages` in `e2e/fixtures.ts`) from an authored, fictional sample vault, in light and dark, so nothing shows real patient data. Each is captioned as sample content. Recipe and specs: `.claude/skills/public-page-review/features-capture/`. Output sizes: reader 1800w, palette 1280w (cropped), AI search 1600w (cropped), tables 1400w and 800w, phones 520w. Files live in `public/feature-shots/` (allowlisted in `scripts/public-assets.ts`). The timeline and imaging cards reuse the landing images (`specs/landing-page.md`).

## Verification

`e2e/features-page.spec.ts` covers the header anchors, that every feature and interface appears, themed image loading and the theme toggle, the compare slider, no horizontal scroll at 360, 390, and 1440px, outbound links, the text files, and axe in light and dark. `standalone-routes.spec.ts`, `app-shell.test.ts`, `local-smoke.ts`, and `verify-standalone.ts` cover the public route.
