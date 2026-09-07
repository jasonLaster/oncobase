/** Rebuild active sites' public manifests and verify their installed bytes.
 * Supply the intended deployment URL and CONVEX_DEPLOY_KEY through the environment.
 * Optional: --site <slug>, --check (verify without rebuilding).
 * Output contains aggregate metadata only; URLs and document content stay in memory.
 */
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { parseWikiManifest } from "@oncobase/wiki-content";
import { internal } from "../../convex/_generated/api";

const args = process.argv.slice(2);
const siteIndex = args.indexOf("--site");
const siteSlug = siteIndex === -1 ? undefined : args[siteIndex + 1];
const checkOnly = args.includes("--check");
if (siteIndex !== -1 && (!siteSlug || !/^[a-z0-9-]{1,32}$/.test(siteSlug))) throw new Error("Use --site <slug>");
const key = process.env.CONVEX_DEPLOY_KEY;
const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!key || !url) throw new Error("An explicit deployment URL and CONVEX_DEPLOY_KEY are required");
// The normal HTTP client types expose only public functions. Admin credentials
// also permit these internal operator functions; retain their argument/result types.
const client = new ConvexHttpClient(url, { logger: false }) as unknown as {
  setAdminAuth(key: string): void;
  query<Q extends FunctionReference<"query", "internal">>(fn: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>>;
  action<A extends FunctionReference<"action", "internal">>(fn: A, args: FunctionArgs<A>): Promise<FunctionReturnType<A>>;
};
client.setAdminAuth(key);

try {
  const sites = await client.query(internal.manifestCache.status, siteSlug ? { siteSlug } : {});
  if (!sites.length) throw new Error("No active sites found");
  let failures = 0;
  for (const site of sites) {
    let verified = false;
    const started = performance.now();
    for (let attempt = 0; attempt < (checkOnly ? 1 : 3); attempt++) {
      if (!checkOnly) await client.action(internal.manifestBuilder.build, { siteSlug: site.siteSlug });
      const [current] = await client.query(internal.manifestCache.status, { siteSlug: site.siteSlug });
      if (!current?.url || !current.hash) continue;
      const response = await fetch(current.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) continue;
      const json = await response.text();
      const raw = JSON.parse(json);
      const manifest = parseWikiManifest(raw);
      const core = {
        schemaVersion: raw.schemaVersion, siteSlug: raw.siteSlug,
        scope: raw.scope, compactTree: raw.compactTree,
        pages: raw.pages, assets: raw.assets,
      };
      const hash = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
      const [after] = await client.query(internal.manifestCache.status, { siteSlug: site.siteSlug });
      if (manifest.scope !== "public" || manifest.siteSlug !== site.siteSlug ||
          manifest.pages.some(page => page.sensitive) || hash !== manifest.manifestHash ||
          hash !== current.hash || after?.revision !== current.revision || after.hash !== hash || !after.url) continue;
      console.log(JSON.stringify({
        site: site.siteSlug, verified: true, revision: after.revision, hash,
        pages: manifest.pages.length, assets: manifest.assets.length,
        bytes: Buffer.byteLength(json), elapsedMs: Math.round(performance.now() - started),
      }));
      verified = true;
      break;
    }
    if (!verified) { failures++; console.error(JSON.stringify({ site: site.siteSlug, verified: false })); }
  }
  if (failures) process.exitCode = 1;
} catch {
  // Backend errors can include arguments or storage URLs. Keep operational logs safe.
  console.error("Manifest rebuild or verification failed; no credentials or content were logged.");
  process.exitCode = 1;
}
