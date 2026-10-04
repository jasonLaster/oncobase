/**
 * Add a new publish token for a site without invalidating existing tokens.
 *
 * Usage:
 *   bun scripts/admin/add-publish-token.ts --site <slug> [--name <label>] [--write-local] [--prod]
 *
 * Calls the internal `sites:addPublishToken` through `bunx convex run`.
 */
import crypto from "node:crypto";
import { internal } from "../../convex/_generated/api";
import { writePublishToken } from "@oncobase/oncobase";
import { DEPLOYMENT_FLAGS_USAGE, convexRun, splitDeploymentFlags } from "./convex-run";

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

const { deployment, rest: args } = splitDeploymentFlags(process.argv.slice(2));
const slug = readFlag(args, "--site");
const name = readFlag(args, "--name") ?? "publisher";
if (!slug) {
  console.error(`Usage: bun scripts/admin/add-publish-token.ts --site <slug> [--name <label>] [--write-local] ${DEPLOYMENT_FLAGS_USAGE}`);
  process.exit(1);
}

const token = `wpt_${crypto.randomBytes(32).toString("base64url")}`;
const result = convexRun(internal.sites.addPublishToken, {
  slug,
  publishTokenHash: hashToken(token),
  name,
}, deployment);

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
