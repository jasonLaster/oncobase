import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

// Bun auto-loads .env / .env.local from cwd. The publisher scripts can
// run either from web/ or from a standalone vault, so also load env
// files from the directory two levels above scripts/publish/.
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

export function tokenPath(site: string) {
  return path.join(os.homedir(), ".config", "wiki", `${site}.token`);
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
  if (token) return token;

  const file = tokenPath(site);
  if (fs.existsSync(file)) {
    const fileToken = fs.readFileSync(file, "utf8").trim();
    if (fileToken) return fileToken;
  }

  if (!token) {
    throw new Error(
      `Set ${tokenEnvName(site)} or WIKI_PUBLISH_TOKEN, or write the token to ${file}.`,
    );
  }
  return token;
}

export function writeConfig(config: PublishConfig) {
  const file = configPath(config.site);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

export function writePublishToken(site: string, token: string) {
  const file = tokenPath(site);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}
