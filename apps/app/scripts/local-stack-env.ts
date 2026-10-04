// Shared paths and env helpers for the local development stack
// (scripts/local-stack.ts) and its smoke test (scripts/local-smoke.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const APP_DIR = path.resolve(import.meta.dir, "..");
export const REPO_DIR = path.resolve(APP_DIR, "../..");
export const STACK_DIR = process.env.LOCAL_STACK_DIR
  ? path.resolve(process.env.LOCAL_STACK_DIR)
  : path.join(APP_DIR, ".local-stack");
export const STACK_ENV_FILE = path.join(STACK_DIR, "env");

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
export const PORTS = {
  convex: port("LOCAL_STACK_CONVEX_PORT", 3290),
  convexSite: port("LOCAL_STACK_CONVEX_SITE_PORT", 3291),
  blob: port("LOCAL_STACK_BLOB_PORT", 3292),
  seedServer: port("LOCAL_STACK_SEED_PORT", 3293),
  app: port("LOCAL_STACK_APP_PORT", 62003),
};

export const LOCAL_SITE_SLUG = "diana";
export const LOCAL_GATE_PASSWORD = "diana";
export const LOCAL_CARE_USER = { email: "care@local.test", password: "local-care-password", name: "Care Team" };
export const LOCAL_READER_USER = { email: "reader@local.test", password: "local-reader-password", name: "Reader" };

/** Parse the generated KEY='value' env file. */
export function parseEnvFile(file = STACK_ENV_FILE): Record<string, string> {
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const raw = match[2];
    env[match[1]] = raw.startsWith("'") && raw.endsWith("'")
      ? raw.slice(1, -1).replace(/'\\''/g, "'")
      : raw;
  }
  return env;
}

export function formatEnvFile(env: Record<string, string>, header: string[] = []) {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return [...header.map((line) => `# ${line}`), ...Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`), ""].join("\n");
}

export function requireStackEnv() {
  const env = parseEnvFile();
  if (!env.CONVEX_URL) {
    throw new Error(`Local stack env not found at ${STACK_ENV_FILE}. Run \`bun run local:stack\` first.`);
  }
  const url = new URL(env.CONVEX_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`Refusing to use non-local Convex URL from ${STACK_ENV_FILE}: ${env.CONVEX_URL}`);
  }
  return env;
}
