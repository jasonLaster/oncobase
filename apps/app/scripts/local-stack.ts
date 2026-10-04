#!/usr/bin/env bun
/**
 * Fully local Convex-backed stack for testing the reader without production
 * secrets. Never talks to a cloud Convex deployment.
 *
 *   bun run local:stack            # up: start/reuse backend, push, seed, write env
 *   bun run local:stack --reset    # wipe local data and keys, then up
 *   bun run local:stack --build    # force a rebuild of the stack's reader dist
 *   bun run local:stack status     # show what is running
 *   bun run local:stack stop       # stop background services
 *   bun run local:stack serve      # run the standalone server on the stack (foreground)
 *   bun run local:stack exec -- <cmd...>   # run a command with the stack env
 *
 * What "up" does:
 *  1. Generates (once) an RSA service keypair, gate/prefetch secrets, a publish
 *     token and a Convex instance secret under apps/app/.local-stack/.
 *  2. Starts a self-hosted convex-local-backend binary on 127.0.0.1 (data in
 *     .local-stack/convex) and pushes apps/app/convex to it with
 *     `convex dev --once` from an isolated staging dir, so the CLI can never
 *     read or rewrite apps/app/.env.local. WIKI_BACKEND_JWKS is a data: URI.
 *  3. Starts a local stand-in for the Vercel Blob API so the real publisher can
 *     upload assets.
 *  4. Seeds site "diana" through the real publish path (packages/oncobase
 *     publisher -> server /api/publish/* -> Convex), plus a care-team role and
 *     users for sensitive-page access.
 *  5. Writes .local-stack/env for the standalone server, `bun dev` and Playwright.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import {
  APP_DIR, LOCAL_CARE_USER, LOCAL_GATE_PASSWORD, LOCAL_READER_USER, LOCAL_SITE_SLUG, PORTS, REPO_DIR,
  STACK_DIR, STACK_ENV_FILE, formatEnvFile, parseEnvFile,
} from "./local-stack-env";

const INSTANCE_NAME = "oncobase-local";
const NODE_MAJOR = "22";
const FIXTURE_VAULT = path.join(APP_DIR, "scripts/fixtures/local-stack-vault");
const dirs = {
  convex: path.join(STACK_DIR, "convex"),
  project: path.join(STACK_DIR, "convex-project"),
  blob: path.join(STACK_DIR, "blob"),
  logs: path.join(STACK_DIR, "logs"),
  pids: path.join(STACK_DIR, "pids"),
  home: path.join(STACK_DIR, "home"),
  dist: path.join(STACK_DIR, "dist"),
  tools: path.join(STACK_DIR, "tools"),
};
const SECRETS_FILE = path.join(STACK_DIR, "secrets.json");
const convexUrl = `http://127.0.0.1:${PORTS.convex}`;
const convexSiteUrl = `http://127.0.0.1:${PORTS.convexSite}`;
const blobOrigin = `http://127.0.0.1:${PORTS.blob}`;

type Secrets = {
  instanceSecret: string;
  adminKey: string;
  signingKey: JsonWebKey & { kid: string };
  jwks: { keys: JsonWebKey[] };
  publishToken: string;
  gateSessionSecret: string;
  prefetchSecret: string;
};

const log = (message: string) => console.log(`[local-stack] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// ---------------------------------------------------------------------------
// Tools: Node 22 for "use node" actions, and the convex-local-backend binary.

function platformTriple() {
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return { node: `darwin-${arch}`, convex: arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin" };
  if (process.platform === "linux") return { node: `linux-${arch}`, convex: arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu" };
  throw new Error(`Unsupported platform for the local stack: ${process.platform}`);
}

function hasSupportedNode(bin: string) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return result.status === 0 && /^v(20|22|24)\./.test(result.stdout.trim());
}

/** The local backend runs "use node" actions with a Node 20/22/24 on PATH. */
async function ensureNodeBinDir(): Promise<string> {
  const systemNode = spawnSync("which", ["node"], { encoding: "utf8" }).stdout.trim();
  if (systemNode && hasSupportedNode(systemNode)) return path.dirname(systemNode);
  mkdirSync(dirs.tools, { recursive: true });
  const existing = readdirSync(dirs.tools).find((name) => name.startsWith(`node-v${NODE_MAJOR}.`));
  if (existing) return path.join(dirs.tools, existing, "bin");
  const { node: triple } = platformTriple();
  const base = `https://nodejs.org/dist/latest-v${NODE_MAJOR}.x`;
  log(`System node is not 20/22/24; downloading Node ${NODE_MAJOR} from nodejs.org into ${dirs.tools}`);
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const line = sums.split("\n").find((entry) => entry.endsWith(`-${triple}.tar.gz`));
  if (!line) throw new Error(`No Node ${NODE_MAJOR} build for ${triple}`);
  const [expected, file] = line.trim().split(/\s+/);
  const bytes = Buffer.from(await (await fetch(`${base}/${file}`)).arrayBuffer());
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`Checksum mismatch for ${file}`);
  const archive = path.join(dirs.tools, file);
  writeFileSync(archive, bytes);
  run("tar", ["xzf", archive, "-C", dirs.tools]);
  rmSync(archive);
  return path.join(dirs.tools, file.replace(/\.tar\.gz$/, ""), "bin");
}

