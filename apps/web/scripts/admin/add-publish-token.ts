/**
 * Add a new publish token for a site without invalidating existing tokens.
 *
 * Usage:
 *   bun scripts/admin/add-publish-token.ts --site <slug> [--name <label>] [--write-local]
 */
import crypto from "node:crypto";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";
import { writePublishToken } from "@oncobase/oncobase";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local"), quiet: true });

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function hashToken(token: string) {
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

const args = process.argv.slice(2);
const slug = readFlag(args, "--site");
const name = readFlag(args, "--name") ?? "publisher";
if (!slug) {
  console.error("Usage: bun scripts/admin/add-publish-token.ts --site <slug> [--name <label>] [--write-local]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set in apps/web/.env.local");
  process.exit(1);
}

const token = `wpt_${crypto.randomBytes(32).toString("base64url")}`;
const client = new ConvexHttpClient(url);
const result = await client.mutation(api.sites.addPublishToken, {
  slug,
  publishTokenHash: hashToken(token),
  name,
});

console.log(`Added publish token "${name}" for ${slug}.`);
console.log(`Active token hashes: ${result.publishTokenHashes}`);
console.log("");
console.log("Publish token (save this - it will not be shown again):");
console.log(`  ${token}`);

if (hasFlag(args, "--write-local")) {
  const tokenFile = writePublishToken(slug, token);
  console.log("");
  console.log(`Wrote local token: ${tokenFile}`);
}
