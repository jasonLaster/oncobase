import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { webkit } from "playwright";

// A finite capability measurement, not a test waiver. Four fresh browser
// contexts visit an empty local page; no application/API/backend is contacted.
const result = { utc: new Date().toISOString(), platform: process.platform,
  arch: process.arch, playwright: createRequire(import.meta.url)("playwright/package.json").version,
  measurements: [], applicationRequests: 0, cookiesRead: 0, testPassCredit: 0 };
for (const mode of ["persistent", "private"]) for (const host of ["127.0.0.1", "localhost"]) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp" });
    response.end("<!doctype html><title>Storage capability probe</title>");
  });
  const directory = await mkdtemp(path.join(tmpdir(), "oncobase-storage-probe-"));
  let browser, context;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Probe origin unavailable");
    if (mode === "persistent") context = await webkit.launchPersistentContext(directory, { headless: true });
    else { browser = await webkit.launch(); context = await browser.newContext(); }
    const page = await context.newPage();
    await page.goto(`http://${host}:${address.port}`, { waitUntil: "domcontentloaded", timeout: 10_000 });
    const capability = await page.evaluate(async () => {
      const state = { secureContext: isSecureContext, crossOriginIsolated,
        getDirectoryType: typeof navigator.storage?.getDirectory, rootOpened: false,
        createWritableType: "unobserved", sentinelMatches: false, errorName: null };
      try {
        const root = await navigator.storage.getDirectory();
        state.rootOpened = true;
        const file = await root.getFileHandle("capability-probe-sentinel", { create: true });
        state.createWritableType = typeof file.createWritable;
        const writer = await file.createWritable();
        await writer.write("storage-probe");
        await writer.close();
        state.sentinelMatches = await (await file.getFile()).text() === "storage-probe";
        await root.removeEntry("capability-probe-sentinel");
      } catch (error) {
        state.errorName = ["TypeError", "UnknownError", "SecurityError", "InvalidStateError", "NotAllowedError"].includes(error.name) ? error.name : "OTHER";
      }
      return state;
    });
    result.measurements.push({ mode, host, ...capability });
  } catch (error) {
    result.measurements.push({ mode, host, probeErrorClass: ["TimeoutError", "Error"].includes(error.name) ? error.name : "OTHER" });
  } finally {
    try { await context?.close(); await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
  }
}
console.log(JSON.stringify(result, null, 2));
