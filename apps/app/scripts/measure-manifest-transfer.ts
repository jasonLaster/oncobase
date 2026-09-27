/** Synthetic, content-free transport budget. Run from the repo root:
 * bun apps/app/scripts/measure-manifest-transfer.ts
 * This measures representation/transfer bytes, not production startup time. */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { buildCompactTreeFromManifest, compactWikiManifest, parseWikiManifest, type WikiManifest } from "@oncobase/wiki-content";

const pages = Array.from({ length: 5000 }, (_, i) => ({
  slug: `wiki/section-${i % 20}/note-${i}`, title: `Reference note ${i}`,
  tags: ["reference", `topic-${i % 37}`], description: `Synthetic description for reference note ${i}.`,
  contentHash: createHash("sha256").update(String(i)).digest("hex").slice(0, 24), sensitive: false, size: 1000 + i,
}));
const manifest: WikiManifest = {
  schemaVersion: 1, siteSlug: "synthetic", scope: "public", manifestHash: "synthetic-revision",
  generatedAt: "2026-09-15T00:00:00Z", pages,
  compactTree: buildCompactTreeFromManifest(pages), assets: [],
};
const samples = [manifest, compactWikiManifest(manifest)].map((payload, i) => {
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json);
  const gzipBytes = gzipSync(json).byteLength;
  const start = performance.now();
  for (let run = 0; run < 20; run++) parseWikiManifest(JSON.parse(json));
  return { format: i ? "compact-v1" : "legacy", bytes, gzipBytes,
    parseMs: Number(((performance.now() - start) / 20).toFixed(2)),
    transferSecondsAt256Kbps: Number((gzipBytes * 8 / 256_000).toFixed(2)) };
});
console.log(JSON.stringify({ conditions: "5000 synthetic pages, unique 24-character hashes, 20 sections; gzip; local parse timing; transfer estimate excludes latency, backend and JavaScript", samples }, null, 2));
