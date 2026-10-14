import { createHash, randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { redactPageContent, sessionTokenFromCookie } from "../reader-access";
import { hashSessionToken } from "../user-auth";
import { fetchBlob } from "../blob-fetch";
import { getMimeType } from "./files";
import { boundedJson } from "../reader-telemetry";

export const SHARE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Host",
};
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: SHARE_HEADERS });

export async function handlePageShares(request: Request, client: ConvexHttpClient, siteSlug: string) {
  const url = new URL(request.url);
  const isRead = url.pathname === "/api/page-shares/read";
  const isAsset = url.pathname === "/api/page-shares/asset";
  const managing = url.pathname === "/api/page-shares";
  if (!managing && !isRead && !isAsset) return json({ error: "Not found" }, 404);
  if (!(managing ? ["GET", "POST", "DELETE"] : ["POST"]).includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...SHARE_HEADERS, Allow: managing ? "GET, POST, DELETE" : "POST" } });
  }
  // Cookie-authenticated mutations must come from the current origin.
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin) return json({ error: "Forbidden" }, 403);
  try {
    // Bound capability request bodies before JSON parsing.
    const body = request.method === "GET" ? {} : await boundedJson(request, 4096) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    if (isRead || isAsset) {
      if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return json({ error: "Link unavailable" }, 404);
      const args = { siteSlug, tokenHash: hashToken(body.token) };
      if (isRead) {
        const page = await client.query(api.pageShares.read, args);
        if (!page) return json({ error: "Link unavailable" }, 404);
        const safePage = await redactPageContent(client, siteSlug, page, request);
        return json(safePage);
      }
      if (typeof body.path !== "string" || body.path.length > 1024 ||
        body.path.startsWith("/") || body.path.split(/[\\/]/).includes("..")) return json({ error: "File unavailable" }, 404);
      const asset = await client.query(api.pageShares.asset, { ...args, path: body.path });
      const mime = getMimeType(body.path);
      if (!asset || !mime) return json({ error: "File unavailable" }, 404);
      const upstream = await fetchBlob(asset.blobUrl, { signal: request.signal });
      if (!upstream.ok) return json({ error: "File unavailable" }, 502);
      return new Response(upstream.body, { headers: { ...SHARE_HEADERS, "Content-Type": mime,
        "Content-Security-Policy": "sandbox", "Content-Disposition": "attachment" } });
    }
    const slug = request.method === "GET" ? url.searchParams.get("slug") : body.slug;
    if (typeof slug !== "string" || !slug || slug.length > 1024) return json({ error: "Invalid page" }, 400);
    const sessionToken = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
    if (!sessionToken) return json({ error: "Only the site owner or an admin can share this page." }, 403);
    const args = { siteSlug, slug, sessionTokenHash: hashSessionToken(sessionToken) };
    if (request.method === "GET") return json({ active: await client.query(api.pageShares.status, args) });
    if (request.method === "DELETE") {
      await client.mutation(api.pageShares.revoke, args);
      return json({ active: false });
    }
    const token = randomBytes(32).toString("base64url");
    const active = await client.mutation(api.pageShares.create, { ...args, tokenHash: hashToken(token) });
    // Fragments stay in the browser: the secret isn't in server access logs or
    // referrers, and is sent only in the body of a capability request.
    return json({ active, url: `${url.origin}/share#${token}` });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid request" }, 400);
    if (error instanceof Error && error.message === "Invalid telemetry size") return json({ error: "Request too large or empty" }, 413);
    if (error instanceof ConvexError) {
      if (error.data === "Forbidden") return json({ error: "Only the site owner or an admin can share this page." }, 403);
      if (error.data === "Page unavailable") return json({ error: "Page unavailable" }, 404);
    }
    // Never log the capability, request body or backend arguments.
    return json({ error: "Sharing is temporarily unavailable. Try again." }, 503);
  }
}
