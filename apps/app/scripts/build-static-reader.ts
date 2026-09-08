import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api";
import { injectHtmlFirstPage } from "../server/html-first-experiment";
import { injectHeadMetadata } from "../server/html-head";
import { DIANA_SITE_NAME, legacyRouteMetadata } from "../server/legacy-route-metadata";
import { readerFingerprint, readerStaticPath, type ReaderSnapshot } from "../server/reader-cache-context";
import { readerSlug } from "../server/reader-route";

export function renderStaticReader(snapshot: ReaderSnapshot, url: URL, indexHtml: string, criticalCss: string) {
  if (!snapshot.page?.content || !snapshot.page.contentHash || snapshot.page.sensitive !== false) return null;
  const configured = parseSitePiiPatterns(snapshot.piiPatterns);
  const patterns = configured.length ? configured : snapshot.siteSlug === "diana" ? undefined : [];
  const page = { ...snapshot.page, title: applyPiiRedactions(snapshot.page.title, { patterns }),
    content: applyPiiRedactions(snapshot.page.content, { patterns }),
    description: snapshot.page.description ? applyPiiRedactions(snapshot.page.description, { patterns }) : undefined };
  const metadata = legacyRouteMetadata({ page, pathname: url.pathname,
    siteName: snapshot.siteSlug === "diana" ? DIANA_SITE_NAME : snapshot.siteSlug, slug: page.slug });
  const head = injectHeadMetadata(indexHtml, { ...metadata, noIndex: snapshot.gate.enabled,
    canonicalUrl: snapshot.gate.enabled ? undefined : url.origin + url.pathname });
  return injectHtmlFirstPage(head, page, url, snapshot.siteSlug, criticalCss);
}

export async function buildStaticReader({ appDir, indexHtml, criticalCss }: {appDir: string; indexHtml: string; criticalCss: string}) {
  if (process.env.WIKI_HTML_STATIC !== "1") return [];
  if (process.env.WIKI_VITE_EMBED_APP_SHELL !== "1") throw new Error("Static reader requires the Vercel edge-gated deployment");
  const origin = new URL(process.env.WIKI_STATIC_ORIGIN ?? "https://diana-tnbc.com");
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Invalid static reader origin");
  const client = new ConvexHttpClient(resolveServerConvexUrl());
  const policy = await client.query(api.documents.getReaderPolicy, {host:origin.hostname});
  if (!policy) throw new Error("Static reader site unavailable");
  const paths: string[] = [];
  let cursor: string | null = null;
  do {
    const batch: FunctionReturnType<typeof api.documents.listPage> = await client.query(api.documents.listPage, {siteSlug:policy.siteSlug,includeSensitive:false,cursor,numItems:500});
    for (const page of batch.page) {
      if(page.sensitive !== false) continue;
      const path = page.slug === "index" ? "/" : "/" + page.slug.split("/").map(encodeURIComponent).join("/");
      if(readerSlug(new Request(new URL(path,origin)))) paths.push(path);
    }
    if(batch.isDone)break;
    if(batch.continueCursor === cursor)throw new Error("Static reader pagination did not advance");
    cursor = batch.continueCursor;
  } while(cursor !== null);
  paths.sort((a,b)=>a==="/" ? -1 : b==="/" ? 1 : a.localeCompare(b));
  const eligible=[...new Set(paths)];
  const limit = Number(process.env.WIKI_STATIC_LIMIT ?? eligible.length);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid static reader limit");
  const selected = eligible.slice(0, limit), fingerprints: string[] = [];
  let next = 0, completed = 0, bytes = 0, skipped = 0;
  await Promise.all(Array.from({length:6},async()=>{
    while(next < selected.length){
      const path=selected[next++]!,url=new URL(path,origin),slug=readerSlug(new Request(url))!;
      try {
        const snapshot=await client.query(api.documents.getReaderPage,{host:origin.hostname,slug});
        if(!snapshot || snapshot.siteSlug!==policy.siteSlug || snapshot.page?.slug!==slug) { skipped++; continue; }
        const html=renderStaticReader(snapshot,url,indexHtml,criticalCss);
        if(!html){skipped++;continue;}
        const fingerprint=await readerFingerprint(snapshot);
        // Every generated file lives behind middleware's unconditional
        // reserved-namespace denial. None are anonymous public assets.
        await Bun.write(appDir+"/dist"+readerStaticPath(fingerprint),html);
        fingerprints.push(fingerprint);bytes+=Buffer.byteLength(html);
      } catch { throw new Error("Static reader generation failed; request and document data withheld"); }
      finally { completed++; if(completed%100===0||completed===selected.length) console.log(JSON.stringify({staticReaderCompleted:completed,total:selected.length,skipped})); }
    }
  }));
  await Bun.write(appDir+"/.vercel-functions/static-reader-build.json",JSON.stringify({origin:origin.origin,siteSlug:policy.siteSlug,
    generatedAt:new Date().toISOString(),eligible:eligible.length,selected:selected.length,rendered:fingerprints.length,skipped,bytes},null,2));
  return [...new Set(fingerprints.map(fp=>fp.slice(0,8)))].sort();
}
