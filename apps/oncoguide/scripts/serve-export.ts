import path from "node:path";
const root = path.resolve("out");
if (process.env.ONCOGUIDE_CHAT_LOCAL === "1" && process.env.ONCOGUIDE_CHAT_REPLAY === "1") throw Error("Choose live chat or offline replay, not both");
const replay = process.env.ONCOGUIDE_CHAT_REPLAY === "1" ? import("../e2e/support/gateway-replay").then(({ createGatewayReplay }) => createGatewayReplay()) : undefined;
// Validate fixtures before the server announces readiness.
if (replay) await replay;
// Optional local preview uses the same Oncobase handler and the exported corpus.
// Enable explicitly and provide the existing server AI Gateway configuration.
const localChat = process.env.ONCOGUIDE_CHAT_LOCAL === "1" ? import("../../app/server/education-chat").then(async ({ createEducationChatHandler }) => {
  const { EducationCorpusSchema } = await import("@oncobase/education/chat");
  return createEducationChatHandler({ getCorpus: async () => EducationCorpusSchema.parse(await Bun.file(path.join(root, "chat-index.json")).json()) });
}) : undefined;
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".zip": "application/zip" };
Bun.serve({ port: Number(process.env.PORT || 62009), hostname: replay ? "127.0.0.1" : undefined, async fetch(request) {
  if (replay) {
    const response = await (await replay)(request);
    if (response) return response;
  }
  if (localChat && new URL(request.url).pathname === "/api/education/chat") return (await localChat)(request);
  let urlPath: string;
  try { urlPath = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response("Bad request", { status: 400 }); }
  const filePath = path.resolve(root, `.${urlPath}${path.extname(urlPath) ? "" : `${urlPath.endsWith("/") ? "" : "/"}index.html`}`);
  if (!filePath.startsWith(`${root}/`)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!await file.exists()) return new Response(Bun.file(path.join(root, "404.html")), { status: 404, headers: { "Content-Type": "text/html" } });
  return new Response(request.method === "HEAD" ? null : file, { headers: { "Content-Type": mime[path.extname(filePath)] || file.type } });
} });
