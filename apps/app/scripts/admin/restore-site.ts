/**
 * Restore an archived site to active status.
 *
 * Usage: bun scripts/admin/restore-site.ts --site <slug> [--prod]
 *
 * Calls the internal `sites:restore` through `bunx convex run`.
 */
import { internal } from "../../convex/_generated/api";
import { DEPLOYMENT_FLAGS_USAGE, convexRun, splitDeploymentFlags } from "./convex-run";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const { deployment, rest } = splitDeploymentFlags(process.argv.slice(2));
const slug = readFlag(rest, "--site");
if (!slug) {
  console.error(`Usage: bun scripts/admin/restore-site.ts --site <slug> ${DEPLOYMENT_FLAGS_USAGE}`);
  process.exit(1);
}

const result = convexRun(internal.sites.restore, { slug }, deployment);
if (!result.restored) {
  console.error(`Site ${slug} not found.`);
  process.exit(1);
}
console.log(`Restored ${slug}. Wait ~15s for proxy host-cache expiry before re-verifying.`);
