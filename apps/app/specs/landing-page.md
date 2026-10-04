# Public landing page

`/login` introduces Diana TNBC, the knowledge base, and then Oncobase, the platform behind it. The page is Diana's plum throughout; one green band introduces Oncobase. Sections run in this order:

1. **Hero.** “It takes a village.” stays on one line, with type scaled to fit phone widths. The description names the diagnosis once (triple-negative breast cancer) and says what the knowledge base is for. The primary action browses educational content, which anyone can open; the secondary action opens the sign-in page. Real screenshots of the reader on a laptop and a phone follow, in the visitor's theme.
2. **Our story.** Jason's account of why the knowledge base exists, signed “Jason · Diana's husband”, ending with “Today, we're cautiously optimistic.”
3. **What's inside the knowledge base.** Records and research with the table of contents, the diagnostics timeline, the imaging viewer, and molecular analysis with the companion Oncoomics repository.
4. **Choose what each person can see.** The example role picker and the redaction switch, side by side.
5. **Oncobase.** The open-source platform and a link to its GitHub repository.
6. **Educational content.** Two cartoons from the curriculum and a link to `/education`.

The landing page has no password form; Sign in opens the sign-in page.

Product nouns stay consistent: Diana's site is the “knowledge base”, and `/education` is “educational content”. Headings use sentence case and wrap with `text-wrap: balance` rather than manual line breaks. Body text is at least 15px and no visible text is smaller than 13px, except the decorative “TNBC” wordmark lockup. Section labels are the headings themselves; there are no all-caps eyebrows.

The sticky header carries the Diana brand, five section links, a light/dark toggle, and Sign in. At 700px and below it is a single row and the section links are hidden; the hero actions and Sign in remain. The header turns green while the Oncobase band is beneath it and returns to plum elsewhere. Anchor clearance follows the measured header height, and color transitions respect reduced motion. The footer uses warm ivory so the purple Diana and green Oncobase marks stay distinct, and it states that the site is shared for education, not medical advice, with a link to the terms, and credits the MRI image used in the imaging screenshot.

The theme toggle is shared with the education hub. It follows the system until clicked, remembers an explicit light or dark choice, and returns to following the system when the chosen theme matches it.

Neither page loads wiki documents, clinical APIs, or permission records for an anonymous visitor.

## Sign-in page

`/sign-in` holds the shared-password form. The left half carries the plum texture, the Diana brand (linking back to the landing page), the village cartoon, and “It takes a village.”; the right half holds the theme toggle, “Open Diana's knowledge base.”, the form, “Need access? Ask Jason.”, and links back to the landing page and to educational content. Below 900px the art becomes a compact band above the form, and the password and its button fit on the first screen of a phone.

Private pages still redirect signed-out visitors to `/login?redirect=<path>`. When that redirect names a particular page, `/login` shows the sign-in page directly; a bare `/login`, or a redirect to `/`, shows the landing page. The server treats `/sign-in` like `/login`: it is outside the password gate, signed-in visitors are redirected to the requested page, and it never resolves to a wiki slug. After sign-in the visitor continues to the requested page, keeping a deep link's own fragment; unsafe redirect targets fall back to `/`. The error messages, retry behavior, and startup-cache reset match `/login`.

## Private links

A plain link to a private page would reopen the landing page through the gate. Links to private pages point to `/sign-in?redirect=<path>` and show a lock; their accessible names end with “Sign in required”. A signed-in visitor following one is redirected to the page by the server. Educational content links open directly.

## Link previews

`/login` and `/sign-in`, and the bare domain when a link-preview bot requests it, share the landing card. `/sign-in` is titled “Sign in — Diana TNBC Knowledge Base”; the others use “Diana TNBC Knowledge Base”. All use the Open Graph and Twitter title “It takes a village”, the hero description, and `/landing/og-image.jpg` (1200×630) as an absolute URL with a large-image Twitter card. Other pages keep their own titles and summary cards. All of them remain `noindex`.

## Diana content snapshot

Selected on October 1, 2026 at the user's request and revised October 3, 2026. Contents were checked against the published `https://diana-tnbc.com/wiki/index` page. Labels in `LandingShowcase.tsx` are a curated table-of-contents snapshot.

The following assets are intentional public landing-page content. Theme pairs load only the variant that matches the visitor's theme.

