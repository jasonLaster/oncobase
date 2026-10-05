# Public landing page

The landing page introduces Diana TNBC and the knowledge base, then Oncobase, the platform behind it, and sends people who want detail to the features page (`specs/features-page.md`). Signed-out visitors see it at `/`, and `/login` shows it too for existing links. It uses the wiki's own palette (indigo accent, neutral grays, navy in dark mode), and the Oncobase band is a subtle indigo tint of it, so nothing clashes with the reader. Sections run in this order:

1. **Hero.** “It takes a village.” stays on one line, with type scaled to fit phone widths. The description names the diagnosis once (triple-negative breast cancer) and says what the knowledge base is for. The primary action opens Diana's knowledge base (the sign-in page); the secondary text link browses educational content, which anyone can open. Real screenshots of the reader on a laptop and a phone follow, in the visitor's theme.
2. **Our story.** Jason's account of why the knowledge base exists, signed “Jason · Diana's husband”, ending with “Today, we're cautiously optimistic.”
3. **Oncobase.** “Open source, so everyone can take control of their care.” The copy says everything in the knowledge base, from the content management system to the diagnostics viewer and the agentic chatbot, is open source and free to build on (MIT). The band credits Sid Sijbrandij's osteosarc.com as its inspiration (it does not claim that site runs on Oncobase) and links to the GitHub repository and to the features page, placed early so anyone can see how it is built.
4. **What's inside the knowledge base.** The table of contents groups care material first (current care, decisions, diagnostic tests, treatments, prognosis, next steps); “Understand the science” links to published education guides that need no password; people, research, and records follow. Below it, four tour cards link into the matching parts of the features page (`/features#read`, `#ask`, `#protect`, `#data`) and a text link goes to all of it. The landing page keeps no demos or product screenshots of its own beyond the hero; the features page holds them.
5. **Educational content.** “What does that term mean?” with five cartoons from the curriculum and a link to `/education`. Each cartoon links to the public guide page it comes from, and the copy says anyone can read them. On desktop the first two lead side by side and the other three follow in a row beneath them. On phones (700px and below) the five sit in one swipeable row, with the next card peeking in, so the section stays about one card tall instead of five. Pick only generic cartoons: several in the vault name the patient or her regimen and must not be used here. Use 3:2 images (1536×1024); some, like `hot-excluded-cold`, are square and do not fit. The section is a full-width band with its own texture (`EducationTexture` in `LandingBrands.tsx`): a faint notebook dot grid that fades at the top and bottom edges, and a small constellation of line-art doodles (a smiling cell, DNA, a molecule, an antibody, sparkles) beside the heading from 900px up. The doodles are decorative (`aria-hidden`) and sit behind the cards; phones keep only the dots.

The landing page has no password form; Sign in opens the sign-in page.

Product nouns stay consistent: Diana's site is the “knowledge base”, and `/education` is “educational content”. Headings use sentence case and wrap with `text-wrap: balance` rather than manual line breaks. Body text is at least 15px and no visible text is smaller than 13px, except the decorative “TNBC” wordmark lockup. Section labels are the headings themselves; there are no all-caps eyebrows.

The sticky header is the shared two-row header (`PublicChrome.tsx`, `public-header.css`), the same one the features and compare pages use. The **primary row** has the Diana brand, Features and Compare (the same links, in the same order, on every public page), a light/dark toggle, and Sign in. The **sub header** below it lists this page's sections (Our story, Oncobase, What's inside, Education) with the one in view underlined (`aria-current="location"`). On phones (700px and below) the primary links move into the sub header's one scrolling row, pinned at its left edge, so the header is two rows (about 110px) tall. The header takes the Oncobase band's indigo tint while that band is beneath it (`data-tone`, driven by an intersection observer that also publishes `--lp-header-height` for anchor clearance), and color transitions respect reduced motion. The footer is one row with the Diana brand and “Open source, powered by oncobase”, a note that the site is shared for education and not medical advice, and links to Features, Compare, and the terms.

