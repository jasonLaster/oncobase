import { test as base } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnection, createServer, type Socket } from "node:net";

// WebKit's ephemeral contexts deny OPFS. Durable-cache contracts need a fresh
// regular profile; storage-availability.spec.ts separately covers the private/
// denied-storage fallback. Playwright applies the configured context options
// and records traces/screenshots for this context through its normal runner.
export const test = base.extend({
  baseURL: async ({ browserName, baseURL }, use) => {
    if (browserName !== "webkit") {
      await use(baseURL);
      return;
    }
    const upstream = new URL(baseURL ?? "http://127.0.0.1:60001");
    if (upstream.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(upstream.hostname)) {
      throw new Error("WebKit durable-cache tests require a loopback production-build server");
    }
    // This WebKit build retains OPFS across separate user-data directories.
    // Give each test a fresh origin as well as a fresh profile. A loopback TCP
    // relay preserves Host, headers, redirects and WebSockets without logging
    // or interpreting authenticated traffic.
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      const target = createConnection({ host: upstream.hostname, port: Number(upstream.port || 80) });
      for (const peer of [socket, target]) {
        sockets.add(peer);
        peer.on("close", () => sockets.delete(peer));
        peer.on("error", () => { socket.destroy(); target.destroy(); });
      }
      socket.pipe(target).pipe(socket);
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Loopback test origin unavailable");
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
  context: async ({ browserName, context, playwright, baseURL }, use) => {
    if (browserName !== "webkit") {
      await use(context);
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "oncobase-reader-webkit-"));
    let persistent: Awaited<ReturnType<typeof playwright.webkit.launchPersistentContext>> | undefined;
    try {
      persistent = await playwright.webkit.launchPersistentContext(directory);
      // Transfer the test's authorized state only in memory; never print it.
      await persistent.setStorageState(await context.storageState());
      await use(persistent);
    } finally {
      try {
        if (persistent) {
          // Release worker file locks, then remove only this test origin's
          // reader namespaces. Profile deletion alone does not clear OPFS in
          // this WebKit build. Never touch another origin's reader storage.
          for (const page of persistent.pages()) await page.close();
          const cleanupPage = await persistent.newPage();
          await cleanupPage.goto(`${baseURL}/terms-and-conditions`, { waitUntil: "domcontentloaded", timeout: 10_000 });
          const marker = `-${baseURL!.replace(/[^a-zA-Z0-9]/g, "_")}-`;
          await cleanupPage.evaluate(async originMarker => {
            const root = await navigator.storage.getDirectory() as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };
            for await (const name of root.keys()) {
              if (name.startsWith("livestore-wiki-vite-reader-") && name.includes(originMarker)) {
                await root.removeEntry(name, { recursive: true });
              }
            }
          }, marker);
        }
      } finally {
        try { await persistent?.close(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
    }
  },
});
