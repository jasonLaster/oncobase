/**
 * Stack orchestration for the perf lab:
 *   local stack up (Convex + Blob, reader dist rebuilt from the working tree)
 *   -> standalone server (`local-stack.ts serve`)
 *   -> synthetic vault published through that server
 *   -> gzip proxy in front of it.
 * `stop()` tears down everything this module started, and only that: a local
 * stack that was already running is left running.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { APP_DIR, LOCAL_GATE_PASSWORD, LOCAL_SITE_SLUG, PORTS, REPO_DIR, STACK_DIR, requireStackEnv } from "../local-stack-env";
import { PAGES, writeVault, type VaultStats } from "./vault";

export const LAB_DIR = path.join(STACK_DIR, "perf-lab");
export const PROXY_PORT = Number(process.env.PERF_LAB_PROXY_PORT ?? PORTS.app + 1);
const LOCAL_STACK = path.join(APP_DIR, "scripts/local-stack.ts");
const log = (message: string) => console.log(`[perf-lab] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Stack = { base: string; appOrigin: string; vault: VaultStats; stop(): Promise<void> };

const ok = (url: string) => fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

async function waitFor(label: string, probe: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${label}`);
}

function portInUse(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function logFile(name: string) {
  mkdirSync(path.join(LAB_DIR, "logs"), { recursive: true });
  return path.join(LAB_DIR, "logs", `${name}.log`);
}

function tail(file: string, lines = 40) {
  try { return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n"); } catch { return "(no log)"; }
}

/** Run a step to completion, logging to a file; on failure throw with the log's tail. */
function runStep(name: string, command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const file = logFile(name);
  const out = openSync(file, "w");
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: options.cwd ?? APP_DIR, env: options.env ?? process.env, stdio: ["ignore", out, out] });
  closeSync(out);
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status ?? result.signal}). Last lines of ${file}:\n${tail(file)}`);
  log(`${name} done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

/** A long-running child in its own process group, so its grandchildren stop with it. */
function startService(name: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  const out = openSync(logFile(name), "w");
  const child = spawn(command, args, { cwd: APP_DIR, env, detached: true, stdio: ["ignore", out, out] });
  closeSync(out);
  return child;
}

async function stopService(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
}

async function gateCookie(origin: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: LOCAL_GATE_PASSWORD }) });
  if (!response.ok) throw new Error(`Gate login failed: ${response.status}`);
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}

/**
 * Prefetch priorities come from recorded page visits (`pageVisitStats`), which
 * persist in the local backend across runs and which the lab's own loads add
 * to. A page that became a priority is prefetched after load, which changes
 * both post-load bytes and whether a later navigation fetches its body. Clear
 * the table so every run starts from the same history. Uses the isolated
 * self-hosted env file local-stack.ts writes, which can only name 127.0.0.1.
 */
function resetVisitHistory(tempDir: string) {
  const project = path.join(STACK_DIR, "convex-project");
  const envFile = path.join(project, "self-hosted.env");
  const url = readFileSync(envFile, "utf8").match(/^CONVEX_SELF_HOSTED_URL=(.*)$/m)?.[1] ?? "";
  if (new URL(url).hostname !== "127.0.0.1") throw new Error(`Refusing to reset visit history on non-local Convex ${url}`);
  const empty = path.join(tempDir, "empty.jsonl");
  writeFileSync(empty, "");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_AGENT_MODE"]) delete env[key];
  runStep("reset-visit-history", process.execPath, [
    path.join(REPO_DIR, "node_modules/convex/bin/main.js"), "import", "--table", "pageVisitStats", "--replace", "--yes", "--format", "jsonLines", empty, "--env-file", envFile,
  ], { cwd: project, env });
}