The theme toggle is shared with the education hub. It follows the system until clicked, remembers an explicit light or dark choice, and returns to following the system when the chosen theme matches it.

Neither page loads wiki documents, clinical APIs, or permission records for an anonymous visitor.

## Sign-in page

`/sign-in` holds the shared-password form. The left half carries the village texture, the Diana brand (linking back to the landing page), the village cartoon, and “It takes a village.”; the right half holds the theme toggle, “Open Diana's knowledge base.”, the form, “Need access? Ask Jason.”, and links back to the landing page and to educational content. Below 900px the art becomes a compact band above the form, and the password and its button fit on the first screen of a phone.

## Signed-out routing

A signed-out GET of exactly `/` returns the landing page in place, with no redirect. The response carries only the landing share card and `wiki-reader-access=landing`, stays `private, no-store` with `Vary: Cookie`, and contains no wiki page data. The client renders the landing page for that marker, clears any cached reader snapshot, and never requests the reader session. Signed-in readers get the wiki home at the same URL. With a `token` query, `/` redirects like any private page.

Private pages redirect signed-out visitors to `/sign-in?redirect=<path>`, and so do `GET /api/login`, the reader's sign-in links, the comments panel, and the pathology viewer. `/login` keeps working for existing links: when its redirect names a particular page it shows the sign-in page directly, and otherwise it shows the landing page.

The Vite dev server serves HTML without the gate, but `scripts/dev-landing-plugin.ts` makes it show the landing page at `/` the way production does for a signed-out visitor: it injects the landing marker unless the request has `?token`, `?reader`, an `x-wiki-test-run` header, or an authenticated cookie. Gate behavior is covered by `server/app-shell.test.ts`, `scripts/verify-standalone.ts`, `scripts/local-smoke.ts`, and the deployed `e2e/auth-gate-security.spec.ts`.

## Sign-in behavior

The server treats `/sign-in` like `/login`: it is outside the password gate, signed-in visitors are redirected to the requested page, and it never resolves to a wiki slug. After sign-in the visitor continues to the requested page, keeping a deep link's own fragment; unsafe redirect targets fall back to `/`. The error messages, retry behavior, and startup-cache reset match `/login`.

## Private links

Links to private pages point straight to `/sign-in?redirect=<path>` rather than through the gate's redirect, and show a lock; their accessible names end with “Sign in required”. A signed-in visitor following one is redirected to the page by the server. Educational content links open directly.

## Link previews

The signed-out `/`, `/login`, `/sign-in`, and the bare domain when a link-preview bot requests it share the landing card. `/sign-in` is titled “Sign in — Diana TNBC Knowledge Base”; the others use “Diana TNBC Knowledge Base”. All use the Open Graph and Twitter title “It takes a village”, the hero description, and `/landing/og-image.jpg` (1200×630) as an absolute URL with a large-image Twitter card. Other pages keep their own titles and summary cards. All of them remain `noindex`.

## Diana content snapshot

Selected on October 1, 2026 at the user's request and revised October 3, 2026. Contents were checked against the published `https://diana-tnbc.com/wiki/index` page. Labels in `LandingShowcase.tsx` are a curated table-of-contents snapshot.

The following assets are intentional public landing-page content. Theme pairs load only the variant that matches the visitor's theme.