/** Reuse the binary the Convex CLI caches, else fetch the newest precompiled release. */
async function ensureBackendBinary(): Promise<string> {
  const candidates: string[] = [];
  for (const root of [path.join(os.homedir(), ".cache/convex/binaries"), path.join(dirs.tools, "convex-backend")]) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const bin = path.join(root, version, "convex-local-backend");
      if (existsSync(bin)) candidates.push(bin);
    }
  }
  candidates.sort((a, b) => path.basename(path.dirname(b)).localeCompare(path.basename(path.dirname(a))));
  if (candidates[0]) return candidates[0];
  const { convex: triple } = platformTriple();
  log("Downloading convex-local-backend from github.com/get-convex/convex-backend releases");
  const releases = await (await fetch("https://api.github.com/repos/get-convex/convex-backend/releases?per_page=20")).json() as Array<{ tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }>;
  const release = releases.find((entry) => entry.tag_name.startsWith("precompiled-") && entry.assets.some((asset) => asset.name === `convex-local-backend-${triple}.zip`));
  if (!release) throw new Error("No precompiled convex-local-backend release found");
  const asset = release.assets.find((entry) => entry.name === `convex-local-backend-${triple}.zip`)!;
  const target = path.join(dirs.tools, "convex-backend", release.tag_name);
  mkdirSync(target, { recursive: true });
  const zip = path.join(target, asset.name);
  writeFileSync(zip, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));
  run("unzip", ["-o", "-q", zip, "-d", target]);
  rmSync(zip);
  return path.join(target, "convex-local-backend");
}

