import type { ConvexHttpClient } from "convex/browser";
import { ImageResponse } from "@vercel/og";
import { sharePreviewMetadata } from "./share-preview";

export async function handleShareImageRequest(request: Request, client: ConvexHttpClient, siteSlug: string) {
  const headers = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", vary: "Host" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  }
  const metadata = await sharePreviewMetadata(request, client, siteSlug);
  // Do not distinguish a private document from a nonexistent document.
  if (!metadata.hasPageCard) return new Response(null, { status: 404, headers });
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Type": "image/png" } });
  const title = clip(metadata.ogTitle, 180);
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "58px 68px",
      background: "#0f0f1a", color: "#f6f4ff", fontFamily: "sans-serif", borderTop: "8px solid #b3a2ee" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#c1b2ed", fontSize: 24 }}>
        <div style={{ width: 14, height: 14, borderRadius: 7, background: "#b3a2ee" }} />
        {clip(metadata.siteName, 70)}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 24 }}>
        <div style={{ fontSize: title.length > 100 ? 48 : title.length > 60 ? 58 : 70, lineHeight: 1.12, letterSpacing: "-2px", wordBreak: /\S{40}/.test(title) ? "break-all" : "normal" }}>{title}</div>
        <div style={{ fontSize: 28, lineHeight: 1.4, color: "#bab6ca" }}>{clip(metadata.ogDescription, 156)}</div>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: "#88829a" }}>Shared from {clip(new URL(request.url).hostname, 70)}</div>
    </div>,
    { width: 1200, height: 630, headers },
  );
}

function clip(text: string, length: number) {
  const characters = Array.from(text);
  return characters.length > length ? `${characters.slice(0, length - 1).join("").trimEnd()}…` : text;
}
