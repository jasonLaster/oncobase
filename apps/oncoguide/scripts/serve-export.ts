import path from "node:path";
const root = path.resolve("out");
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".zip": "application/zip" };
Bun.serve({ port: Number(process.env.PORT || 62009), async fetch(request) {
  let urlPath: string;
  try { urlPath = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response("Bad request", { status: 400 }); }
  const filePath = path.resolve(root, `.${urlPath}${path.extname(urlPath) ? "" : `${urlPath.endsWith("/") ? "" : "/"}index.html`}`);
  if (!filePath.startsWith(`${root}/`)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!await file.exists()) return new Response(Bun.file(path.join(root, "404.html")), { status: 404, headers: { "Content-Type": "text/html" } });
  return new Response(request.method === "HEAD" ? null : file, { headers: { "Content-Type": mime[path.extname(filePath)] || file.type } });
} });
