// SPIKE: write InitialReaderData fixtures for the SSR bench, built through the
// same code paths a document payload takes (navigationSlice -> compact tree ->
// parseNavigationBootstrap's expansion). Synthetic content only.
import { mkdirSync, writeFileSync } from "node:fs";
import { expandCompactFileTree, transformFileTreeForSidebar } from "@oncobase/wiki-content";
import { buildVault, PAGES } from "../../scripts/perf-lab/vault";
import { navigationSlice } from "../../server/page-bootstrap";

const { files } = buildVault();
const slugs = files.map(f => f.file.replace(/\.md$/, ""));

function stripFrontmatter(md: string) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, "");
}

/** Drug-panel-shaped page: 18 tables of 48 rows x 8 columns, prose between. */
function drugPanel() {
  let rnd = 7;
  const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = ["# Drug panel review", "", "Synthetic fixture shaped like a large screening review. No real data.", ""];
  for (let t = 0; t < 18; t++) {
    out.push(`## Panel ${t + 1}`, "", "Response was measured across the panel with replicate wells and normalized to control.", "");
    out.push("| Drug | Class | Target | IC50 (nM) | AUC | Response | Evidence | Note |", "| --- | --- | --- | ---: | ---: | --- | --- | --- |");
    for (let r = 0; r < 48; r++) {
      out.push(`| drug-${t}-${r} | class ${r % 7} | target-${r % 11} | ${(next() * 1000).toFixed(1)} | ${(next()).toFixed(3)} | ${next() > 0.5 ? "sensitive" : "resistant"} | [ref ${r}](/sources/papers/2024/paper-2024-${r % 60}) | replicate spread ${(next() * 10).toFixed(1)}% |`);
    }
    out.push("", "> Interpretation: hits above threshold are listed in the summary.", "");
  }
  return out.join("\n");
}

function fixture(slug: string, content: string) {
  const index = { slug, title: slug.split("/").at(-1)!, tagsJson: "[]", description: null, contentHash: "h-" + slug, sensitive: false, size: Buffer.byteLength(content) };
  const tree = transformFileTreeForSidebar(expandCompactFileTree(navigationSlice(slugs, slug)));
  return {
    url: `/${slug}`,
    identity: { siteSlug: "diana", scope: "public", authenticated: false, cacheKey: "public:diana", cacheVersion: "v1", userHash: null },
    initial: {
      page: { ...index, content, expectedContentHash: index.contentHash, contentStatus: "fresh", fetchedAt: 0, missingAt: null, staleAt: null, deletedAt: null },
      index, pages: [index], tree, expiresAt: Number.MAX_SAFE_INTEGER,
    },
  };
}

const find = (slug: string) => stripFrontmatter(files.find(f => f.file === `${slug}.md`)!.content);
const out = new URL("./fixtures/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const panel = drugPanel();
const cases = {
  normal: fixture(PAGES.article, find(PAGES.article)),
  large30: fixture(PAGES.large, find(PAGES.large)),
  panel18: fixture("wiki/research/reviews/2026-11-drug-panel", panel),
};
for (const [name, value] of Object.entries(cases)) {
  writeFileSync(`${out}${name}.json`, JSON.stringify(value));
  console.log(name, value.initial.page.size, "bytes markdown,", value.initial.tree.length, "top-level tree nodes");
}
