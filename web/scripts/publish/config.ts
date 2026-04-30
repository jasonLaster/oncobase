import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

// Bun auto-loads .env / .env.local from cwd, but the publisher CLI
// is sometimes invoked from outside `web/`. Belt-and-suspenders:
// also try loading them explicitly with the web directory as root.
const WEB_ROOT = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(WEB_ROOT, ".env.local"), override: false, quiet: true });
dotenv.config({ path: path.join(WEB_ROOT, ".env"), override: false, quiet: true });

export type PublishConfig = {
  site: string;
  vaultPath: string;
  publishUrl: string;
  openaiApiKey: string;
};

export function configPath(site: string) {
  return path.join(os.homedir(), ".config", "wiki", `${site}.json`);
}

export function loadConfig(site: string): PublishConfig {
  const file = configPath(site);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing config: run wiki:init --site ${site} first.\nLooked at: ${file}`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as PublishConfig;
}

export function tokenEnvName(site: string) {
  return `WIKI_PUBLISH_TOKEN_${site.toUpperCase().replace(/-/g, "_")}`;
}

export function loadPublishToken(site: string) {
  const token =
    process.env[tokenEnvName(site)] ?? process.env.WIKI_PUBLISH_TOKEN;
  if (!token) {
    throw new Error(
      `Set ${tokenEnvName(site)} or WIKI_PUBLISH_TOKEN — in your shell, in web/.env.local, or in web/.env.`,
    );
  }
  return token;
}
