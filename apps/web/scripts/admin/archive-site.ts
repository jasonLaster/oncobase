/**
 * Archive a site. Reversible (use restore-site.ts to undo).
 *
 * Usage: bun scripts/admin/archive-site.ts --site <slug>
 */
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local"), quiet: true });

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const slug = readFlag(process.argv.slice(2), "--site");
if (!slug) {
  console.error("Usage: bun scripts/admin/archive-site.ts --site <slug>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set in apps/web/.env.local");
  process.exit(1);
}

const client = new ConvexHttpClient(url);
const result = await client.mutation(api.sites.archive, { slug });
if (!result.archived) {
  console.error(`Site ${slug} not found.`);
  process.exit(1);
}
console.log(`Archived ${slug}. Wait ~15s for proxy host-cache expiry before verifying the host returns 503.`);