// ---------------------------------------------------------------------------
// Process helpers.

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd, env: options.env ?? process.env, encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${options.quiet ? `\n${result.stdout}\n${result.stderr}` : ""}`);
  }
  return result.stdout ?? "";
}

const pidFile = (name: string) => path.join(dirs.pids, `${name}.pid`);

function readPid(name: string) {
  try {
    const pid = Number(readFileSync(pidFile(name), "utf8"));
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

function startDetached(name: string, command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  mkdirSync(dirs.logs, { recursive: true });
  mkdirSync(dirs.pids, { recursive: true });
  const out = openSync(path.join(dirs.logs, `${name}.log`), "a");
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", out, out] });
  closeSync(out);
  child.unref();
  writeFileSync(pidFile(name), String(child.pid));
  return child.pid!;
}

async function stopService(name: string) {
  const pid = readPid(name);
  if (pid) {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
    for (let i = 0; i < 50 && readPid(name); i++) await sleep(100);
    if (readPid(name)) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    log(`stopped ${name} (pid ${pid})`);
  }
  rmSync(pidFile(name), { force: true });
}

async function waitFor(label: string, probe: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const ok = (url: string) => fetch(url, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok);

// ---------------------------------------------------------------------------
// Secrets.

async function loadSecrets(backendBinary: string): Promise<Secrets> {
  if (existsSync(SECRETS_FILE)) return JSON.parse(readFileSync(SECRETS_FILE, "utf8")) as Secrets;
  log("Generating local service keypair and secrets");
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const kid = `local-${crypto.randomBytes(4).toString("hex")}`;
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const instanceSecret = crypto.randomBytes(32).toString("hex");
  const adminKey = run(backendBinary, ["keygen", "admin-key", "--instance-name", INSTANCE_NAME, "--instance-secret", instanceSecret], { quiet: true })
    .trim().split("\n").pop()!;
  const secrets: Secrets = {
    instanceSecret,
    adminKey,
    signingKey: { ...priv, kid, alg: "RS256", use: "sig" },
    jwks: { keys: [{ kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" } as JsonWebKey] },
    publishToken: `wpt_${crypto.randomBytes(32).toString("base64url")}`,
    gateSessionSecret: crypto.randomBytes(32).toString("base64url"),
    prefetchSecret: crypto.randomBytes(32).toString("base64url"),
  };
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

const jwksDataUri = (secrets: Secrets) => `data:application/json;base64,${Buffer.from(JSON.stringify(secrets.jwks)).toString("base64")}`;

function stackEnv(secrets: Secrets): Record<string, string> {
  return {
    // Every Convex URL variable the server, Vite and Playwright read points
    // local, and the production fallback is disabled.
    CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    VITE_CONVEX_URL: convexUrl,
    VITE_NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_USE_PROD_CONVEX: "0",
    WIKI_BACKEND_SIGNING_KEY: JSON.stringify(secrets.signingKey),
    WIKI_SITE_SLUG: LOCAL_SITE_SLUG,
    VITE_WIKI_SITE_SLUG: LOCAL_SITE_SLUG,
    DIANA_WIKI_PASSWORD_HASH: `sha256:${sha256(LOCAL_GATE_PASSWORD)}`,
    WIKI_GATE_SESSION_SECRET: secrets.gateSessionSecret,
    WIKI_PREFETCH_SECRET: secrets.prefetchSecret,
    WIKI_DIST_DIR: dirs.dist,
    // Files resolve to the local Blob stand-in; keep any real token out.
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_localstack_unused",
    VERCEL_BLOB_API_URL: `${blobOrigin}/api/blob`,
    // Comments and AI stay disabled unless the developer adds keys.
    NEXT_PUBLIC_ENABLE_COMMENTS: "false",
    VITE_ENABLE_COMMENTS: "false",
    LOCAL_STACK_GATE_PASSWORD: LOCAL_GATE_PASSWORD,
    LOCAL_STACK_CARE_EMAIL: LOCAL_CARE_USER.email,
    LOCAL_STACK_CARE_PASSWORD: LOCAL_CARE_USER.password,
    LOCAL_STACK_READER_EMAIL: LOCAL_READER_USER.email,
    LOCAL_STACK_READER_PASSWORD: LOCAL_READER_USER.password,
  };
}

// ---------------------------------------------------------------------------
// Convex backend.

async function ensureBackend(binary: string, secrets: Secrets, nodeBinDir: string) {
  const running = readPid("convex-backend") && await ok(`${convexUrl}/version`).catch(() => false);
  if (running) {
    log(`Reusing local Convex backend at ${convexUrl}`);
    return;
  }
  await stopService("convex-backend");
  mkdirSync(dirs.convex, { recursive: true });
  if (await ok(`${convexUrl}/version`).catch(() => false)) {
    throw new Error(`Port ${PORTS.convex} is already serving something else; set LOCAL_STACK_CONVEX_PORT`);
  }
  log(`Starting convex-local-backend (${path.basename(path.dirname(binary))}) on ${convexUrl}`);
  startDetached("convex-backend", binary, [
    "--port", String(PORTS.convex), "--site-proxy-port", String(PORTS.convexSite),
    "--interface", "127.0.0.1", "--instance-name", INSTANCE_NAME, "--instance-secret", secrets.instanceSecret,
    "--local-storage", path.join(dirs.convex, "storage"), "--disable-beacon",
    path.join(dirs.convex, "convex_local_backend.sqlite3"),
  ], { cwd: dirs.convex, env: { ...process.env, PATH: `${nodeBinDir}:${process.env.PATH}` } });
  await waitFor("Convex backend", () => ok(`${convexUrl}/version`));
}

/**
 * The Convex CLI rewrites .env.local in its working directory (and drops
 * CONVEX_DEPLOYMENT there). Run it from an isolated staging project that
 * symlinks the real functions, with a self-hosted env file that can only name
 * the local backend.
 */
function prepareConvexProject(secrets: Secrets) {
  mkdirSync(dirs.project, { recursive: true });
  const link = path.join(dirs.project, "convex");
  if (!existsSync(link)) symlinkSync(path.relative(dirs.project, path.join(APP_DIR, "convex")), link);
  const appPackage = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
  writeFileSync(path.join(dirs.project, "package.json"), JSON.stringify({
    name: "oncobase-local-stack-convex", private: true, type: "module", dependencies: appPackage.dependencies,
  }, null, 2));
  const envFile = path.join(dirs.project, "self-hosted.env");
  writeFileSync(envFile, `CONVEX_SELF_HOSTED_URL=${convexUrl}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${secrets.adminKey}\n`, { mode: 0o600 });
  return envFile;
}

function convexCli(args: string[], envFile: string, nodeBinDir: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${nodeBinDir}:${process.env.PATH}` };
  // Never let an inherited deployment selector reach the CLI.
  for (const key of ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_AGENT_MODE"]) delete env[key];
  const cli = path.join(REPO_DIR, "node_modules/convex/bin/main.js");
  run(path.join(nodeBinDir, "node"), [cli, ...args, "--env-file", envFile], { cwd: dirs.project, env, quiet: true });
}

