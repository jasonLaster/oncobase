import fs from "node:fs";
import path from "node:path";
import { configPath } from "./config";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const vaultPath = readFlag(args, "--vault");
const publishUrl =
  readFlag(args, "--publish-url") ?? "http://localhost:3000/api/publish";

if (!site || !vaultPath) {
  console.error(
    "Usage: bun scripts/publish/init.ts --site <slug> --vault <path> [--publish-url <url>]",
  );
  process.exit(1);
}

const file = configPath(site);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(
  file,
  `${JSON.stringify(
    {
      site,
      vaultPath: path.resolve(vaultPath),
      publishUrl,
      openaiApiKey: "env:OPENAI_API_KEY",
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${file}`);
console.log(
  `Set WIKI_PUBLISH_TOKEN_${site.toUpperCase().replace(/-/g, "_")} before publishing (in shell or web/.env.local).`,
);