export async function startStack({ build }: { build: boolean }): Promise<Stack> {
  const appOrigin = `http://127.0.0.1:${PORTS.app}`;
  const base = `http://127.0.0.1:${PROXY_PORT}`;
  const children: { serve?: ChildProcess; proxy?: ChildProcess } = {};
  const stackWasRunning = await ok(`http://127.0.0.1:${PORTS.convex}/version`);
  let tempDir: string | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopService(children.proxy);
    await stopService(children.serve);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (!stackWasRunning) {
      spawnSync(process.execPath, [LOCAL_STACK, "stop"], { cwd: APP_DIR, env: process.env, stdio: "ignore" });
      log("stopped the local stack");
    }
  };
  try {
    for (const [port, variable] of [[PORTS.app, "LOCAL_STACK_APP_PORT"], [PROXY_PORT, "PERF_LAB_PROXY_PORT"]] as const) {
      if (await portInUse(port)) throw new Error(`Port ${port} is already in use; stop what is listening there or set ${variable}`);
    }
    log(`${stackWasRunning ? "reusing" : "starting"} the local stack (Convex :${PORTS.convex}, app :${PORTS.app}, proxy :${PROXY_PORT})${build ? ", rebuilding the reader" : ""}`);
    runStep("local-stack-up", process.execPath, [LOCAL_STACK, ...(build ? ["--build"] : [])]);
    const env = requireStackEnv();
    if (!existsSync(path.join(env.WIKI_DIST_DIR, "index.html"))) throw new Error("Stack dist missing; run with --build");

    children.serve = startService("app-server", process.execPath, [LOCAL_STACK, "serve"], { ...process.env, PORT: String(PORTS.app) });
    await waitFor("the standalone server", () => ok(`${appOrigin}/robots.txt`), 60_000);

    // `local:stack` (re)seeds the fixture vault on every run, tombstoning the
    // synthetic pages, so publish the synthetic vault afterwards
    // (--confirm-tombstone then replaces the fixture). The vault lives outside
    // the repository: the publisher skips git-ignored files, and .local-stack
    // is ignored.
    tempDir = mkdtempSync(path.join(os.tmpdir(), "oncobase-perf-lab-"));
    const vaultDir = path.join(tempDir, "vault");
    const home = path.join(tempDir, "home");
    const vault = writeVault(vaultDir);
    log(`generated ${vault.pages} pages (${(vault.bytes / 1e6).toFixed(1)} MB, fingerprint ${vault.fingerprint})`);
    mkdirSync(path.join(home, ".config/wiki"), { recursive: true });
    writeFileSync(path.join(home, ".config/wiki", `${LOCAL_SITE_SLUG}.json`), JSON.stringify({ site: LOCAL_SITE_SLUG, vaultPath: vaultDir, publishUrl: `${appOrigin}/api/publish`, openaiApiKey: "" }, null, 2));
    const secrets = JSON.parse(readFileSync(path.join(STACK_DIR, "secrets.json"), "utf8")) as { publishToken: string };
    runStep("publish", process.execPath, [
      path.join(REPO_DIR, "packages/oncobase/src/publish.ts"), "--site", LOCAL_SITE_SLUG,
      "--no-sync-preflight", "--allow-dirty", "--no-profile", "--embeddings", "skip", "--confirm-tombstone",
    ], { cwd: home, env: { ...process.env, ...env, HOME: home, OPENAI_API_KEY: "", WIKI_PUBLISH_TOKEN_DIANA: secrets.publishToken } });

    // Manifest snapshots build asynchronously: wait until the gate manifest
    // lists exactly the synthetic vault's public pages.
    const cookie = await gateCookie(appOrigin);
    const expected = vault.pages - vault.sensitive;
    let seen = 0;
    await waitFor(`a manifest with ${expected} public pages`, async () => {
      const response = await fetch(`${appOrigin}/api/wiki/manifest`, { headers: { Cookie: cookie } });
      if (!response.ok) return false;
      const pages = ((await response.json()) as { pages?: Array<{ slug: string }> }).pages ?? [];
      seen = pages.length;
      return pages.length === expected && pages.some((p) => p.slug === PAGES.large);
    }, 120_000).catch((error: Error) => { throw new Error(`${error.message} (last saw ${seen})`); });

    resetVisitHistory(tempDir);

    children.proxy = startService("gzip-proxy", process.execPath, [path.join(import.meta.dir, "gzip-proxy.ts"), "--port", String(PROXY_PORT), "--upstream", appOrigin], process.env);
    await waitFor("the gzip proxy", () => ok(`${base}/__perf-lab-proxy/health`), 15_000);
    log(`ready: ${base} (gzip proxy) -> ${appOrigin} (standalone server)`);
    return { base, appOrigin, vault, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
