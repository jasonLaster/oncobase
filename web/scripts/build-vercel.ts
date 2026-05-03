import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  isPlaceholderConvexUrl,
  PROD_CONVEX_FALLBACK_URL,
} from "../src/lib/convex-url";

const ROOT = path.join(__dirname, "..");
const CONVEX_URL_FILE = path.join(ROOT, ".convex-deployment-url");

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

if (fs.existsSync(CONVEX_URL_FILE)) {
  fs.rmSync(CONVEX_URL_FILE);
}

// Production builds deploy Convex schema/functions and read the
// resulting URL. Preview builds and CI must NOT spin up a fresh
// (empty) preview Convex deployment — they read prod Convex via the
// `NEXT_PUBLIC_CONVEX_URL` env var Vercel injects, so the preview
// app sees the same content prod sees. (See feedback memory:
// "Preview/CI Convex points at prod".)
const isProductionDeploy = process.env.VERCEL_ENV === "production";

let convexUrl: string;
if (isProductionDeploy) {
  run("npx", [
    "convex",
    "deploy",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
    "--cmd",
    `printf '%s' "$NEXT_PUBLIC_CONVEX_URL" > ${shellQuote(CONVEX_URL_FILE)}`,
  ]);

  if (!fs.existsSync(CONVEX_URL_FILE)) {
    console.error("Convex deploy did not write a deployment URL.");
    process.exit(1);
  }

  convexUrl = fs.readFileSync(CONVEX_URL_FILE, "utf8").trim();
  if (!convexUrl) {
    console.error("Convex deploy returned an empty deployment URL.");
    process.exit(1);
  }
} else {
  // Preview / CI: previews read prod Convex (the URL is public, the
  // data is what users see in production). If the Vercel env var is
  // unset/empty, fall back to the well-known prod Convex URL so the
  // build still produces a working preview.
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() || "";
  convexUrl = fromEnv && !isPlaceholderConvexUrl(fromEnv)
    ? fromEnv
    : PROD_CONVEX_FALLBACK_URL;
  console.log(
    `Skipping Convex deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}); ` +
      `using NEXT_PUBLIC_CONVEX_URL=${convexUrl}` +
      (fromEnv && !isPlaceholderConvexUrl(fromEnv)
        ? ""
        : " (fallback — env var was empty or placeholder)"),
  );
}

const buildEnv = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: convexUrl,
  CONVEX_URL: convexUrl,
};

// Content lands via the publisher CLI (web/scripts/publish/), not the
// build. Build-time work is `convex deploy` (production only) +
// starter-vault packaging + `next build`.
run("bun", ["scripts/publish/build-vault-starter.ts"], buildEnv);
run("sh", ["-c", "bun run build"], buildEnv);