| Asset | Source | Treatment |
| --- | --- | --- |
| `immune-recognition-{light,dark}.webp` | `wiki/education/oncology-101/images/immune-system-peptide-recognition-{light,dark}.png` in the Diana vault | Lossless WebP; same dimensions and pixels |
| `cell-therapy-family-{light,dark}.webp` | `wiki/education/cellular-therapies/images/cell-therapy-family-tree-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `molecular-layers-{light,dark}.webp` | `wiki/education/molecular-profiling/images/central-dogma-tumor-{light,dark}.png` | Lossless WebP; same dimensions and pixels |
| `reader-desktop-{light,dark}.jpg` | Published `/wiki/education/reading-a-tumor/index` at 1272×846, 2× scale, signed out | Browser screenshot; the signed-out sidebar prompt is hidden so the capture matches what members see; resized to 1800×1197 |
| `reader-mobile-{light,dark}.jpg` | Same published page at 393×852, 2× scale | Browser screenshot; resized to 600×1301 |
| `diagnostics-timeline.jpg` | Published `/diagnostics` at 1272×846 with the sidebar collapsed, October 1 capture | Cropped to the populated timeline, 1192×640 |
| `dicom-viewer.jpg` | Published `/tools/dicom-viewer?id=diagnostic-2026-08-24-breast-mri` at 1272×846, October 1 capture, with the viewer's image replaced | Cropped to 1192×640 without the toolbar filename. The image area shows a de-identified research MRI, not Diana's scan; see the credit below. |
| `sign-in-cartoon-{light,dark}.webp` | `public/auth-wiki-cartoon-{light,dark}.png`, the earlier sign-in illustration | WebP quality 90 with alpha; same dimensions; the cartoon draws its own frame on a transparent canvas |
| `og-image.jpg` | Composed from the brand mark, the hero headline, and `reader-desktop-light.jpg` | 1200×630 JPEG |

The imaging screenshot's MRI is image 44 of the axial T2 FSE series for participant AMBL-010 in Daniels, D., Last, D., Cohen, K., Mardor, Y., & Sklair-Levy, M. (2024). *Standard and Delayed Contrast-Enhanced MRI of Malignant and Benign Breast Lesions with Histological and Clinical Supporting Data (Advanced-MRI-Breast-Lesions)* (Version 2) [dataset]. The Cancer Imaging Archive. https://doi.org/10.7937/C7X1-YN57. It is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). It was rendered from DICOM with a linear 0–498 window (the 99.5th percentile), scaled to 630 px, and placed in the viewer capture; the footer carries the credit. TCIA's usage policy prohibits attempts to identify participants.

Captures show the normal redacted reader with no individual account signed in. They were reviewed for visible identifiers; no MRNs, dates of birth, private email addresses, credentials, or patient-name overlays are included. Static assets remain publicly retrievable even when the source wiki has access controls. Refresh them deliberately rather than automatically exporting the vault or reader.

## Feature examples

The redaction switch is a local demonstration with fictional details (`Alex Example`, `alex@example.com`). It is not a privileged reveal control and contains no real personal information. The role picker likewise uses explicit example configurations, not Diana's user or role records. Switching roles changes only the example's visible/hidden page list. One caption under both says they are interactive examples with fictional people and details.

The described capabilities follow `packages/wiki-content/src/pii.ts` and `apps/app/convex/access.ts`: inline and block redaction with fallbacks, site PII patterns, role-based includes/excludes by page path and tag, and sensitive-content grants. Molecular analysis describes the Oncoomics pipeline's inputs; the page names no candidate drugs or analysis results.

## Verification

`e2e/landing-page.spec.ts` covers landing reflow at eight widths, a minimum text size, no reader or clinical data requests, section navigation, sticky-header color and anchor clearance on desktop and phone, the phone header, the sign-in page at five widths and in dark mode, `/login` choosing the landing or sign-in page, sign-in retry errors, private links continuing after sign-in, the redaction example, example role visibility, themed images and the theme toggle, and the dark palette. `e2e/standalone-routes.spec.ts` checks that both pages load without the reader session or database; `server/app-shell.test.ts` covers `/sign-in` outside the gate; `src/pages/sign-in.test.ts` covers redirect targets. `server/share-preview.test.ts` and `server/app-shell.test.ts` cover the link-preview card; `e2e/metadata.spec.ts` checks it against a deployed server. `e2e/public-theme.spec.ts` covers the shared theme toggle on deployed public pages.