function pushFunctions(secrets: Secrets, nodeBinDir: string) {
  const envFile = prepareConvexProject(secrets);
  const deploymentEnv = path.join(dirs.project, "deployment.env");
  // auth.config.ts reads WIKI_BACKEND_JWKS at push time, so set env first.
  writeFileSync(deploymentEnv, formatEnvFile({ WIKI_BACKEND_JWKS: jwksDataUri(secrets), WIKI_PREFETCH_SECRET: secrets.prefetchSecret }), { mode: 0o600 });
  log("Setting Convex deployment env (WIKI_BACKEND_JWKS, WIKI_PREFETCH_SECRET)");
  convexCli(["env", "set", "--from-file", deploymentEnv, "--force"], envFile, nodeBinDir);
  log("Pushing apps/app/convex to the local backend");
  convexCli(["dev", "--once", "--codegen", "disable", "--typecheck", "disable", "--tail-logs", "disable"], envFile, nodeBinDir);
}

// ---------------------------------------------------------------------------
// Local Vercel Blob stand-in (subset of the API @vercel/blob put() uses).

function serveBlob() {
  mkdirSync(dirs.blob, { recursive: true });
  const filePath = (pathname: string) => {
    const resolved = path.resolve(dirs.blob, pathname.replace(/^\/+/, ""));
    if (!resolved.startsWith(dirs.blob + path.sep)) throw new Error("bad path");
    return resolved;
  };
  Bun.serve({
    hostname: "127.0.0.1",
    port: PORTS.blob,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return new Response("ok");
      if (url.pathname.startsWith("/api/blob")) {
        const pathname = url.searchParams.get("pathname");
        if (request.method !== "PUT" || !pathname) return Response.json({ error: { code: "not_found", message: "Unsupported local blob call" } }, { status: 404 });
        const target = filePath(pathname);
        mkdirSync(path.dirname(target), { recursive: true });
        const bytes = new Uint8Array(await request.arrayBuffer());
        await Bun.write(target, bytes);
        const contentType = request.headers.get("x-content-type") ?? "application/octet-stream";
        writeFileSync(`${target}.__meta`, JSON.stringify({ contentType }));
        const blobUrl = `${url.origin}/${pathname.split("/").map(encodeURIComponent).join("/")}`;
        return Response.json({
          url: blobUrl, downloadUrl: `${blobUrl}?download=1`, pathname, contentType,
          contentDisposition: `inline; filename="${path.basename(pathname)}"`, etag: `"${sha256(Buffer.from(bytes).toString("base64"))}"`,
        });
      }
      let target: string;
      try { target = filePath(decodeURIComponent(url.pathname)); } catch { return new Response("Bad path", { status: 400 }); }
      if (!existsSync(target) || target.endsWith(".__meta")) return new Response("Not found", { status: 404 });
      const meta = existsSync(`${target}.__meta`) ? JSON.parse(readFileSync(`${target}.__meta`, "utf8")) : {};
      const file = Bun.file(target);
      const headers = new Headers({ "Content-Type": meta.contentType ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=60" });
      const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
      if (range) {
        const size = file.size;
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        headers.set("Content-Length", String(end - start + 1));
        return new Response(request.method === "HEAD" ? null : file.slice(start, end + 1), { status: 206, headers });
      }
      headers.set("Content-Length", String(file.size));
      return new Response(request.method === "HEAD" ? null : file, { headers });
    },
  });
  console.log(`[local-blob] serving ${dirs.blob} on ${blobOrigin}`);
}

async function ensureBlobServer() {
  if (readPid("blob") && await ok(`${blobOrigin}/health`).catch(() => false)) return;
  await stopService("blob");
  log(`Starting local Blob stand-in on ${blobOrigin}`);
  startDetached("blob", process.execPath, [import.meta.path, "__serve-blob"], { cwd: APP_DIR, env: process.env });
  await waitFor("local Blob server", () => ok(`${blobOrigin}/health`));
}

// ---------------------------------------------------------------------------
// Reader build + seeding.

function ensureDist(env: Record<string, string>, force: boolean) {
  if (!force && existsSync(path.join(dirs.dist, "index.html"))) return;
  log(`Building the reader into ${path.relative(APP_DIR, dirs.dist)} (VITE_CONVEX_URL=${convexUrl})`);
  run(process.execPath, ["x", "vite", "build", "--outDir", dirs.dist, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: APP_DIR, env: { ...process.env, ...env },
  });
}

function startServer(env: Record<string, string>, port: number, logName: string): ChildProcess {
  mkdirSync(dirs.logs, { recursive: true });
  const out = openSync(path.join(dirs.logs, `${logName}.log`), "a");
  const child = spawn(process.execPath, [path.join(APP_DIR, "server/standalone.ts")], {
    cwd: APP_DIR, env: { ...process.env, ...env, PORT: String(port) }, stdio: ["ignore", out, out],
  });
  closeSync(out);
  return child;
}

async function seed(secrets: Secrets, env: Record<string, string>) {
  Object.assign(process.env, env);
  const { createBackendClient } = await import("../server/backend-client");
  const { api, internal } = await import("../convex/_generated/api");
  const { createPasswordSalt, hashPassword } = await import("../server/user-auth");
  const client = createBackendClient(convexUrl);
  // sites:ensureDiana is an internal operator function; the local admin key
  // may call it (the service JWT cannot).
  const operator = createBackendClient(convexUrl) as unknown as {
    setAdminAuth(key: string): void;
    mutation<M extends FunctionReference<"mutation", "internal">>(fn: M, args: FunctionArgs<M>): Promise<FunctionReturnType<M>>;
  };
  operator.setAdminAuth(secrets.adminKey);

  log(`Ensuring site "${LOCAL_SITE_SLUG}" (gate password: ${LOCAL_GATE_PASSWORD})`);
  await operator.mutation(internal.sites.ensureDiana, {
    ownerEmail: "owner@local.test",
    domain: "localhost",
    publishTokenHash: `sha256:${sha256(secrets.publishToken)}`,
    passwordHash: env.DIANA_WIKI_PASSWORD_HASH,
  });

  const server = startServer(env, PORTS.seedServer, "seed-server");
  const origin = `http://127.0.0.1:${PORTS.seedServer}`;
  try {
    await waitFor("seed app server", () => ok(`${origin}/robots.txt`));
    // The publisher reads ~/.config/wiki/<site>.json; give it a private HOME.
    mkdirSync(path.join(dirs.home, ".config/wiki"), { recursive: true });
    writeFileSync(path.join(dirs.home, ".config/wiki", `${LOCAL_SITE_SLUG}.json`), JSON.stringify({
      site: LOCAL_SITE_SLUG, vaultPath: FIXTURE_VAULT, publishUrl: `${origin}/api/publish`, openaiApiKey: "",
    }, null, 2));
    log(`Publishing ${path.relative(REPO_DIR, FIXTURE_VAULT)} through ${origin}/api/publish`);
    run(process.execPath, [
      path.join(REPO_DIR, "packages/oncobase/src/publish.ts"), "--site", LOCAL_SITE_SLUG,
      "--no-sync-preflight", "--allow-dirty", "--no-profile", "--embeddings", "skip", "--confirm-tombstone",
    ], {
      cwd: dirs.home,
      env: {
        ...process.env, HOME: dirs.home, OPENAI_API_KEY: "",
        WIKI_PUBLISH_TOKEN_DIANA: secrets.publishToken,
        BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN, VERCEL_BLOB_API_URL: env.VERCEL_BLOB_API_URL,
      },
    });

    log(`Ensuring care-team role and users (${LOCAL_CARE_USER.email}, ${LOCAL_READER_USER.email})`);
    const roles = await client.query(api.access.listRoles, { siteSlug: LOCAL_SITE_SLUG }) as Array<{ _id: string; name: string }>;
    const roleId = roles.find((role) => role.name === "care-team")?._id ?? await client.mutation(api.access.createRole, {
      name: "care-team", description: "Local stack: may read pages tagged sensitive", includeTags: ["sensitive"], siteSlug: LOCAL_SITE_SLUG,
    });
    for (const user of [LOCAL_CARE_USER, LOCAL_READER_USER]) {
      let existing = await client.query(api.users.getByEmailForAuth, { email: user.email, siteSlug: LOCAL_SITE_SLUG });
      if (!existing) {
        const passwordSalt = createPasswordSalt();
        await client.mutation(api.users.create, {
          email: user.email, name: user.name, passwordSalt, passwordHash: hashPassword(user.password, passwordSalt), siteSlug: LOCAL_SITE_SLUG,
        });
        existing = await client.query(api.users.getByEmailForAuth, { email: user.email, siteSlug: LOCAL_SITE_SLUG });
      }
      if (user === LOCAL_CARE_USER && existing) {
        await client.mutation(api.access.assignRoleToUser, { userId: existing._id, roleId: roleId as never, siteSlug: LOCAL_SITE_SLUG });
      }
    }

    // Manifest snapshots build asynchronously after publish; wait until the
    // reader can see the published documents.
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: LOCAL_GATE_PASSWORD }) });
    if (!login.ok) throw new Error(`Gate login failed during seeding: ${login.status} ${await login.text()}`);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    let documents = 0;
    await waitFor("manifest snapshot", async () => {
      const response = await fetch(`${origin}/api/wiki/manifest`, { headers: { Cookie: cookie } });
      if (!response.ok) return false;
      documents = ((await response.json() as { pages?: unknown[] }).pages ?? []).length;
      return documents > 0;
    }, 60_000);
    log(`Manifest ready (${documents} gate-visible documents)`);
  } finally {
    server.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// Commands.

async function stopAll() {
  await stopService("blob");
  await stopService("convex-backend");
}

async function status() {
  for (const [name, url] of [["convex-backend", `${convexUrl}/version`], ["blob", `${blobOrigin}/health`]] as const) {
    const pid = readPid(name);
    const healthy = await ok(url).catch(() => false);
    console.log(`${name.padEnd(15)} ${pid ? `pid ${pid}` : "not running"}${healthy ? `  ${new URL(url).origin}` : ""}`);
  }
  console.log(`env file        ${existsSync(STACK_ENV_FILE) ? STACK_ENV_FILE : "(missing)"}`);
}

function stackEnvForExec() {
  const env = parseEnvFile();
  if (!env.CONVEX_URL) throw new Error(`Missing ${STACK_ENV_FILE}; run \`bun run local:stack\` first.`);
  return env;
}

async function up({ reset, build }: { reset: boolean; build: boolean }) {
  if (process.env.CONVEX_DEPLOYMENT) log(`Ignoring CONVEX_DEPLOYMENT=${process.env.CONVEX_DEPLOYMENT}; the local stack only targets ${convexUrl}`);
  if (reset) {
    await stopAll();
    for (const entry of existsSync(STACK_DIR) ? readdirSync(STACK_DIR) : []) {
      if (entry !== "tools" && entry !== "dist") rmSync(path.join(STACK_DIR, entry), { recursive: true, force: true });
    }
    log("Reset local stack data, keys and logs");
  }
  mkdirSync(STACK_DIR, { recursive: true });
  writeFileSync(path.join(STACK_DIR, ".gitignore"), "*\n");
  const started = performance.now();
  const nodeBinDir = await ensureNodeBinDir();
  const binary = await ensureBackendBinary();
  const secrets = await loadSecrets(binary);
  const env = stackEnv(secrets);
  await ensureBackend(binary, secrets, nodeBinDir);
  pushFunctions(secrets, nodeBinDir);
  await ensureBlobServer();
  ensureDist(env, build);
  await seed(secrets, env);
  writeFileSync(STACK_ENV_FILE, formatEnvFile(env, [
    "Generated by apps/app/scripts/local-stack.ts. Local-only secrets; do not commit.",
    "Load with: set -a; source apps/app/.local-stack/env; set +a",
  ]), { mode: 0o600 });
  const rel = path.relative(process.cwd(), STACK_ENV_FILE) || STACK_ENV_FILE;
  log(`Ready in ${((performance.now() - started) / 1000).toFixed(1)}s. Env: ${STACK_ENV_FILE}`);
  console.log(`
Local stack is up (Convex ${convexUrl}, Blob ${blobOrigin}). From apps/app:

  Standalone server:  bun run local:stack serve            # http://127.0.0.1:${PORTS.app}
  Smoke test:         bun run local:smoke
  Vite dev server:    bun run local:stack exec -- bun dev
  Playwright (dev):   bun run local:stack exec -- bunx playwright test e2e/backend-api.spec.ts
  Playwright (server, in another shell while 'serve' runs):
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:${PORTS.app} WIKI_VITE_PREVIEW_LOGIN_PASSWORD=${LOCAL_GATE_PASSWORD} \\
      bun run local:stack exec -- bunx playwright test e2e/live-data.spec.ts
  Manual shell:       set -a; source ${rel}; set +a

Gate password: ${LOCAL_GATE_PASSWORD}
Users: ${LOCAL_CARE_USER.email} / ${LOCAL_CARE_USER.password} (care-team, sees sensitive)
       ${LOCAL_READER_USER.email} / ${LOCAL_READER_USER.password} (no role)
Stop with: bun run local:stack stop   Reset with: bun run local:stack --reset`);
}

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "up";
try {
  if (command === "__serve-blob") {
    serveBlob();
  } else if (command === "up") {
    await up({ reset: argv.includes("--reset"), build: argv.includes("--build") });
  } else if (command === "stop") {
    await stopAll();
  } else if (command === "status") {
    await status();
  } else if (command === "serve") {
    const env = stackEnvForExec();
    if (!existsSync(path.join(env.WIKI_DIST_DIR, "index.html"))) throw new Error("Stack dist missing; run `bun run local:stack --build`");
    const child = startServer(env, Number(process.env.PORT ?? PORTS.app), "app-server");
    console.log(`Standalone server on http://127.0.0.1:${process.env.PORT ?? PORTS.app} (log: ${path.join(dirs.logs, "app-server.log")})`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { child.kill("SIGTERM"); process.exit(0); });
    await new Promise((resolve) => child.on("exit", resolve));
  } else if (command === "exec") {
    const separator = argv.indexOf("--");
    const [bin, ...rest] = separator === -1 ? argv.slice(1) : argv.slice(separator + 1);
    if (!bin) throw new Error("Usage: bun run local:stack exec -- <command...>");
    const result = spawnSync(bin, rest, { stdio: "inherit", env: { ...process.env, ...stackEnvForExec() } });
    process.exit(result.status ?? 1);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`[local-stack] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

