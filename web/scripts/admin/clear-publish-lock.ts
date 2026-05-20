/**
 * Clear a stuck publish lock for a site.
 *
 * Usage: bun scripts/admin/clear-publish-lock.ts --site <slug>
 *
 * Reads NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) from web/.env.local.
 */
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";

const webRoot = path.join(__dirname, "..", "..");
const repoRoot = path.join(webRoot, "..");
dotenv.config({ path: path.join(webRoot, ".env.local"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: false, quiet: true });

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const slug = readFlag(process.argv.slice(2), "--site");
if (!slug) {
  console.error("Usage: bun scripts/admin/clear-publish-lock.ts --site <slug>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set in web/.env.local");
  process.exit(1);
}

const client = new ConvexHttpClient(url);
await client.mutation(api.sites.failPublish, {
  slug,
  error: "lock cleared by operator",
});
console.log(`Cleared publish lock for ${slug}.`);
