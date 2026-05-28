import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

const loadedEnvFiles = new Set<string>();

function loadEnvFile(file: string) {
  if (loadedEnvFiles.has(file) || !fs.existsSync(file)) return;
  dotenv.config({ path: file, override: false, quiet: true });
  loadedEnvFiles.add(file);
}

function loadEnvFilesNear(dir: string) {
  let current = path.resolve(dir);
  for (let depth = 0; depth < 4; depth++) {
    loadEnvFile(path.join(current, ".env.local"));
    loadEnvFile(path.join(current, ".env"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

// Load local env files for npm/node users. Bun does this automatically for the
// cwd, but the packaged CLI should also find vault-adjacent credentials like
// ../.env.local when invoked from an Obsidian checkout.
loadEnvFilesNear(process.cwd());

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
      `Missing config: run oncobase init --site ${site} first.\nLooked at: ${file}`,
    );
  }
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as PublishConfig;
  loadEnvFilesNear(config.vaultPath);
  return config;
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
