# UI SDK migration plan (2026-11-23)

Status: this is a plan for review, and nothing in it has shipped. Scope: every interactive widget in `apps/app`, `apps/oncoguide` and `packages/*` that a [UI SDK](https://ui-sdk.dev/) component could replace. That covers the three UI libraries we use today (`@base-ui/react`, `cmdk`, `sonner`) and every hand-written dialog, menu, palette, tree, tab, slider, splitter and toast.

## 1. Recommendation

Migrate in five phases. Lazy chunks go first, and the reader's paint path goes last, behind its own budget decision.

- **Phase 0. Delete code before migrating it.** Most of the chat UI layer is unused: Command, Dialog, DropdownMenu, HoverCard, Select, Tooltip, Input, and about 1,000 of the 1,461 lines in `prompt-input.tsx`. Deleting it removes `cmdk` and `sonner` and most uses of `@base-ui/react` in chat. It also removes a bug where pasting drops files and text. No UI SDK code is needed.
- **Phase 1. Pilot on lazy pages that have few tests:** admin, cellularity, the chat splitter and the features slider. This proves the styling conventions, the vendor chunk and the test pattern. It should also clear three known failures in the keyboard ratchet.
- **Phase 2. Move the lazy overlays shared by both readers:** the command and file palettes, search results, dialogs, the image theater, diagnostics tooltips and menus, and the chat transcript and composer. When this phase is done, `@base-ui/react` is gone from the repo.
- **Phase 3. The paint path, gated.** This covers the actions menu, auth dialog, mobile sheet, toast, resizable layout and sidebar tree. It starts only after a holistic proposal to raise the eager bundle budget is accepted, and after UI SDK server output is shown to hydrate without layout shift.
- **Phase 4. OncoGuide (Next):** theme Preferences, talk-board toggles and collapsibles. The shared palette comes for free from Phase 2.

Pin the exact version (`0.1.0-beta.13` or later) and upgrade on purpose. The library is 11 days old and in beta, and its docs warn that APIs may change.

## 2. What UI SDK is, and what it costs

- **What it is.** `@ui-sdk/react` and `@ui-sdk/core` from vercel-labs/ui.
  - It provides about 55 unstyled behaviour components: no provider, no portal, and popups render in the browser's top layer.
  - Each component has its own entry point (`@ui-sdk/react/dialog`), and there is no root import.
  - Styling hooks are `data-slot` and state attributes such as `data-open`, `data-pressed` and `data-starting-style`/`data-ending-style`, plus a `@layer ui-sdk` stylesheet (`@ui-sdk/core/web.css`).
  - It renders on the server: components carry `"use client"` and render their ARIA state in the initial HTML.
- **Requirements.** React ≥ 19 and `@types/react` ≥ 19.2.10. We have 19.2.6 and 19.2.14, so both are met.
- **Missing pieces that matter here:**
  - No component does the windowing itself. Tree, Command and Listbox take the full `items` list and each row's `index`. You render the visible window, so keep `@tanstack/react-virtual`.
  - Command's Escape clears the query before it closes, and Home/End stay in the input. Both differ from the current palettes.
  - A standard Menu closes on Tab. The keyboard gate currently expects Tab to stay inside the actions menu.
  - The docs give no bundle sizes and no migration guides.

### 2.1 Measured size (esbuild minify, gzip -6, React external)

The test harness is in the scratchpad: `uisdk-size/`.

| Import | UI SDK | Base UI today |
| --- | ---: | ---: |
| Button | 11.2 KB | 3.0 KB |
| Toggle | 12.5 KB | — |
| Scroll Area | 17.7 KB | — |
| Toast (`toast` + `ToastRegion`) | 24.3 KB | — (sonner unused) |
| Tree | 26.2 KB | — |
| Command | 27.9 KB | — (cmdk unused in app) |
| Hover Card | 31.4 KB | 32.7 KB (PreviewCard) |
| Tooltip | 33.7 KB | 34.4 KB |
| Dialog | 45.6 KB | 26.1 KB |
| Tooltip + Dialog | 53.9 KB | — |
| Tooltip + Dialog + Menu | 65.1 KB | — |
| The 8 parts Base UI is used for today | 94.5 KB | 75.9 KB |
| `web.css` | 12.8 KB | — |

How to read this:

- **The floor.** About 11 KB of kernel (`use-primitive`, `part`, `primitive`, `store`, `modality`) is shared by every component.
- **Popups.** Anything that pops up adds about 20 KB of popup, position and layer code. After that, each extra component costs roughly 8–12 KB.
- **Cost against today.** Swapping the libraries one-for-one costs about 19 KB more in total. The win is in deleting hand-written behaviour and fixing accessibility, not in bytes.
- **Where Base UI sits today.** In the current build, Base UI ships only in lazy chunks:
  - `ChatPage` (49.4 KB)
  - `annotated-term-tooltip` (14.6 KB)
  - a 12.1 KB shared chunk
- **The eager path has no popup library.** Adding UI SDK to the paint path means +34 KB (one tooltip) to +65 KB (tooltip, dialog and menu) of eager gzip. The reader entry budget is 24.9 KB and `WikiViteRoot` is 20.7 KB. That is why Phase 3 is gated.

## 3. Where we are today

| Package | Libraries | Hand-written widgets (main ones) |
| --- | --- | --- |
| `packages/chat` | base-ui (Button, Input, Dialog, Menu, Select, PreviewCard, Tooltip), cmdk, sonner (declared, never imported), `use-stick-to-bottom` | Kebab menu with no `role=menu`, Collapsibles for reasoning and sources |
| `packages/wiki-shell` | `@tanstack/react-virtual` | File palette (dialog and combobox), actions menu, auth dialog, mobile sheet, sidebar tree, two resizable panes, review-panel tree and tabs, search-mode toggle, toast, Cmd+K chords |
| `packages/wiki-markdown` | base-ui Tooltip | Image theater (native `showModal`), waterfall segmented control |
| `packages/wiki-comments` | Liveblocks UI | Dropdown menu, mobile bottom sheet, two resizable panes |
| `packages/diagnostics` | — | Timeline dialog, two timeline tooltips (about 180 LOC), overview brush, imaging menu, pathology tabs and toolbar, DICOM splitters, toggle groups |
| `packages/education` | — | Theme toggle |
| `apps/app/src` | — | About 60 widgets: command palette modes, search tree, admin modal, menu, tabs and radio group, share dialog, Talk consent card, chat splitter, education drawer, sliders, segmented controls, PDF toolbar, shortcuts |
| `apps/oncoguide` | — | Theme script, talk-board toggles, collapsibles (mostly uses the shared packages) |

The keyboard ratchet (`apps/app/surface-gates/known-keyboard-failures.json`) currently tolerates these failures, and a migration should remove them:

- `admin-create-role-{escape,focus-return,tab-trap}`
- `actions-menu-tab-trap`
- `expanded-table-*` (smart-table; out of scope, see §8)

## 4. Ground rules

1. **One styled layer, shared by both readers.** Add `packages/ui`, which wraps UI SDK parts with our classes (`Dialog`, `Menu`, `Tooltip`, `Command`, `Tree` and so on). This follows the reader-unification approach of building the shared component once.
   - App code imports `@oncobase/ui/*` and never `@ui-sdk/react/*` directly.
   - An ESLint `no-restricted-imports` rule enforces that.
   - Upgrading the beta then touches one package.
2. **Keep the per-component entry points.** Use `@oncobase/ui/dialog`, never a barrel export. This keeps the lazy splits intact.
3. **One vendor chunk.** Add `vendor-uisdk` to `vendorChunk()` in `apps/app/vite.config.ts` and give it a budget in `check-bundle-budget.ts`.
   - Assert that the chunk is not in the eager graph until Phase 3. Today's eager-reachability check can be extended for this.
4. **Styles.** In `apps/app/src/styles.css`, put `@layer ui-sdk;` above `@import "tailwindcss";`.
   - Import `@ui-sdk/core/web.css` only if we keep its defaults. Our styling is our own, so the likely answer is to import only the minimal layer.
   - Style through `data-slot` and state attributes, never generated ids.
   - Keep `motion-reduce:` variants.
   - OncoGuide does the same in `app/layout.tsx`.
5. **Keep the test contracts.** Every `data-test-id`, accessible name and WebMCP selector listed in §7 survives a migration, or that PR updates the test and gives the reason.
6. **Delete, don't wrap.** Each migration PR removes the hand-written key, focus and outside-click handling it replaces. Leaving the old handlers next to the SDK ones gives double-Escape bugs.
7. **Ratchet down.** When a migration fixes a known keyboard-gate failure, remove its entry in the same PR.
8. **Small PRs, one widget family each,** following the usual rule of pushing once checks are green. Visual changes go through the `oncobase-visual-diff` skill. Overlay changes run the surface-gates keyboard suite locally.

## 5. Phases

### Phase 0. Groundwork (no visible change)

| # | Work | Deletes |
| --- | --- | --- |
| 0.1 | Delete the unused chat UI: `components/ui/{command,dialog,dropdown-menu,hover-card,select,tooltip,input}.tsx`, the unused `PromptInput*` exports, and the attachment, drop and paste machinery in `prompt-input.tsx` (`:181-486`, `:538-842`, `:1015-1040`). Remove the `cmdk` and `sonner` dependencies. | About 1,900 LOC, 2 dependencies. Fixes paste-drops-text and the invisible-attachment Backspace bug. |
| 0.2 | Add `packages/ui`. Pin `@ui-sdk/react` and `@ui-sdk/core` to the exact same version. Add the `vendor-uisdk` chunk group and its budget, the lint rule, the CSS layer order, and the agent skill (`node_modules/@ui-sdk/core/skills/ui-sdk/SKILL.md`, referenced from repo agent docs). | — |
| 0.3 | Add a tiny SSR smoke test: render `@oncobase/ui` Dialog, Tooltip and Tree through `server-entry.tsx`'s renderer, then hydrate under the jsdom harness and assert no hydration warnings. Phase 3 depends on this. | — |

The only live chat parts that remain after 0.1 are `PromptInput`, `PromptInputBody`, `PromptInputFooter`, `PromptInputTextarea` and `PromptInputSubmit` (checked: only `chat-interface.tsx` imports them), plus `Conversation*`.

### Phase 1. Pilot on lazy pages with few tests

| # | Target | UI SDK | Notes |
| --- | --- | --- | --- |
| 1.1 | `apps/app/src/admin/AdminPage.tsx`: `AdminModal` `:510-544`, delete confirmation `:253-262` | Dialog, Alert Dialog | Clears three keyboard-gate failures. `admin.spec.ts:111` dialog name stays the same. |
| 1.2 | `AdminPage.tsx` `RoleRow` menu `:374-403` | Menu | Today it has no arrow keys, no Escape and no outside click. |
| 1.3 | `AdminPage.tsx` tabs `:462-465`, radio group `:598-604`, preview filter `:479-485` | Tabs, Radio or Segmented Control, Toggle Group | The ARIA is invalid today: tabs with no panels, and a radiogroup made of pressed buttons. |
| 1.4 | `apps/app/src/chat/ChatPage.tsx:126-196` splitter | Resizable | Gains keyboard support. Keep the sessionStorage key. |
| 1.5 | Cellularity tabs, segmented controls, "expand all" `<details>` and the unlabelled range inputs (`CellularityPage`, `BlocksAndValidationSection`, `B6CircleExplorer`, `ReconcileAndRcbSection`, `TumorModel3D`) | Tabs, Segmented Control, Accordion (controlled), Slider, Toolbar | Adds the missing slider labels. |
| 1.6 | `pages/FeaturesShowcase.tsx:57-156` theme-compare handle | Slider | Keep the accessible name "Compare light and dark" (`features-page.spec.ts:90`). |

Exit criteria:

- The three admin entries are removed from the keyboard ratchet.
- The `vendor-uisdk` size is recorded.
- The visual diff is clean, or its changes are intended.
- Write down what styling the wrappers needed.

### Phase 2. Lazy overlays, shared by both readers

| # | Target | UI SDK | Notes |
| --- | --- | --- | --- |
| 2.1 | `wiki-shell/src/file-palette.tsx` and `palette.tsx`, plus `apps/app/src/shell/CommandPalette.tsx` (outline, assets, tags, actions and debug modes) | Dialog + Command (`filter={false}`, external ranking) | Deletes about 150 LOC in the package and 120 in the app: trap, scroll lock, focus restore, active-descendant handling, `scrollIntoView`. Keep `command-palette-pages.ts` ranking and the virtualizer (render `state.items` windowed). See decision §9.2. Contract: combobox "Search pages", `option` + `aria-selected`, `command-palette` / `command-palette-input` test ids. |
| 2.2 | `apps/app/src/pages/SearchPage.tsx:377-539, 719-740, 966-1008` | Tree (text results), Listbox (AI results), Segmented Control (mode, `:313-362`) | The current keyboard navigation only changes styling, so this is a real accessibility fix. Update `search.spec.ts:180` (`aria-pressed` becomes the segmented control's state). |
| 2.3 | `pages/PageShareDialog.tsx`, `talk/TalkPanel.tsx:224-235` + `TalkHost.tsx:16-21` | Dialog (modal); Dialog `modal={false}` or Popover | The triggers render on the server, and the dialogs are lazy. |
| 2.4 | `wiki-markdown/src/image-theater-modal.tsx` + the Escape shim in `image-theater-preview.tsx` | Dialog (+ Carousel for prev/next, optional) | Keep "Next slide" and the `.wiki-image-theater__button` count (`themes.spec.ts:77`). The delegated opener in `image-theater.tsx` stays vanilla. |
| 2.5 | `wiki-markdown/src/ui/tooltip.tsx` → `@oncobase/ui/tooltip` | Tooltip | Keep the lazy split (`annotated-term.tsx:13-18`). Tooltip groups replace the provider. Keep `delay=250` and `closeOnPress={false}`. Use `toggleable` for tap-to-open. `drug-tooltips.spec.ts:23` asserts `data-slot="tooltip-trigger"`. UI SDK sets its own `data-slot` names, so check that it uses the same one, or change the test to select by role. Rendering in the top layer fixes clipping inside tables. |
| 2.6 | Diagnostics: `timeline/ui.tsx` dialog, `TimelineTooltip` and `DrilldownTooltip` (about 180 LOC), `imaging/index.tsx:214-250` menu, pathology tabs and toolbar, DICOM and timeline toggle groups | Dialog, Hover Card (with virtual anchor), Menu, Tabs, Toolbar, Toggle Group | The timeline tooltip holds links inside `role=tooltip`, which is wrong; Hover Card is the right fit. Keep the `timeline-*` test ids and `imaging.spec.ts:73`. |
| 2.7 | `wiki-comments/src/menu.tsx`, mobile comments sheet `index.tsx:1404-1475` | Menu, Drawer | Adds the missing trap and Escape. The "Resize comments panel" separator at `:1424` does nothing, so wire it up or delete it. |
| 2.8 | `wiki-shell/src/wiki-edit-review-panel.tsx`: tree `:140-230`, tabs `:552-581`, Escape `:342-351` | Tree (`treeFromPaths`), Tabs, Drawer or Dialog `modal={false}` | Fixes an invalid tree and an unguarded window Escape. |
| 2.9 | `chat/src/components/conversation-actions-core.tsx` kebab, `messages.tsx` reasoning and sources disclosures, `wiki-shell/src/wiki-chat.tsx:170-200` | Menu, Collapsible | |
| 2.10 | Chat transcript `ai-elements/conversation.tsx` (`use-stick-to-bottom`) | Scroll Area `stickToEnd` + `ScrollAreaScrollToEnd` | Drops a dependency. `role="log"` / `aria-live` move onto the viewport. The smooth-spring animation is lost (decision §9.5). Keep `chat-message-log`. |
| 2.11 | Chat composer, the remaining `PromptInput*` and `ui/{button,textarea,input-group,spinner}.tsx` | Field + Textarea + Button | Keep the IME-safe Enter-to-submit. **WebMCP contract** (`apps/oncoguide/components/webmcp-tools.tsx:53-66`): `textarea#learning-question`, the enclosing `form`, `button[type=submit]`, and a `type=button` labelled "Stop". After this step `@base-ui/react` has no imports left; remove it from `chat` and `wiki-markdown`. |
| 2.12 | `apps/app/src/education/EducationApp.tsx:464-586` mobile menu + Cmd+K | Drawer, `useShortcut` | Adds a focus trap, `inert` and focus return. |
| 2.13 | `pages/PdfViewerPage.tsx:125-141`, `medical-deduction-calculator.tsx` (range + text pairs, years buttons, `NumberInput`, heatmap `td role=button`), `SignInPage.tsx` | Toolbar + Number Input/Pagination; Slider + Number Input, Segmented Control, Button; Field + Password Input | Keep the `clinical-tools.spec.ts:308` slider names and the `sign-in-page` input wait. |
| 2.14 | Marketing demos (`LandingShowcase`, `DiagramDemo`, `TableDemo`, `CallDemo`, `CommentsDemo`) | Switch, Toggle Group, Tabs, Button | Low risk and low value; do them last. |
| 2.15 | Simple shortcuts: `chat-interface.tsx:668-683` (Cmd+/), DICOM and compare viewer keys, `Header.tsx:92-102` debug chord | `useShortcut` | Not the pre-React chords (see §6). |

Exit criteria:

- `@base-ui/react`, `cmdk`, `sonner` and `use-stick-to-bottom` are all gone.
- The keyboard ratchet is unchanged or better.
- The `vendor-uisdk` chunk is still lazy-only.

### Phase 3. The reader paint path (gated)

Two things must happen first:

- A holistic eager-budget proposal must be accepted. The floor is +34 KB gzip for one popup component, and about +65 KB for the actions menu, auth dialog and tooltips together.
- The 0.3 SSR smoke test must be extended to the real shell and come back clean under `surface-gates/layout-shift.spec.ts`.

An alternative is to keep these widgets' triggers as server-rendered plain buttons, then lazy-load the UI SDK popup on first interaction or idle. That moves the bytes off the paint path. The pre-React shortcut queue already models this handoff.

| # | Target | UI SDK | Notes |
| --- | --- | --- | --- |
| 3.1 | `WikiToast` + `WikiPage.tsx:207,302-315,520` timer | `toast()` + `ToastRegion` | Smallest eager cost (24 KB); the region can be lazy-mounted. |
| 3.2 | `wiki-shell/src/actions-menu.tsx` `WikiActionsMenu` | Menu | Decide Tab behaviour first (§9.3). Update `actions-menu-tab-trap` and the menu-role specs (`navigation.spec.ts:200-215`, `accessibility.spec.ts:124`, `blocked-storage.spec.ts:52`, `access.spec.ts:28`). |
| 3.3 | `WikiAuthDialog` (`actions-menu.tsx:223-420`) | Dialog + Field / Input / Password Input | Nested inside the mobile sheet, so do 3.4 in the same window. Dialog names "Sign in"/"Sign up" and `wiki-auth-dialog` stay. The server snapshot is covered by `server-safety.test.tsx:27`. |
| 3.4 | `WikiMobileNavigationSheet` (`navigation.tsx:444-575`) + "Page nav / Outline" switch | Drawer + Tabs | Deletes about 75 LOC, including the hand-stepped Safari Tab loop. `markdown.spec.ts:83` targets `button "Outline"` and becomes `tab`. |
| 3.5 | `PageActions` (`PageActions.tsx:82-96`), `title=`-only icon buttons in `Navigation`, `TalkHost`, `TalkPanel` | Toolbar, Tooltip | Tooltip is the 34 KB floor, so batch it with 3.2/3.3. |
| 3.6 | `resizable-layout.tsx`, `right-rail.tsx:333-380`, wiki-comments panes (`index.tsx:593-625, 1555-1590`), DICOM rail splitters | Resizable | Deletes about 270 LOC, and four of the five gain keyboard support. **SSR gap:** UI SDK renders `defaultSize` on the server and restores saved sizes after hydration unless they come from a cookie. Today `sidebar-startup.ts` writes a CSS variable before paint. Either move pane sizes to a cookie that `server/app-shell.ts` reads, or keep the pre-paint variable and use Resizable only for interaction (decision §9.4). |
| 3.7 | `WikiTree` (`navigation.tsx:198-423`) + `shell/tree-expansion.ts` | Tree (`visibleTreeRows`, controlled `expanded`, `render` for links) + the existing virtualizer | Highest risk. The keyboard model changes from one Tab stop per row to one Tab stop with arrows and typeahead. Expansion moves from a Map with a default callback to an explicit array. Duplicate slugs need occurrence keys. Server-rendered markup must match. `runtime.spec.ts:420,438` asserts `data-virtualized`. Do this last, behind a reader flag, with a `repeat-each` stress run. |

### Phase 4. OncoGuide (Next 16)

- Theme: replace `apps/oncoguide/app/layout.tsx`'s inline `themeScript` and `packages/education/src/theme-control.tsx` with `Preferences` + `createColorScheme`. `<html>` already has `suppressHydrationWarning`. Check `oncoguide/e2e/themes.spec.ts` and `public.spec.ts:251-268`.
  - The reader app could adopt the same Preferences module later, but the reader's theme bootstrap is in the head-script path, so treat that as part of Phase 3.
- `talk-board.tsx` topic buttons → Toggle Group. "What to notice" → Collapsible.
- The file palette and image theater arrive with Phase 2 through the shared packages. Re-run `oncoguide/e2e/file-palette.spec.ts`.
- Leave `education-frame.tsx` `<details>` and `lesson-visual.tsx` `VisualZoom` alone. Both are native and work before hydration.

## 6. Not migrating

- **Pre-React code paths:**
  - `bootstrap/reader-shortcuts.ts` and `wiki-shell/src/command-palette-chords.ts`. They are serialized into the head and queue input before JS, and `useShortcut` only exists after mount. Keep the queue and handoff; after mount, the chord handler may call `useShortcut`-registered actions.
  - `slides-viewer.tsx` delegated controls, `heading-anchors.tsx`, the image-theater delegated opener, smart-table's `enhance-table.ts` and `smart-table-layout.ts`. These run on raw or server HTML, including OncoGuide's `dangerouslySetInnerHTML`.
- **Not widgets:** `RouteFocus.tsx`, `scroll-memory.ts`, `visual-stability.ts`, telemetry and prefetch listeners. The `role=status` regions (`PageActivity`, `PageTransferActivity`, `NavigationStatus`) have no known total, so they aren't Progress.
- **Canvas, WebGL, SVG and charts:** timeline charts and markers, the DICOM annotation layer, the OpenSeadragon pathology canvas, `TumorModel3D` and `BreadloafAndTopDownViews` hit-testing, `TalkAvatar`, and the AdminStats bars. UI SDK's Timeline and Waterfall don't fit these bespoke visualisations.
- **Liveblocks UI** (`Thread`, `Composer`, `Comment.DropdownItem`).
- **Native controls that already work:** plain `<details>` on marketing, tag, compare, education and devtools pages, native `<select>`, `type=range` and checkboxes in diagnostics, and `VisualZoom`.
- **The floating "Add comment" selection button** (`wiki-comments/src/index.tsx:1354-1395`). It's an absolutely positioned button, not a popup.

## 7. Test and agent contracts to preserve

These are checked by e2e specs, surface gates or WebMCP. A PR that touches one either keeps it or updates the test and says why.

- **Palettes:**
  - test ids `command-palette` and `command-palette-input` (about 11 specs)
  - `getByRole("option")` in `runtime.spec.ts:187,402`, `navigation.spec.ts:136` and `visual.spec.ts:51`
  - dialog "Go to page", combobox "Search pages" (`accessibility.spec.ts:82-109`)
  - `oncoguide/e2e/file-palette.spec.ts:15-51`
- **Menus:** menu "Actions" and its menuitems (§5 3.2), `imaging.spec.ts:73` menuitem "MRI".
- **Dialogs:**
  - "Sign in"/"Sign up", `wiki-auth-dialog`
  - "Delete selected users" (`admin.spec.ts:111`)
  - `page-sharing.spec.ts:29-66`
  - `timeline-drilldown-dialog`
  - `bottom-nav-sheet[role=dialog]` (keyboard gate `:167`)
- **Tooltips:** `drug-tooltips.spec.ts` (`data-slot="tooltip-trigger"`, `role=tooltip`, tap to open, stays inside a narrow viewport), `timeline-tooltip-*`.
- **Sliders and separators:**
  - "Compare light and dark"
  - `clinical-tools.spec.ts:308` "`<label>` slider"
  - "Resize sidebar" and "Resize outline pane" (`blocked-storage.spec.ts:59-67`)
- **Tree:** `aria-expanded` on sidebar rows (`fixtures.ts:707`, `navigation.spec.ts:268-275`), `data-virtualized` (`runtime.spec.ts:420,438`).
- **WebMCP:**
  - The reader tools read only article content (`document-article`, `[data-reader-ready]`, `.content-shell`), so no widget DOM is involved.
  - The OncoGuide learning-chat tool needs the composer DOM in §5 2.11.
- **Keyboard ratchet:** `apps/app/surface-gates/keyboard.spec.ts:165-170` overlays.

## 8. Risks

- **Beta churn.** The library is 11 days old, and its docs say APIs may change. Mitigations:
  - Pin the exact version.
  - Isolate it behind `packages/ui`.
  - Upgrade on purpose, with the surface gates.
  - Its own install docs say to stop and ask the user when a release-age policy blocks the install.
- **Bytes.** UI SDK is heavier than Base UI one-for-one: Dialog costs +20 KB, and Button costs +8 KB. Phases 1–2 stay in lazy chunks, where the extra bytes are paid only on first open. Phase 3 is the real cost.
- **Behaviour changes users will notice:**
  - In Command, Escape clears the query first, and Home/End stay in the input.
  - In Menu, Tab closes the menu.
  - In Tree, a single Tab stop replaces per-row Tab stops.
  - Each is arguably more correct, but each changes a spec. List them in the PR.
- **SSR.** UI SDK styles arrive after mount, and saved Resizable sizes need cookies to render on the server. The 0.3 smoke test and the layout-shift gate are the protection.
- **CSP.** If we add a strict `style-src`, UI SDK needs `<meta property="csp-nonce">` and `style-src-attr 'unsafe-inline'`.
- **Smart-table expanded overlay.** It accounts for the `expanded-table-*` ratchet failures. It's vanilla DOM, not React, so UI SDK doesn't fix it directly. Track it separately.

## 9. Decisions needed

1. **Overall scope:** pick between two goals:
   - the full plan, Phases 0–4;
   - the lazy pages only (Phases 0–2, plus 4), which removes Base UI, `cmdk` and `sonner` without touching the eager budget.

   Recommendation: commit to 0–2 now, and decide Phase 3 after the Phase 1 numbers are in.
2. **Palette keyboard.** Should we accept UI SDK's Command defaults (Escape clears first, Home/End stay in the input) or override them to keep today's behaviour? Recommendation: accept the defaults.
3. **Actions menu Tab.** Should Tab close the menu (standard Menu) or stay trapped (today's gate)? Recommendation: standard Menu, and rewrite the gate case as "Tab closes and returns focus".
4. **Pane sizes.** Should saved sizes move to a cookie so Resizable can render them on the server, or should we keep the pre-paint CSS variable? Recommendation: cookie, folded into the SSR plan (P3, `plans/2026-11-17-server-rendering-plan.md`), which already retires the reader-shell cookie path.
5. **Chat transcript animation.** Is it acceptable to lose `use-stick-to-bottom`'s spring scroll? Recommendation: yes.
6. **`web.css`.** Do we use UI SDK's default look, or only the minimal `@layer ui-sdk` rules? Recommendation: minimal rules, since we already have our own design tokens.
