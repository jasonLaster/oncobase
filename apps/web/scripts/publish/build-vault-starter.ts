import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const WEB_ROOT = path.join(__dirname, "..", "..");
const REPO_ROOT = path.join(WEB_ROOT, "..", "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "obsidian-2");
const PUBLIC_ROOT = path.join(WEB_ROOT, "public");
const OUT_FILE = path.join(PUBLIC_ROOT, "wiki-vault-starter.zip");

const SKILLS = ["wiki-quickstart", "check"];

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8")) as {
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function addDir(zip: JSZip, srcDir: string, zipDir = "") {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = zipDir ? `${zipDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDir(zip, src, dest);
      continue;
    }
    zip.file(dest, fs.readFileSync(src));
  }
}

function starterPackage() {
  const publisherPackage = readJson(
    path.join(REPO_ROOT, "packages", "oncobase", "package.json"),
  );
  const publisherVersion = publisherPackage.version ? `^${publisherPackage.version}` : "latest";
  return {
    name: "wiki-vault",
    private: true,
    type: "module",
    scripts: {
      "wiki:init": "oncobase init",
      "wiki:check": "oncobase check",
      "wiki:publish": "oncobase publish",
      "wiki:sync": "oncobase sync",
      "wiki:skills": "oncobase skills",
    },
    devDependencies: {
      "@oncobase/oncobase": publisherVersion,
    },
  };
}

async function main() {
  const zip = new JSZip();
  addDir(zip, TEMPLATE_ROOT);

  for (const skill of SKILLS) {
    const skillDir = path.join(REPO_ROOT, ".claude", "skills", skill);
    if (fs.existsSync(skillDir)) {
      addDir(zip, skillDir, `.claude/skills/${skill}`);
    }
  }

  zip.file("package.json", `${JSON.stringify(starterPackage(), null, 2)}\n`);
  zip.file(
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "esnext"],
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          resolveJsonModule: true,
          types: ["bun-types"],
        },
        include: [],
      },
      null,
      2,
    )}\n`,
  );
  zip.file(
    ".gitignore",
    [".env*", "node_modules/", ".wiki-sync-review/", ".skipped-assets.txt", ""].join("\n"),
  );

  fs.mkdirSync(PUBLIC_ROOT, { recursive: true });
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(OUT_FILE, buffer);
  console.log(`Wrote ${OUT_FILE} (${(buffer.length / 1024).toFixed(1)} KiB)`);
}

await main();
