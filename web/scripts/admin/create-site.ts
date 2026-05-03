/**
 * Create a new site row in Convex and print its publish token once.
 *
 * Usage:
 *   bun scripts/admin/create-site.ts <slug> --owner <email> --domain <host> [--title <t>] [--password-hash <h>]
 *
 * Reads NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) from web/.env.local.
 * The publish token is generated, hashed, and stored — only the
 * plaintext printed once is usable by the publisher.
 */
import crypto from "node:crypto";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";

dotenv.config({
  path: path.join(__dirname, "..", "..", ".env.local"),
  quiet: true,
});

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

const args = process.argv.slice(2);
const slug = args[0];
const ownerEmail = readFlag(args, "--owner");
const title = readFlag(args, "--title");
const providedDomain = readFlag(args, "--domain");
const passwordHash = readFlag(args, "--password-hash");

if (!slug || !ownerEmail) {
  console.error(
    "Usage: bun scripts/admin/create-site.ts <slug> --owner <email> [--title <t>] [--domain <host>] [--password-hash <h>]",
  );
  process.exit(1);
}
if (!/^[a-z0-9-]{1,32}$/.test(slug)) {
  console.error("Slug must match /^[a-z0-9-]{1,32}$/");
  process.exit(1);
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!convexUrl) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set in web/.env.local");
  process.exit(1);
}

const baseDomain = process.env.WIKI_BASE_DOMAIN ?? "localhost";
const domain = providedDomain ?? `${slug}.${baseDomain}`;
const publishToken = `wpt_${crypto.randomBytes(32).toString("base64url")}`;
const publishTokenHash = `sha256:${crypto
  .createHash("sha256")
  .update(publishToken)
  .digest("hex")}`;

const convex = new ConvexHttpClient(convexUrl);
const siteId = await convex.mutation(api.sites.create, {
  slug,
  name: title ?? slug,
  ownerEmail,
  domain,
  publishTokenHash,
  passwordHash,
  title: title ?? slug,
});

const starterUrl = process.env.WIKI_STARTER_URL ?? "https://diana-tnbc.com/wiki-vault-starter.zip";

console.log(`✔ Site created: ${slug}`);
console.log(`  Convex id:    ${siteId}`);
console.log(`  Domain:       https://${domain}`);
console.log(`  Publish token (save this — won't be shown again):`);
console.log(`    ${publishToken}`);
console.log("");
console.log("Operator action required:");
console.log(`  Vercel dashboard → Project → Domains → Add → ${domain}`);
console.log("");
console.log("Give the site owner:");
console.log(`  Starter vault: ${starterUrl}`);
console.log(`  Site slug:     ${slug}`);
console.log(`  Publish URL:   https://${domain}/api/publish`);
console.log(`  Publish token: ${publishToken}`);
console.log("");
console.log("Vault setup:");
console.log(`  curl -L ${starterUrl} -o wiki-vault-starter.zip`);
console.log(`  unzip wiki-vault-starter.zip -d ${slug}-wiki && cd ${slug}-wiki`);
console.log("  bun install");
console.log(
  `  bun run wiki:init --site ${slug} --publish-url https://${domain}/api/publish`,
);
console.log("  mkdir -p ~/.config/wiki");
console.log(`  printf '%s\\n' '${publishToken}' > ~/.config/wiki/${slug}.token && chmod 600 ~/.config/wiki/${slug}.token`);
console.log(`  bun run wiki:publish --site ${slug}`);
