#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMANDS = new Set([
  "init",
  "sync",
  "check",
  "publish",
  "skills",
  "assets:backfill-hashes",
  "docs:backfill-hashes",
  "elicit",
  "transcription",
]);

function usage() {
  console.error(
    "Usage: oncobase <init|sync|check|publish|skills|assets:backfill-hashes|docs:backfill-hashes|elicit|transcription> [options]",
  );
}

function readPackageVersion() {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("Unable to read oncobase package version");
  }
  return packageJson.version;
}

const [command, ...args] = process.argv.slice(2);
if (command === "-v" || command === "--version") {
  console.log(readPackageVersion());
  process.exit(0);
}

if (!command || !COMMANDS.has(command)) {
  usage();
  process.exit(1);
}

const binDir = path.dirname(fileURLToPath(import.meta.url));
const commandScripts: Partial<Record<string, string>> = {
  sync: "sync-command.js",
  skills: "skills-command.js",
  "assets:backfill-hashes": "assets-backfill-hashes.js",
  "docs:backfill-hashes": "docs-backfill-hashes.js",
  elicit: "elicit-command.js",
  transcription: "transcription-command.js",
};
const scriptName = commandScripts[command] ?? `${command}.js`;
const result = spawnSync(process.execPath, [path.join(binDir, scriptName), ...args], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
