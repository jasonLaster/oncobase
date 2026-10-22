import { join } from "node:path";
const port = Number(process.env.FOCUS_FIXTURE_PORT ?? "62828");
const directory = join(import.meta.dir, ".fixture-dist");
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/focus-fixture.css"><style>body{margin:0;padding:24px;background:#fff;color:#111;font-family:sans-serif}.dark body{background:#111;color:#eee}main{max-width:700px;margin:auto}[data-trigger-slot] img{max-width:100%;height:auto}.wiki-theater-image-button{max-width:100%}[data-theme-variant=dark]{display:none}.dark [data-theme-variant=light]{display:none}.dark [data-theme-variant=dark]{display:block}button:focus-visible,img[role=button]:focus-visible{outline:3px solid #7655db;outline-offset:3px}</style></head><body><div id="root"></div><script type="module" src="/focus-fixture.js"></script></body></html>`;
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (pathname === "/fixture-light.svg" || pathname === "/fixture-dark.svg") {
      const dark = pathname.includes("dark");
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${dark ? "#223" : "#dde"}"/><text x="40" y="210" fill="${dark ? "#fff" : "#111"}" font-size="32">Synthetic focus fixture</text></svg>`, { headers: { "content-type": "image/svg+xml" } });
    }
    if (pathname === "/focus-fixture.js" || pathname === "/focus-fixture.css") return new Response(Bun.file(join(directory, pathname.slice(1))));
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Focus fixture listening at ${server.url}`);
