# Proposed development Preview CI contract fixtures

These two synthetic documents and one original SVG supply the required corpus
inputs for PR #73. They are staged for review; adding these files does not publish
them. They must not be published to a production backend or a clinical corpus.

The unchanged tests in `e2e/journeys/public.spec.ts` require an Oncology 101 page,
an `immunotherapy` search result, the exact image alt `immune recognition cartoon`,
a Diagnostics shell link to the gate, and the exact insurance metadata title. The
signed-out visual sweep also requires the Oncology 101 page at all three widths.
Those contracts originate in commit
`edf887621dc778ae9d6726999b92953bebc6688a`; the three approved W11 documents do not
provide these inputs. The search assertion already polls for 30 seconds.

The current source-custodied Oncology 101 index at Diana commit
`f2f2635617e63cea513d38106e88cffca84e272b` contains the search word but no required
image. An older version contains personal care references. Neither is copied
here. The insurance title comes only from the existing test contract; no care
vault insurance document is read or copied. All fixture prose and the SVG were
created for this software test. This is not scientific or learner validation.

## Exact proposed addition to the existing development backend

- Target: `wonderful-bandicoot-428`, deployment type `dev`, site `diana`.
- Two new documents; no existing document or sensitivity changes, no deletions.
- `wiki/education/oncology-101/index`, explicitly `sensitive: false`, belongs to
  the public education subset and text-search index.
- `wiki/logistics/insurance`, explicitly `sensitive: false`, is outside the
  education subset. Ordinary signed-out routes remain gated. Link-preview bots
  may receive its title and synthetic body bootstrap, so the whole body is safe
  software test data. This does not model a sensitive insurance record.
- One new non-sensitive asset:
  `wiki/education/oncology-101/images/recognition-fixture.svg`, exclusively owned
  by `wiki/education/oncology-101/index`. It has no shared or care owner.
- The three W11 documents and eight native images remain byte-identical.

Before integration, review `manifest.json` and `scope.json`; confirm both slugs
and the asset path are absent on the target. Stop on any collision, active
publish run, unexpected owner, sensitivity difference, tombstone, or wider
delta. The fixture affects the shared development site's public manifest,
search and bot metadata; all previews using that site can observe the synthetic
data.

After scope review, the source commit can be pushed and its SVG fetched from a
SHA-pinned GitHub raw URL. Verify all 588 bytes and the manifest SHA before
registering that exact URL through the existing development operator path used
for W11. The existing file proxy sets SVG MIME from the registered path and
forwards only Range upstream; it sends no wiki cookie or backend credentials.
This route needs no Blob upload or publish-token configuration change. The
remote raw URL is a proposed integration input, not a verified served artifact
until the commit is pushed. Register the two documents with the existing
document upsert API, retaining parsed hashes, classification and raw content.

Alternatively, use the existing publisher only with verified development
credentials and a reviewed development storage destination: this `vault`,
`--files-from scope.json --assets referenced --embeddings skip`, first with
`--dry-run`. Do not use a whole-vault publish or a production storage token.

Then verify exact ownership/classification, anonymous education manifest and
pages, decoded image, search, normal care 401/gated navigation, bot metadata,
and a zero-change follow-up plan (scoped dry-run for the publisher path, or exact
read-back comparison for operator registration). Rerun every required CI job, including the
mandatory native macOS WebKit durability lane and deployed Linux WebKit lane.
Do not replace required assertions, count local fixture results as deployed CI,
or discard earlier failed runs.
