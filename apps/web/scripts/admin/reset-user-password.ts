/**
 * Generate a user-account password salt/hash, optionally applying it to Convex.
 *
 * Usage:
 *   bun scripts/admin/reset-user-password.ts --password <password>
 *   bun scripts/admin/reset-user-password.ts --email <email> --password <password> [--site <slug>] [--keep-sessions]
 *
 * Reads NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) from apps/web/.env.local when --email is provided.
 */
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";
import { createPasswordSalt, hashPassword, normalizeEmail } from "../../src/lib/user-auth";

dotenv.config({
  path: path.join(__dirname, "..", "..", ".env.local"),
  quiet: true,
});

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

const args = process.argv.slice(2);
const email = readFlag(args, "--email");
const password = readFlag(args, "--password") ?? args[0];
const siteSlug = readFlag(args, "--site");
const keepSessions = hasFlag(args, "--keep-sessions");

if (!password) {
  console.error(
    "Usage: bun scripts/admin/reset-user-password.ts [--email <email>] --password <password> [--site <slug>] [--keep-sessions]",
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
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("NEXT_PUBLIC_CONVEX_URL is not set in apps/web/.env.local");
    process.exit(1);
  }

  const convex = new ConvexHttpClient(convexUrl);
  const result = await convex.mutation(api.users.resetPassword, {
    email: normalizeEmail(email),
    passwordHash,
    passwordSalt,
    siteSlug,
    revokeSessions: !keepSessions,
  });

  console.log("");
  console.log(`Updated password for ${result.email}.`);
  console.log(`Convex user id: ${result.userId}`);
  console.log(
    keepSessions
      ? "Existing sessions were kept."
      : `Revoked ${result.revokedSessions} existing session(s).`,
  );
}
