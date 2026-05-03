import path from "node:path";
import { writeConfig } from "./config";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const vaultPath = readFlag(args, "--vault") ?? process.cwd();
const publishUrl =
  readFlag(args, "--publish-url") ?? "http://localhost:3000/api/publish";

if (!site) {
  console.error(
    "Usage: bun scripts/publish/init.ts --site <slug> [--vault <path>] [--publish-url <url>]",
  );
  process.exit(1);
}

const file = writeConfig({
  site,
  vaultPath: path.resolve(vaultPath),
  publishUrl,
  openaiApiKey: "env:OPENAI_API_KEY",
});

console.log(`Wrote ${file}`);
console.log(
  `Save the publish token to ~/.config/wiki/${site}.token, or set WIKI_PUBLISH_TOKEN_${site.toUpperCase().replace(/-/g, "_")}.`,
);