| Asset | Source | Treatment |
| --- | --- | --- |
| `immune-recognition-{light,dark}.webp` | `wiki/education/oncology-101/images/immune-system-peptide-recognition-{light,dark}.png` in the Diana vault | Lossless WebP; same dimensions and pixels |
| `cell-therapy-family-{light,dark}.webp` | `wiki/education/cellular-therapies/images/cell-therapy-family-tree-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `omics-layers-{light,dark}.webp` | `wiki/education/reading-a-tumor/images/omics-blueprint-analogy-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `ctdna-mailroom-{light,dark}.webp` | `wiki/education/molecular-profiling/images/cfdna-vs-ctdna-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `parp-synthetic-lethality-{light,dark}.webp` | `wiki/education/molecular-profiling/images/parp-synthetic-lethality-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `reader-desktop-{light,dark}.jpg` | Published `/wiki/education/reading-a-tumor/index` at 1272×846, 2× scale, signed out | Browser screenshot; the signed-out sidebar prompt is hidden so the capture matches what members see; resized to 1800×1197. The reader serves only the `-light` cartoon, so the dark captures swap in the vault's `tumor-biology-layers-dark.png` (route interception during capture) |
| `reader-mobile-{light,dark}.jpg` | Same published page at 393×852, 2× scale | Browser screenshot; resized to 600×1301 |
| `diagnostics-timeline-dark.jpg` | Published `/diagnostics` at 1272×846 with the sidebar collapsed, October 1 capture | Cropped to the populated timeline, 1192×640 |
| `diagnostics-timeline-light.jpg` | The committed `diagnostic-timeline-seed` fixture rendered through the e2e API mocks (`installWikiApiMocks`) in light theme at 1450×900, 2×; Diana's real data is gated, so this shows fixture results | Cropped to the content area, 1192×640. `dicom-viewer.jpg` has no light variant: the viewer canvas is black in both themes |
| `dicom-viewer.jpg` | Published `/tools/dicom-viewer?id=diagnostic-2026-08-24-breast-mri` at 1272×846, October 1 capture, with the viewer's image replaced | Cropped to 1192×640 without the toolbar filename. The image area shows a de-identified research MRI, not Diana's scan; see the credit below. |
| `sign-in-cartoon-{light,dark}.webp` | `public/auth-wiki-cartoon-{light,dark}.png`, the earlier sign-in illustration | WebP quality 90 with alpha; same dimensions; the cartoon draws its own frame on a transparent canvas |
| `og-image.jpg` | Composed from the brand mark, the hero headline (the wiki indigo palette), and `reader-desktop-light.jpg` in a throwaway HTML page rendered at 1200×630 with Playwright | JPEG quality 88 |

The imaging screenshot's MRI is image 44 of the axial T2 FSE series for participant AMBL-010 in Daniels, D., Last, D., Cohen, K., Mardor, Y., & Sklair-Levy, M. (2024). *Standard and Delayed Contrast-Enhanced MRI of Malignant and Benign Breast Lesions with Histological and Clinical Supporting Data (Advanced-MRI-Breast-Lesions)* (Version 2) [dataset]. The Cancer Imaging Archive. https://doi.org/10.7937/C7X1-YN57. It is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). It was rendered from DICOM with a linear 0–498 window (the 99.5th percentile), scaled to 630 px, and placed in the viewer capture; the footer carries the credit. TCIA's usage policy prohibits attempts to identify participants.

Captures show the normal redacted reader with no individual account signed in. They were reviewed for visible identifiers; no MRNs, dates of birth, private email addresses, credentials, or patient-name overlays are included. Static assets remain publicly retrievable even when the source wiki has access controls. Refresh them deliberately rather than automatically exporting the vault or reader.

## Feature examples

The redaction switch and role picker demonstrations moved to the features page, which describes them (`specs/features-page.md`). They use fictional people and details, and no real personal information.

## Verification

`e2e/journeys/public.spec.ts` covers the landing page's section order and navigation (including the Features and Compare links), the five education cartoons (two lead and three below on desktop, one swipeable row on phones, each linking to a public guide) and the tour cards, no reader or clinical data requests, sign-in retry errors, private links continuing after sign-in, themed images and the theme toggle, and that `/login`, `/sign-in`, `/features`, and `/compare` load without the reader session or database. `e2e/visual/visual.spec.ts` sweeps the public routes for horizontal overflow and keeps the macOS hero baseline. `server/app-shell.test.ts` covers `/sign-in` outside the gate, the signed-out landing page at `/` without wiki data, and redirects of private pages to `/sign-in`; `src/root-route.test.ts` covers rendering the landing page for the marker; `src/pages/sign-in.test.ts` covers redirect targets. `server/share-preview.test.ts` and `server/app-shell.test.ts` cover the link-preview card; The deployed-server link-preview tests in `e2e/journeys/public.spec.ts` check it against a deployed server.
