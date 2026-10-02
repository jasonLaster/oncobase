# Public landing page

`/login` introduces Diana TNBC, the knowledge base, before Oncobase, the platform behind it. The header, hero preview, story, and sign-in use the D mark and a plum palette. The primary action opens the shared-password form. The green Oncobase section carries the platform slogan, feature examples, and a link to its GitHub repository; molecular analysis also links to the companion Oncoomics repository.

The hero's curated contents retain the Diana TNBC name. The platform's contents example uses Oncobase branding and identifies Diana TNBC as the source of the sample content. Actual site screenshots and source links preserve their provenance.

The shared-password form and redirect behavior are unchanged. The landing page does not load wiki documents, clinical APIs, or permission records for an anonymous visitor.

## Diana content snapshot

Selected on October 1, 2026 at the user's request. The contents were checked against the published `https://diana-tnbc.com/wiki/index` page. Labels in `LandingShowcase.tsx` are a curated table-of-contents snapshot, with links to their original sections.

The following assets are intentional public landing-page content:

| Asset | Source | Treatment |
| --- | --- | --- |
| `immune-recognition.webp` | `wiki/education/oncology-101/images/immune-system-peptide-recognition-light.png` in the Diana vault | Lossless WebP encoding; same dimensions and pixels |
| `tumor-biology-layers.webp` | `wiki/education/reading-a-tumor/images/tumor-biology-layers-light.png` | Lossless WebP encoding; same dimensions and pixels |
| `cell-therapy-family.webp` | `wiki/education/cellular-therapies/images/cell-therapy-family-tree-light.png` | Lossless WebP encoding; same dimensions and pixels |
| `reader-desktop.jpg` | Published `/wiki/education/reading-a-tumor/index` at 1272×846 | Actual browser screenshot |
| `reader-mobile.jpg` | Same published page at 393×852 | Actual browser screenshot |
| `diagnostics-timeline.jpg` | Published `/diagnostics` at 1272×846 with sidebar collapsed | Actual browser screenshot |
| `dicom-viewer.jpg` | Published `/tools/dicom-viewer?id=diagnostic-2026-08-24-breast-mri`, default series and image 521, at 1272×846 | Actual browser screenshot |

Captures show the normal redacted reader with no individual account signed in. They were reviewed for visible identifiers; no MRNs, dates of birth, private email addresses, credentials, or patient-name overlays are included. Static assets remain publicly retrievable even when the source wiki has access controls. Refresh them deliberately rather than automatically exporting the vault or reader.

## Feature examples

The PII switch is a local demonstration with fictional details (`Alex Example`, `alex@example.com`). It is not a privileged reveal control and contains no real personal information. The role picker likewise uses explicit example configurations, not Diana's user or role records. Switching roles changes only the example's visible/hidden page list.

The described capabilities follow `packages/wiki-content/src/pii.ts` and `apps/app/convex/access.ts`: inline and block redaction with fallbacks, site PII patterns, role-based includes/excludes by page path and tag, and sensitive-content grants. The molecular pipeline is labeled as an illustrative example; candidate names are not analysis results.

## Verification

`e2e/landing-page.spec.ts` covers responsive layouts, keyboard tabs, unchanged sign-in navigation and retry errors, source links, image loading, PII demo behavior, and example role visibility. Local audit captures are kept under the ignored `.playwright/landing-enriched` directory.
