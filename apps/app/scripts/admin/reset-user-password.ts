/**
 * Generate a user-account password salt/hash, optionally applying it to Convex.
 *
 * Usage:
 *   bun scripts/admin/reset-user-password.ts --password <password>
 *   bun scripts/admin/reset-user-password.ts --email <email> --password <password> [--site <slug>] [--keep-sessions] [--prod]
 *
 * With --email, calls the internal `users:resetPassword` through
 * `bunx convex run` (only the salt and hash leave this process).
 */
import { internal } from "../../convex/_generated/api";
import { createPasswordSalt, hashPassword, normalizeEmail } from "../../server/user-auth";
import { DEPLOYMENT_FLAGS_USAGE, convexRun, splitDeploymentFlags } from "./convex-run";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

const { deployment, rest: args } = splitDeploymentFlags(process.argv.slice(2));
const email = readFlag(args, "--email");
const password = readFlag(args, "--password") ?? args[0];
const siteSlug = readFlag(args, "--site");
const keepSessions = hasFlag(args, "--keep-sessions");

if (!password) {
  console.error(
    `Usage: bun scripts/admin/reset-user-password.ts [--email <email>] --password <password> [--site <slug>] [--keep-sessions] ${DEPLOYMENT_FLAGS_USAGE}`,
  );
  process.exit(1);
}

const passwordSalt = createPasswordSalt();
const passwordHash = hashPassword(password, passwordSalt);

console.log({
  passwordSalt,
  passwordHash,
});

if (email) {
  const result = convexRun(internal.users.resetPassword, {
    email: normalizeEmail(email),
    passwordHash,
    passwordSalt,
    siteSlug,
    revokeSessions: !keepSessions,
  }, deployment);

  console.log("");
  console.log(`Updated password for ${result.email}.`);
  console.log(`Convex user id: ${result.userId}`);
  console.log(
    keepSessions
      ? "Existing sessions were kept."
      : `Revoked ${result.revokedSessions} existing session(s).`,
  );
}
