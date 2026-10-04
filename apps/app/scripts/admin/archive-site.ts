/**
 * Archive a site. Reversible (use restore-site.ts to undo).
 *
 * Usage: bun scripts/admin/archive-site.ts --site <slug> [--prod]
 *
 * Calls the internal `sites:archive` through `bunx convex run`.
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
  console.error(`Usage: bun scripts/admin/archive-site.ts --site <slug> ${DEPLOYMENT_FLAGS_USAGE}`);
  process.exit(1);
}

const result = convexRun(internal.sites.archive, { slug }, deployment);
if (!result.archived) {
  console.error(`Site ${slug} not found.`);
  process.exit(1);
}
console.log(`Archived ${slug}. Wait ~15s for proxy host-cache expiry before verifying the host returns 503.`);
