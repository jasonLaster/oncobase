#!/usr/bin/env bun
/**
 * End-to-end smoke test of the standalone server against the local stack.
 *
 *   bun run local:stack   # once
 *   bun run local:smoke   # boots server/standalone.ts with tracing to a local OTLP sink
 *
 * Exercises the gate, HTML pages, reader APIs (session, manifest + ETag
 * revalidation, pages, search, files) and role-based sensitive access, then
 * prints latencies and exported span counts. Exits non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { LOCAL_CARE_USER, LOCAL_GATE_PASSWORD, LOCAL_READER_USER, STACK_DIR, requireStackEnv } from "./local-stack-env";

const env = requireStackEnv();
const port = Number(process.env.LOCAL_SMOKE_PORT ?? 62013);
const origin = `http://127.0.0.1:${port}`;

const convexHealthy = await fetch(`${env.CONVEX_URL}/version`).then((r) => r.ok).catch(() => false);
if (!convexHealthy) {
  console.error(`[local-smoke] Local Convex backend at ${env.CONVEX_URL} is not running. Run \`bun run local:stack\` first.`);
  process.exit(1);
}

// --- Local OTLP/HTTP JSON sink ----------------------------------------------
type OtlpJson = { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: Array<{ name: string; startTimeUnixNano?: string; endTimeUnixNano?: string }> }> }> };
const spans = new Map<string, { count: number; totalMs: number }>();
let exportRequests = 0;
let undecodedExports = 0;
const sink = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/traces") return new Response("Not found", { status: 404 });
    exportRequests++;
    if (!(request.headers.get("content-type") ?? "").includes("json")) {
      undecodedExports++;
      await request.arrayBuffer();
      return Response.json({});
    }
    const body = await request.json() as OtlpJson;
    for (const resource of body.resourceSpans ?? []) for (const scope of resource.scopeSpans ?? []) for (const span of scope.spans ?? []) {
      const entry = spans.get(span.name) ?? { count: 0, totalMs: 0 };
      entry.count++;
      if (span.startTimeUnixNano && span.endTimeUnixNano) entry.totalMs += Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1e6;
      spans.set(span.name, entry);
    }
    return Response.json({});
  },
});

// --- Standalone server -------------------------------------------------------
mkdirSync(path.join(STACK_DIR, "logs"), { recursive: true });
const logFile = path.join(STACK_DIR, "logs", "smoke-server.log");
const out = openSync(logFile, "w");
const server = spawn(process.execPath, [path.join(import.meta.dir, "../server/standalone.ts")], {
  cwd: path.join(import.meta.dir, ".."),
  env: {
    ...process.env, ...env, PORT: String(port),
    WIKI_BACKEND_TRACING: "1", WIKI_BACKEND_TRACE_SAMPLE_RATE: "1", WIKI_BACKEND_TIMING: "1",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${sink.port}/v1/traces`,
  },
  stdio: ["ignore", out, out],
});
closeSync(out);
let serverExited = false;
server.on("exit", () => { serverExited = true; });

async function shutdown() {
  if (!serverExited) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!serverExited) server.kill("SIGKILL");
  }
  sink.stop(true);
}

// --- Checks ------------------------------------------------------------------
type Result = { name: string; status: number; ms: number; ok: boolean; note?: string };
const results: Result[] = [];

async function check(name: string, url: string, init: RequestInit & { cookie?: string } = {}, assert?: (response: Response, body: string) => string | void) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${origin}${url}`, { redirect: "manual", ...init, headers });
  } catch (error) {
    results.push({ name, status: 0, ms: performance.now() - started, ok: false, note: String(error) });
    return undefined;
  }
  const body = await response.text();
  const ms = performance.now() - started;
  let note: string | void = undefined;
  let ok = response.status < 500;
  try { note = assert?.(response, body); } catch (error) { ok = false; note = error instanceof Error ? error.message : String(error); }
  results.push({ name, status: response.status, ms, ok, note: note || undefined });
  return { response, body };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cookieFrom = (response: Response | undefined, name: string) =>
  response?.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).find((cookie) => cookie.startsWith(`${name}=`));

const json = <T,>(body: string) => JSON.parse(body) as T;
type Manifest = { pages?: Array<{ slug: string }>; assets?: unknown[] };
type Pages = { pages: Array<{ slug: string; title: string; content?: string }>; unavailable?: Array<{ slug: string }> };

let failed = false;
try {
  const deadline = Date.now() + 20_000;
  while (!(await fetch(`${origin}/robots.txt`).then((r) => r.ok).catch(() => false))) {
    if (serverExited || Date.now() > deadline) throw new Error(`Standalone server did not start; see ${logFile}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await check("GET / without gate cookie", "/", {}, (response, body) => {
    expect(response.status === 200 && body.includes('name="wiki-reader-access" content="landing"'), `expected the landing page, got ${response.status}`);
    expect(response.headers.get("cache-control") === "private, no-store", "expected the landing page to stay private");
  });
  await check("GET private page without gate cookie", "/wiki/index", {}, (response) => {
    expect(response.status === 302 && response.headers.get("location")?.includes("/sign-in?redirect=%2Fwiki%2Findex"), `expected 302 to /sign-in, got ${response.status}`);
  });
  await check("POST /api/login wrong password", "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }),
  }, (response) => expect(response.status === 401, `expected 401, got ${response.status}`));
  const login = await check("POST /api/login", "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: LOCAL_GATE_PASSWORD }),
  }, (response) => expect(response.status === 200, `expected 200, got ${response.status}`));
  const gate = cookieFrom(login?.response, "authed");
  if (!gate) throw new Error("Gate login did not set the authed cookie");

  for (const [route, text] of [["/", "Local Fixture Wiki"], ["/wiki/treatment", "Treatment notes"], ["/wiki/biomarkers/her2-low", "HER2-low"]] as const) {
    await check(`GET ${route} (HTML)`, route, { cookie: gate, headers: { Accept: "text/html" } }, (response, body) => {
      expect(response.status === 200, `expected 200, got ${response.status}`);
      expect((response.headers.get("content-type") ?? "").includes("text/html"), "expected text/html");
      return body.includes(text) ? "content in HTML" : "app shell (content loads client-side)";
    });
  }

  await check("GET /api/wiki/session", "/api/wiki/session", { cookie: gate }, (response, body) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
    const session = json<{ siteSlug?: string }>(body);
    expect(session.siteSlug === "diana", `unexpected siteSlug ${session.siteSlug}`);
  });

  const manifest = await check("GET /api/wiki/manifest", "/api/wiki/manifest", { cookie: gate }, (response, body) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
    const slugs = (json<Manifest>(body).pages ?? []).map((page) => page.slug);
    expect(slugs.includes("wiki/treatment"), "manifest missing wiki/treatment");
    expect(!slugs.some((slug) => slug.startsWith("private/")), "gate-only manifest leaked a sensitive slug");
    return `${slugs.length} pages, etag ${response.headers.get("etag") ? "present" : "missing"}`;
  });
  const etag = manifest?.response.headers.get("etag");
  await check("GET /api/wiki/manifest (If-None-Match)", "/api/wiki/manifest", {
    cookie: gate, headers: etag ? { "If-None-Match": etag } : {},
  }, (response) => {
    expect(etag, "first manifest response had no ETag");
    expect(response.status === 304, `expected 304, got ${response.status}`);
  });

  await check("GET /api/wiki/pages", "/api/wiki/pages?slugs=index,wiki/treatment,wiki/timeline", { cookie: gate }, (response, body) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
    const pages = json<Pages>(body).pages;
    expect(pages.length === 3, `expected 3 pages, got ${pages.length}`);
    expect(pages.find((page) => page.slug === "wiki/treatment")?.content?.includes("pembrolizumab"), "treatment content missing");
  });
  await check("GET /api/wiki/pages (sensitive, gate only)", "/api/wiki/pages?slugs=private/care-team-notes", { cookie: gate }, (response, body) => {
    expect(response.status < 500, `unexpected ${response.status}`);
    if (response.status === 200) expect(!json<Pages>(body).pages.some((page) => page.slug === "private/care-team-notes"), "sensitive page visible to gate-only reader");
  });

  await check("GET /api/search", "/api/search?q=pembrolizumab", { cookie: gate }, (response, body) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
    return `${body.length} bytes`;
  });

  await check("GET /api/file (public PDF)", "/api/file?path=sources/papers/sample-trial.pdf", { cookie: gate }, (response, body) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
    expect(body.startsWith("%PDF"), "expected PDF bytes");
  });
  await check("GET /api/file (image)", "/api/file?path=wiki/images/treatment-timeline.png", { cookie: gate }, (response) => {
    expect(response.status === 200, `expected 200, got ${response.status}`);
  });
  await check("GET /api/file (sensitive PDF, gate only)", "/api/file?path=private/lab-report.pdf", { cookie: gate }, (response) => {
    expect(response.status === 404, `expected 404, got ${response.status}`);
  });

  for (const user of [LOCAL_CARE_USER, LOCAL_READER_USER]) {
    const signin = await check(`POST /api/auth/signin (${user.email})`, "/api/auth/signin", {
      method: "POST", cookie: gate, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    }, (response) => expect(response.status === 200, `expected 200, got ${response.status}`));
    const session = cookieFrom(signin?.response, "wiki_user_session");
    if (!session) throw new Error(`Sign-in for ${user.email} did not set a session cookie`);
    const cookie = `${gate}; ${session}`;
    const canSee = user === LOCAL_CARE_USER;
    await check(`GET /api/wiki/pages?scope=session (${user.email})`, "/api/wiki/pages?scope=session&slugs=private/care-team-notes", { cookie }, (response, body) => {
      expect(response.status === 200, `expected 200, got ${response.status}`);
      const visible = json<Pages>(body).pages.some((page) => page.slug === "private/care-team-notes");
      expect(visible === canSee, canSee ? "care-team user cannot read sensitive page" : "unassigned user can read sensitive page");
    });
    await check(`GET /api/wiki/manifest?scope=session (${user.email})`, "/api/wiki/manifest?scope=session", { cookie }, (response, body) => {
      expect(response.status === 200, `expected 200, got ${response.status}`);
      const slugs = (json<Manifest>(body).pages ?? []).map((page) => page.slug);
      expect(slugs.includes("private/care-team-notes") === canSee, canSee ? "session manifest missing sensitive page" : "session manifest leaked sensitive page");
      return `${slugs.length} pages`;
    });
    await check(`GET /api/file sensitive (${user.email})`, "/api/file?path=private/lab-report.pdf", { cookie }, (response) => {
      expect(response.status === (canSee ? 200 : 404), `expected ${canSee ? 200 : 404}, got ${response.status}`);
    });
  }
} catch (error) {
  failed = true;
  console.error(`[local-smoke] ${error instanceof Error ? error.message : String(error)}`);
}

// Spans export in 1s batches; give the processor time to flush before exit.
await new Promise((resolve) => setTimeout(resolve, 2500));
await shutdown();

console.log(`\n${"Request".padEnd(60)} status     ms  result`);
for (const result of results) {
  console.log(`${result.name.padEnd(60)} ${String(result.status).padStart(6)} ${result.ms.toFixed(0).padStart(6)}  ${result.ok ? "ok" : "FAIL"}${result.note ? `  ${result.note}` : ""}`);
}
console.log(`\nSpans exported (${exportRequests} OTLP requests${undecodedExports ? `, ${undecodedExports} non-JSON` : ""}):`);
for (const [name, { count, totalMs }] of [...spans].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(count).padStart(4)}  ${name.padEnd(48)} avg ${(totalMs / count).toFixed(1)}ms`);
}

const failures = results.filter((result) => !result.ok);
if (spans.size === 0) { console.error("[local-smoke] No spans reached the local OTLP sink"); failed = true; }
if (failures.length || failed) {
  console.error(`\n[local-smoke] FAILED (${failures.length} failing checks). Server log: ${logFile}`);
  process.exit(1);
}
console.log(`\n[local-smoke] OK: ${results.length} checks passed`);
