import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("CLI dry-run cannot sync/write; skipped asset makes a real publish fail and abort", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-command-"));
  const calls: string[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const step = new URL(request.url).pathname.split("/publish/")[1];
    calls.push(step);
    const body = await request.json();
    if (step === "scoped/begin") return Response.json({ scoped: true, runId: body.runId,
      missingDocumentSlugs: [], missingAssetPaths: ["image.png"], staleDocumentSlugs: [], staleAssetPaths: [],
      assetChanges: [{ path: "image.png", kind: "file", reason: "hashMismatch" }],
    });
    if (step === "scoped/abort") return Response.json({ ok: true });
    throw new Error(`Unexpected endpoint ${step}`);
  } });
  try {
    fs.writeFileSync(path.join(dir, "home.md"), "# Home\n![image](image.png)");
    fs.writeFileSync(path.join(dir, "image.png"), "image");
    const scopeFile = path.join(dir, "scope.json");
    fs.writeFileSync(scopeFile, '["home.md"]');
    const source = import.meta.dir;
    const run = async (extra: string[]) => {
      const script = `import {mock} from "bun:test";
        mock.module(${JSON.stringify(path.join(source, "config.ts"))}, () => ({loadConfig: () => (${JSON.stringify({ site: "fixture", vaultPath: dir, publishUrl: `http://127.0.0.1:${server.port}/api/publish` })}), loadPublishToken: () => "fixture"}));
        mock.module(${JSON.stringify(path.join(source, "blob.ts"))}, () => ({sitePut: async () => {throw new Error("fixture upload failure")}}));
        process.argv = ["bun", "publish", ...${JSON.stringify(["--site", "fixture", "--files-from", scopeFile, "--embeddings", "skip", "--allow-dirty", "--profile", path.join(dir, `profile-${crypto.randomUUID()}.json`), ...extra])}];
        await import(${JSON.stringify(path.join(source, "publish.ts"))});`;
      const child = Bun.spawn([process.execPath, "--eval", script], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { output: stdout + stderr, exitCode };
    };
    const dry = await run(["--dry-run"]);
    expect(dry.exitCode, dry.output).toBe(0);
    expect(dry.output).toContain("sync=none");
    expect(calls).toEqual(["scoped/begin"]);
    calls.length = 0;
    const failed = await run([]);
    expect(failed.exitCode).toBe(1);
    expect(failed.output).toContain("refusing to report success");
    expect(failed.output).not.toContain("Published 0 documents");
    expect(calls).toEqual(["scoped/begin", "scoped/abort"]);
    expect(fs.existsSync(path.join(dir, ".skipped-assets.txt"))).toBe(true);
    calls.length = 0;
    const typo = await run(["--asset", "none"]);
    expect(typo.exitCode).toBe(1);
    expect(calls).toEqual([]);
  } finally { server.stop(true); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI reports success only after content and reader confirmation; a committed mismatch stays a failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-confirm-"));
  const calls: string[] = [];
  let published: any;
  let mismatch = false, readinessCalls = 0, combined = false;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const step = new URL(request.url).pathname.split("/publish/")[1];
    calls.push(step);
    const body = await request.json();
    if (step === "scoped/begin") return Response.json({ scoped: true, capabilities: combined ? { complete: 1 } : undefined, runId: body.runId, missingDocumentSlugs: ["home"], missingAssetPaths: [], staleDocumentSlugs: [], staleAssetPaths: [], assetChanges: [] });
    if (step === "document") { published = body; return Response.json({ ok: true }); }
    if (step === "state") return Response.json({ version: 1, documents: [{ slug: published.slug, exists: true, contentHash: published.hash, observedHash: published.hash, readerContentConsistent: true, hashFunctionVersion: published.hashFunctionVersion, sensitive: published.sensitive, sensitiveInclude: published.sensitiveInclude }], assets: [] });
    if (step === "scoped/complete") {
      expect(body.documents[0].hash).toBe(published.hash);
      expect(body.verification).toBe("content");
      return Response.json({ committed: true, revision: 2, ready: !mismatch, documentMismatches: mismatch ? 1 : 0 });
    }
    if (step === "scoped/finish") return Response.json({ ok: true, revision: 2 });
    if (step === "status") {
      readinessCalls++;
      return Response.json(mismatch ? { ready: false, documentMismatches: 1 } : { ready: readinessCalls > 1 });
    }
    throw new Error(`Unexpected endpoint ${step}`);
  } });
  try {
    fs.writeFileSync(path.join(dir, "home.md"), "# Home\nPublished body");
    const scope = path.join(dir, "scope.json");
    fs.writeFileSync(scope, '["home.md"]');
    const run = async () => {
      const script = `import {mock} from "bun:test";
        mock.module(${JSON.stringify(path.join(import.meta.dir, "config.ts"))}, () => ({ loadConfig: () => (${JSON.stringify({ site: "fixture", vaultPath: path.join(dir, "unused-config-path"), publishUrl: `http://127.0.0.1:${server.port}/api/publish` })}), loadPublishToken: () => "fixture" }));
        process.argv = ["bun", "publish", ...${JSON.stringify(["--site", "fixture", "--vault", dir, "--files-from", scope, "--assets", "none", "--embeddings", "skip", "--allow-dirty", "--profile", path.join(dir, `profile-${crypto.randomUUID()}.json`)])}];
        await import(${JSON.stringify(path.join(import.meta.dir, "publish.ts"))});`;
      const child = Bun.spawn([process.execPath, "--eval", script], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { output: out + err, code };
    };
    const success = await run();
    expect(success.code, success.output).toBe(0);
    expect(success.output).toContain("Published 1 documents");
    expect(calls).toEqual(["scoped/begin", "document", "state", "scoped/finish", "status", "status"]);
    mismatch = true; calls.length = 0;
    const failed = await run();
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("Data committed, but reader readiness could not be confirmed");
    expect(failed.output).not.toContain("Published 1 documents");
    expect(calls).not.toContain("scoped/abort");
    combined = true; mismatch = false; calls.length = 0;
    expect((await run()).code).toBe(0);
    expect(calls).toEqual(["scoped/begin", "document", "scoped/complete"]);
    mismatch = true; calls.length = 0;
    const rejected = await run();
    expect(rejected.code).toBe(1);
    expect(rejected.output).not.toContain("Published 1 documents");
    expect(calls).not.toContain("scoped/abort");
  } finally { server.stop(true); fs.rmSync(dir, { recursive: true, force: true }); }
});
