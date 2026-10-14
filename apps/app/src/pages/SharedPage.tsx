import { createContext, lazy, Suspense, useContext, useEffect, useState, type ComponentProps } from "react";
import { WikiMarkdown, MarkdownTitle, type WikiMarkdownLinkProps } from "@oncobase/wiki-markdown/browser";
import { useLocation } from "react-router";
import { LockKeyhole } from "lucide-react";
import "./page-sharing.css";

const ShareToken = createContext("");
const MermaidRenderer = lazy(() => import("@oncobase/wiki-markdown/mermaid").then(m => ({ default: m.WikiMermaidRenderer })));
type SharedDocument = { slug: string; title: string; content: string };

// Keep capabilities out of the ordinary reader, LiveStore, localStorage and
// telemetry. Hash navigation within the article must preserve the share link.
function filePathFromHref(href?: string) {
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    if (url.origin === location.origin && url.pathname === "/api/file") return url.searchParams.get("path");
  } catch { /* Invalid links receive ordinary link handling. */ }
  return null;
}

async function sharedFile(token: string, path: string, signal?: AbortSignal) {
  const response = await fetch("/api/page-shares/asset", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, path }) });
  if (!response.ok) throw new Error("This file is unavailable through this share link.");
  return response.blob();
}

function SharedImage({ src, alt, ...props }: ComponentProps<"img">) {
  const token = useContext(ShareToken);
  const path = typeof src === "string" ? filePathFromHref(src) : null;
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void sharedFile(token, path, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setResult({ path, url: objectUrl });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, token]);
  if (path && (failed || !result || result.path !== path)) return <span className="shared-page-status">{failed ? "Image unavailable" : "Loading image…"}</span>;
  return <img {...props} src={path ? result?.url : src} alt={alt ?? ""} referrerPolicy="no-referrer" />;
}

function SharedLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  const token = useContext(ShareToken);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = href?.startsWith("#shared-file:") ? decodeURIComponent(href.slice(13)) : null;
  if (path) return <>
    <button className="shared-file-link" disabled={busy} onClick={async () => {
      setError(""); setBusy(true);
      try {
        const blob = await sharedFile(token, path);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = path.split("/").at(-1) ?? "file";
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) { setError(error instanceof Error ? error.message : "File unavailable"); }
      finally { setBusy(false); }
    }}>{busy ? "Loading file…" : children}</button>
    {error ? <span role="alert"> {error}</span> : null}
  </>;
  return <a {...props} href={href} rel="noreferrer" onClick={event => {
    if (href?.startsWith("#")) {
      event.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView();
    }
  }}>{children}</a>;
}

function sharedLinkHref(href: string | undefined) {
  const path = filePathFromHref(href);
  return path ? `#shared-file:${encodeURIComponent(path)}` : href;
}
const allLinks = (href: string | undefined): href is string => typeof href === "string";

export function SharedPage() {
  const { hash } = useLocation();
  return <SharedPageContent key={hash} token={hash.slice(1)} />;
}

function SharedPageContent({ token }: { token: string }) {
  const [page, setPage] = useState<SharedDocument | null>(null);
  const [error, setError] = useState(() => /^[A-Za-z0-9_-]{43}$/.test(token) ? "" : "This link is incomplete or unavailable.");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    document.title = "Shared page";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    void fetch("/api/page-shares/read", { method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404 ? "This link was revoked or is unavailable." : "This page could not be loaded. Try again.");
        const data: SharedDocument = await response.json();
        if (!controller.signal.aborted) { setPage(data); document.title = "Shared private page"; }
      }).catch(error => { if (!controller.signal.aborted) { setPage(null); setError(error.message); } });
    return () => controller.abort();
  }, [token, attempt]);

  // A visible recipient should stop seeing a revoked page without needing a
  // full reload. Files always authorize separately; never persist page bodies.
  useEffect(() => {
    if (!page) return;
    const refresh = () => setAttempt(value => value + 1);
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [page]);

  return <ShareToken.Provider value={token}>
    <main className="shared-page" data-test-id="shared-page" onClickCapture={event => {
      // The shared markdown's native anchor handler runs before React's bubble
      // handler. Intercept here so section jumps cannot replace the capability.
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      const href = anchor?.getAttribute("href");
      if (href?.startsWith("#")) {
        event.preventDefault(); event.stopPropagation();
        try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); } catch { /* Malformed section link. */ }
      }
    }}>
      <header><span>Oncobase</span><span>Read only</span></header>
      {page && !error ? <aside className="shared-page-privacy" role="note" aria-label="Private page" data-test-id="shared-page-privacy">
        <LockKeyhole size={20} aria-hidden="true" />
        <div><strong>Private page</strong><p>Only people with this secure URL can access this shared view. Keep the link private.</p></div>
      </aside> : null}
      {error ? <div role="alert"><h1>Page unavailable</h1><p>{error}</p>
        {/^[A-Za-z0-9_-]{43}$/.test(token) ? <button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button> : null}</div>
        : page ? <article data-test-id="shared-article">
          {page.content.match(/^#\s+([^\r\n]+)/)?.[1]?.trim() === page.title.trim() ? null : <h1><MarkdownTitle title={page.title} /></h1>}
          <WikiMarkdown content={page.content} currentSlug={page.slug} LinkComponent={SharedLink}
            ImageComponent={SharedImage} resolveLinkHref={sharedLinkHref} isInternalHref={allLinks} disableAnchors />
          {/^[ \t]*```mermaid[ \t]*$/m.test(page.content) ? <Suspense fallback={null}><MermaidRenderer /></Suspense> : null}
        </article> : <p role="status">Opening shared page…</p>}
    </main>
  </ShareToken.Provider>;
}
