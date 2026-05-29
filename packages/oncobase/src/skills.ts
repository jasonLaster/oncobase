import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";

const DEFAULT_SKILLS = ["wiki-quickstart", "check"];

function skillSourceRoot() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    path.resolve(process.cwd(), ".claude", "skills"),
    path.resolve(process.cwd(), ".agents", "skills"),
    path.resolve(process.cwd(), "..", ".claude", "skills"),
    path.resolve(process.cwd(), "..", ".agents", "skills"),
    path.join(packageRoot, "skills"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
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
  const missing = srcRoot ? [] : [...skills];

  if (!srcRoot) {
    console.warn("No local .claude/skills or .agents/skills directory found; skipping skill sync.");
    return { copied, missing, destRoot };
  }

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
