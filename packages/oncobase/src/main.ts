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
  "transcription",
]);

function usage() {
  console.error("Usage: oncobase <init|sync|check|publish|skills|assets:backfill-hashes|docs:backfill-hashes|transcription> [options]");
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
const scriptName =
  command === "sync"
    ? "sync-command.js"
    : command === "skills"
      ? "skills-command.js"
      : command === "assets:backfill-hashes"
        ? "assets-backfill-hashes.js"
        : command === "docs:backfill-hashes"
          ? "docs-backfill-hashes.js"
        : command === "transcription"
          ? "transcription-command.js"
        : `${command}.js`;
const result = spawnSync(process.execPath, [path.join(binDir, scriptName), ...args], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
