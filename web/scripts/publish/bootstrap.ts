import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  readFlag,
  siteTokenEnvName,
  syncSkills,
  writeConfig,
  writePublishToken,
} from "@oncobase/oncobase";

const SLUG_RE = /^[a-z0-9-]{1,32}$/;

function rootDir() {
  return path.resolve(__dirname, "..", "..", "..");
}

function convexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
  }
  return url;
}

async function prompt(question: string, fallback?: string) {
  const rl = readline.createInterface({ input, output });
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || fallback || "";
}

async function promptSecret(question: string) {
  const rl = readline.createInterface({ input, output });
  const originalWrite = output.write.bind(output);
  let muted = false;
  output.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    if (!muted) return originalWrite(chunk, ...(args as []));
    return true;
  }) as typeof output.write;
  muted = true;
  const answer = (await rl.question(`${question}: `)).trim();
  muted = false;
  originalWrite("\n");
  output.write = originalWrite as typeof output.write;
  rl.close();
  return answer;
}

function hashPassword(password: string) {
  return `sha256:${crypto.createHash("sha256").update(password).digest("hex")}`;
}

function hashToken(token: string) {
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function scaffoldVault(slug: string) {
  const root = rootDir();
  const src = path.join(root, "obsidian-2");
  const dest = path.join(root, `obsidian-${slug}`);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing vault template: ${src}`);
  }
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    throw new Error(`Vault already exists and is not empty: ${dest}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

function run(
  command: string,
  args: string[],
  options?: { env?: Record<string, string | undefined>; optional?: boolean },
) {
  const result = spawnSync(command, args, {
    cwd: path.join(rootDir(), "web"),
    stdio: "inherit",
    env: { ...process.env, ...options?.env },
  });
  if (result.status !== 0 && !options?.optional) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.status ?? 1;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug || !SLUG_RE.test(slug)) {
    console.error("Usage: bun scripts/publish/bootstrap.ts <slug>");
    console.error("Slug must match /^[a-z0-9-]{1,32}$/");
    process.exit(1);
  }

  const ownerEmail = readFlag(args, "--owner") ?? await prompt("Owner email");
  const title = readFlag(args, "--title") ?? await prompt("Display title", slug);
  const domain =
    readFlag(args, "--domain") ??
    await prompt("Domain", `${slug}.${process.env.WIKI_BASE_DOMAIN ?? "diana-tnbc.com"}`);
  const password =
    readFlag(args, "--password") ?? await promptSecret("Site password");
  if (!ownerEmail || !password) {
    throw new Error("Owner email and password are required.");
  }

  const publishToken = `wpt_${crypto.randomBytes(32).toString("base64url")}`;
  const client = new ConvexHttpClient(convexUrl());
  const siteId = await client.mutation(api.sites.create, {
    slug,
    name: title,
    ownerEmail,
    domain,
    publishTokenHash: hashToken(publishToken),
    passwordHash: hashPassword(password),
    title,
  });

  const vaultPath = scaffoldVault(slug);
  const tokenFile = writePublishToken(slug, publishToken);
  const configFile = writeConfig({
    site: slug,
    vaultPath,
    publishUrl: `https://${domain}/api/publish`,
    openaiApiKey: "env:OPENAI_API_KEY",
  });

  const domainStatus = run("vercel", ["domains", "add", domain], { optional: true });
  if (domainStatus !== 0) {
    console.warn(`Could not add ${domain} with the Vercel CLI. Add it manually in the Vercel dashboard, then retry verification.`);
  }

  syncSkills(slug);

  run("bun", ["run", "wiki:publish", "--site", slug], {
    env: { [siteTokenEnvName(slug)]: publishToken, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  });

  console.log("");
  console.log(`Created site ${slug} (${siteId})`);
  console.log(`Vault:  ${vaultPath}`);
  console.log(`Config: ${configFile}`);
  console.log(`Token:  ${tokenFile}`);
  console.log("");
  console.log("Verification:");
  console.log(`  bun run wiki:check --site ${slug}`);
  console.log(`  curl -I https://${domain}/`);
  console.log(`  ${siteTokenEnvName(slug)}=$(cat ${tokenFile}) bun run wiki:publish --site ${slug}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
