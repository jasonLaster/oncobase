/** Read-only reproduction of the full-manifest local publish planning and
 * verification flow. Never acquires a lock, uploads bytes, or mutates content. */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig, loadPublishToken } from "../../../packages/oncobase/src/config";
import { installPublishProfile } from "../../../packages/oncobase/src/publish-profile";
import { publisherPost } from "../../../packages/oncobase/src/publish-post";
import { HASH_FUNCTION_VERSION, readVaultAssets, readVaultDocuments } from "../../../packages/oncobase/src/walk-vault";

const { values } = parseArgs({ options: {
  site: { type: "string" }, vault: { type: "string" },
  "files-from": { type: "string" }, profile: { type: "string" },
} });
if (!values.site || !values["files-from"] || !values.profile) {
  throw new Error("Usage: bun apps/app/scripts/profile-local-publish.ts --site <site> --files-from <JSON paths> --profile <new-file.json> [--vault <path>]");
}
const paths: unknown = JSON.parse(fs.readFileSync(values["files-from"], "utf8"));
if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== "string" || !/\.mdx?$/.test(p))) {
  throw new Error("files-from must be a nonempty JSON array of document paths");
}
const wanted = new Set((paths as string[]).map(p => p.replace(/\.mdx?$/, "")));
const profile = installPublishProfile(values.profile);
const config = loadConfig(values.site);
const token = loadPublishToken(values.site);
const vault = values.vault ?? config.vaultPath;
const documents = profile.sync("scan.documents", () => {
  const docs = readVaultDocuments(vault); profile.metric("items", docs.length); return docs;
});
if ([...wanted].some(slug => !documents.some(doc => doc.slug === slug))) throw new Error("Scope contains missing local documents");
const assets = profile.sync("scan.assets", () => {
  const assets = readVaultAssets(vault);
  profile.metric("items", assets.length);
  profile.metric("bytes", assets.reduce((n, a) => n + a.sizeBytes, 0));
  return assets;
});
const body = profile.sync("manifest", () => ({
  siteSlug: config.site, hashFunctionVersion: HASH_FUNCTION_VERSION, dryRun: true,
  manifest: {
    documents: documents.map(({ slug, hash, sensitive }) => ({ slug, hash, sensitive })),
    assets: assets.map(({ relativePath, hash, kind, visibilityHash }) => ({ path: relativePath, hash, kind, visibilityHash })),
  },
}));
const post = <T>(step: "begin" | "sync/documents", body: unknown) => publisherPost<T>(
  `${config.publishUrl}/${step}`, token, body, { profile, signal: AbortSignal.timeout(55_000) },
);
await profile.span("plan", () => post("begin", body));
// The normal second /begin would acquire a lock. Use another dry-run to
// measure its inventory cost without claiming to measure lock/write latency.
await profile.span("plan", () => post("begin", body));
const found = new Set<string>();
type RemotePage = { page: { slug: string }[]; isDone: boolean; continueCursor: string };
await profile.span("verify.documents", async () => {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let n = 0; n < 1000; n++) {
    const page: RemotePage = await post<RemotePage>(
      "sync/documents", { siteSlug: config.site, cursor, numItems: 500 },
    );
    for (const row of page.page) if (wanted.has(row.slug)) found.add(row.slug);
    if (page.isDone || found.size === wanted.size) break;
    cursor = page.continueCursor;
    if (!cursor || seenCursors.has(cursor)) throw new Error("Invalid pagination cursor");
    seenCursors.add(cursor);
  }
  profile.metric("items", found.size);
});
if (found.size !== wanted.size) throw new Error("Some selected documents were not found remotely");
await profile.span("plan.recheck", () => post("begin", body));
console.log(JSON.stringify({ mode: "read-only", selected: wanted.size, found: found.size,
  omitted: ["lock acquisition", "document writes", "asset uploads", "finish", "embeddings"],
  phases: profile.snapshot().spans.filter(s => !s.parentId).map(s => ({ phase: s.name, ms: Math.round(s.durationMs ?? 0) })),
}));
