import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = path.join(ROOT, "..", "web");
const CONVEX_URL_FILE = path.join(ROOT, ".convex-deployment-url");
const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = ROOT,
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isPlaceholderConvexUrl(value: string) {
  return /^https:\/\/(example|placeholder)\./.test(value) || value.includes("placeholder");
}

if (fs.existsSync(CONVEX_URL_FILE)) fs.rmSync(CONVEX_URL_FILE);

let convexUrl: string;
if (process.env.VERCEL_ENV === "production") {
  run(
    "npx",
    [
      "convex",
      "deploy",
      "--cmd-url-env-var-name",
      "NEXT_PUBLIC_CONVEX_URL",
      "--cmd",
      `printf '%s' "$NEXT_PUBLIC_CONVEX_URL" > ${shellQuote(CONVEX_URL_FILE)}`,
    ],
    process.env,
    WEB_ROOT,
  );

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
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() || "";
  convexUrl = fromEnv && !isPlaceholderConvexUrl(fromEnv)
    ? fromEnv
    : PROD_CONVEX_FALLBACK_URL;
  console.log(
    `Skipping Convex deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}); ` +
      `using NEXT_PUBLIC_CONVEX_URL=${convexUrl}` +
      (fromEnv && !isPlaceholderConvexUrl(fromEnv)
        ? ""
        : " (fallback - env var was empty or placeholder)"),
  );
}

run("bun", ["run", "build"], {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: convexUrl,
  CONVEX_URL: convexUrl,
});
