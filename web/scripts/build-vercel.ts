import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

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

const convexUrl = fs.readFileSync(CONVEX_URL_FILE, "utf8").trim();
if (!convexUrl) {
  console.error("Convex deploy returned an empty deployment URL.");
  process.exit(1);
}

const buildEnv = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: convexUrl,
  CONVEX_URL: convexUrl,
};

// Ingest wiki and PDFs against the just-deployed Convex backend before Next builds.
run("sh", [
  "-c",
  "(bun scripts/ingest-wiki.ts & bun scripts/ingest-pdfs.ts & wait) && bun run build",
], buildEnv);
