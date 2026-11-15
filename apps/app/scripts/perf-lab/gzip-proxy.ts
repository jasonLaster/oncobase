/**
 * Compressing reverse proxy in front of the standalone server, so transfer
 * sizes resemble production (the standalone server sends assets uncompressed).
 * Runs as its own process so its work does not share an event loop with the
 * Playwright driver.
 *
 *   bun scripts/perf-lab/gzip-proxy.ts --port 62004 --upstream http://127.0.0.1:62003
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const port = Number(arg("port"));
const upstream = new URL(arg("upstream") ?? "http://invalid");
if (!port || upstream.hostname !== "127.0.0.1") throw new Error("Usage: gzip-proxy.ts --port <n> --upstream http://127.0.0.1:<n>");
const upstreamHost = upstream.host;
const selfHost = `127.0.0.1:${port}`;
// Hashed assets never change for a given build, so compress each once.
const cache = new Map<string, ReturnType<typeof Bun.gzipSync>>();

Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__perf-lab-proxy/health") return new Response("ok");
    const headers = new Headers(request.headers);
    headers.set("host", upstreamHost);
    if (headers.has("origin")) headers.set("origin", upstream.origin);
    const referer = headers.get("referer");
    if (referer) headers.set("referer", referer.replace(selfHost, upstreamHost));
    // Bun's fetch would otherwise decompress upstream bodies while keeping the header.
    const init: RequestInit & { decompress: boolean } = {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      decompress: false,
    };
    const response = await fetch(upstream.origin + url.pathname + url.search, init);
    const out = new Headers(response.headers);
    const location = out.get("location");
    if (location) out.set("location", location.replace(upstreamHost, selfHost));
    const type = out.get("content-type") ?? "";
    const compressible = response.status === 200
      && /javascript|json|css|html|wasm|svg|text\//.test(type)
      && !type.includes("event-stream")
      && !out.has("content-encoding")
      && (request.headers.get("accept-encoding") ?? "").includes("gzip");
    if (!compressible) return new Response(response.body, { status: response.status, headers: out });
    const key = url.pathname.startsWith("/assets/") ? url.pathname : "";
    let body = key ? cache.get(key) : undefined;
    if (body) {
      await response.body?.cancel();
    } else {
      body = Bun.gzipSync(new Uint8Array(await response.arrayBuffer()), { level: 6 });
      if (key) cache.set(key, body);
    }
    out.set("content-encoding", "gzip");
    out.set("content-length", String(body.length));
    out.append("vary", "Accept-Encoding");
    return new Response(body, { status: response.status, headers: out });
  },
});
console.log(`[perf-lab] gzip proxy on http://${selfHost} -> ${upstream.origin}`);
