# Whole-slide H&E review

`/tools/pathology-viewer` opens the site-scoped Convex slide collection without
initializing the wiki's SQLite/OPFS reader. The imaging page links to it.
`?slide=<id>` selects the exact immutable source; missing IDs show an error.
`compare=<id>` opens a second independent slide. Copy View includes the primary
slide's image-pixel center, image zoom, rotation, and saved region ID.

## Review workflow

Choose a tissue thumbnail, start at overview, drag to pan and scroll/pinch to
zoom. The tissue navigator shows the visible field. Magnification buttons use
the scanner's objective power; current magnification describes displayed image
zoom relative to acquisition. Zoom beyond acquisition is marked digital.
The scale bar and rulers use both scanner microns-per-pixel values, including
anisotropic calibration and rotated views. Missing calibration disables rulers.

Fit Tissue, 90-degree rotation, full screen, next/previous slide, and keyboard
pan/zoom are available. Comparison keeps separate navigators and cameras;
optional linked magnification is driven by the primary pane. It does not imply
registration or anatomically matched coordinates. Swap changes the primary.
Mobile stacks comparison panes and moves regions below the viewer.

Regions and rulers are stored in original full-resolution image coordinates,
not screen coordinates. Select a saved region to return to it, edit its label,
note or color, then Save. Edits survive switching slides in the same page;
leaving with unsaved edits triggers the browser's navigation guard. Save waits
for a server acknowledgement. Conflicts and network failures retain the draft;
load-latest keeps the previous draft in Undo history. No automatic diagnoses,
tissue labels, specimen dates, or report associations are inferred.

## Ingestion and custody

1. Download the authorized SVS source to an ignored operator directory. Record
   S3 key, size, ETag/version and a full SHA-256. Never interpret multipart ETags
   as content hashes or change the original file.
2. In an operator Python environment, install `openslide-python`, `openslide-bin`
   and `Pillow`. Run:

   ```sh
   python apps/app/scripts/prepare-pathology-slides.py \
     --source /absolute/path/to/svs-directory \
     --output /absolute/path/to/prepared-directory \
     --source-prefix s3://bucket/authorized-prefix/
   ```

   OpenSlide reads bounded tissue tiles, converts embedded ICC colors to sRGB,
   and emits Deep Zoom JPEGs (quality 90, no chroma subsampling) in packs of at
   most 64 MiB. Associated label and macro images are excluded. Level 0 of the
   scanner source is preserved as the full-resolution pyramid level; JPEG
   derivatives are not byte-identical to source pixels. Packs and the tile index
   have SHA-256 hashes. The prepared manifest is written only after all tiles.
3. Run `bun --cwd apps/app pathology:upload --source /absolute/prepared/path
   --site diana`. Configure the usual server/publisher credentials. The operator
   deploy key can impersonate the service identity without exporting a signing
   key. The uploader verifies local pack hashes, remote sizes and bounded remote
   byte samples, uploads the index last, and upserts the record only when the
   entire slide is available. Immutable content paths support retrying uploads.

Original sources stay in S3 and the ignored download directory. Derived tissue
packs use the existing site-prefixed **public Vercel Blob store**, with storage
URLs retained server-side. The application API requires the wiki password gate
for catalog, thumbnails, tiles, and notes; this gate does not make public Blob
objects private at the storage layer. Do not include label images or patient
metadata in derivative packs. If storage-level privacy is required, provision
a private store and change the server transport before ingestion.

## Backend

`pathologySlides` stores source identity, acquisition metadata and rendering
manifest pointers. `pathologyRegions` stores a source-bound versioned collection
of regions. Every Convex function requires service authorization and resolves
the tenant before reading or writing. Saves compare `expectedVersion` atomically.

`/api/pathology/slides/<id>/tiles/<level>/<x>_<y>.jpg` checks pyramid bounds,
verifies the index hash and source identity, and fetches exactly one byte range
from a validated Vercel Blob origin. A full-file response, wrong range or short
read fails closed. The API never returns underlying storage URLs. Responses
are private; bounded catalog/manifest caches expire after 60 seconds.

## Verification

Focused unit tests cover service authentication, tenant boundaries, immutable
source binding, concurrent saves, invalid geometry, calibration, shared camera
validation, storage-origin restrictions and tile ranges. Browser fixtures use
synthetic tissue illustrations and mock writes, so no production clinical notes
are changed. Playwright checks actual tile rendering, magnification, rotation,
saved notes/reload, measurements, comparison, conflicts and responsive geometry
at 1440, 1920 and 393 pixels. Live-source review separately verifies the actual
registered scans and authenticated tile delivery.
