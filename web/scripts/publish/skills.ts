import fs from "node:fs";
import path from "node:path";
import { readFlag } from "./cli";
import { loadConfig } from "./config";

const DEFAULT_SKILLS = ["wiki-quickstart", "check"];

function skillSourceRoot() {
  const candidates = [
    path.resolve(__dirname, "..", "..", ".claude", "skills"),
    path.resolve(__dirname, "..", "..", "..", ".claude", "skills"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function copyDir(src: string, dest: string) {
  if (
    fs.existsSync(src) &&
    fs.existsSync(dest) &&
    fs.realpathSync.native(src) === fs.realpathSync.native(dest)
  ) {
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

export function syncSkills(site: string, skills = DEFAULT_SKILLS) {
  const config = loadConfig(site);
  const srcRoot = skillSourceRoot();
  const destRoot = path.join(config.vaultPath, ".claude", "skills");
  const copied: string[] = [];
  const missing: string[] = [];

  for (const skill of skills) {
    const src = path.join(srcRoot, skill);
    if (!fs.existsSync(src)) {
      missing.push(skill);
      continue;
    }
    copyDir(src, path.join(destRoot, skill));
    copied.push(skill);
  }

  console.log(`Skills copied to ${destRoot}: ${copied.length ? copied.join(", ") : "(none)"}`);
  if (missing.length) {
    console.warn(`Skills not found in platform repo: ${missing.join(", ")}`);
  }
  return { copied, missing, destRoot };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const site = readFlag(args, "--site");
  if (!site) {
    console.error("Usage: bun scripts/publish/skills.ts --site <slug>");
    process.exit(1);
  }
  syncSkills(site);
}
