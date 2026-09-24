import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublishProfile } from "./publish-profile";
import { publisherPost } from "./publish-post";

test("nested concurrent requests retain parentage, body timings and numeric metrics without private data", async () => {
  const parents: string[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    parents.push(request.headers.get("traceparent")!);
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode('{"page":['));
      await Bun.sleep(20);
      controller.enqueue(new TextEncoder().encode('{"content":"PRIVATE response"}]}'));
      controller.close();
    } }), { headers: { "Server-Timing": 'backend;dur=2.5, convex;dur=1.2, convex-count;desc="3", PRIVATE;desc="secret"' } });
  } });
  const profile = new PublishProfile(true);
  try {
    await Promise.all(["plan", "verify.documents"].map(name => profile.span(name as "plan" | "verify.documents", () =>
      publisherPost(`http://127.0.0.1:${server.port}/api/publish/sync/documents?secret=PRIVATE`, "PRIVATE token", { siteSlug: "PRIVATE site" }, { profile }),
    )));
    const snapshot = profile.snapshot();
    const requests = snapshot.spans.filter(s => s.name === "http.sync/documents");
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map(s => s.parentId)).size).toBe(2);
    for (const request of requests) {
      expect(parents).toContain(`00-${profile.traceId}-${request.id}-01`);
      expect(request.metrics).toMatchObject({ status: 200, items: 1, serverMs: 2.5, rpcSumMs: 1.2, rpcCount: 3 });
      expect(request.metrics.responseBytes).toBeGreaterThan(20);
      expect(snapshot.spans.find(s => s.parentId === request.id && s.name === "http.body")!.durationMs).toBeGreaterThan(5);
      expect(snapshot.spans.filter(s => s.parentId === request.id).map(s => s.name)).toEqual(["http.serialize", "http.headers", "http.body", "http.parse"]);
    }
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
    expect(snapshot.spans.every(s => s.outcome === "ok")).toBe(true);
  } finally { server.stop(true); }
});

test("failed HTTP and parsing spans record failure but never error bodies; disabled profiles don't propagate", async () => {
  let header: string | null = null;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    header = request.headers.get("traceparent");
    return new Response('{"step":"begin","error":"PRIVATE"}', { status: 500 });
  } });
  try {
    const profile = new PublishProfile(true);
    const url = `http://127.0.0.1:${server.port}/api/publish/PRIVATE`;
    await expect(publisherPost(url, "secret", {}, { profile })).rejects.toThrow("500 begin: PRIVATE");
    expect(profile.snapshot().spans[0]).toMatchObject({ name: "http.other", outcome: "error", metrics: { status: 500 } });
    expect(JSON.stringify(profile.snapshot())).not.toContain("PRIVATE");
    const disabled = new PublishProfile();
    await expect(publisherPost(url, "secret", {}, { profile: disabled })).rejects.toThrow();
    expect(header).toBeNull();
    expect(disabled.snapshot().spans).toHaveLength(0);
    const broken = new PublishProfile(true);
    expect(() => broken.sync("http.parse", () => JSON.parse("PRIVATE"))).toThrow();
    expect(broken.snapshot().spans[0]!.outcome).toBe("error");
    expect(JSON.stringify(broken.snapshot())).not.toContain("PRIVATE");
  } finally { server.stop(true); }
});

test("profile files are private, bounded, preserve pending work, and refuse overwrites or symlinks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-profile-"));
  try {
    const profile = new PublishProfile(true, 2);
    let release!: () => void;
    const waiting = profile.span("upload.documents", () => new Promise<void>(resolve => { release = resolve; }));
    profile.sync("git.check", () => {});
    profile.sync("config", () => {});
    expect(profile.snapshot().droppedSpans).toBe(1);
    const file = path.join(dir, "trace.json");
    profile.write(file, 130);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.exitCode).toBe(130);
    expect(saved.spans[0].outcome).toBe("running");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(() => profile.write(file)).toThrow();
    const link = path.join(dir, "link.json"); fs.symlinkSync(file, link);
    expect(() => profile.write(link)).toThrow();
    release(); await waiting;
    expect(profile.snapshot().spans[0]!.outcome).toBe("ok");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
