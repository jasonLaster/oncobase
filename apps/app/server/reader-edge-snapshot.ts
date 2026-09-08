import { getCache } from "@vercel/functions";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createSharedReaderPolicyCache } from "./shared-reader-policy-cache";
import type { ReaderSnapshot } from "./reader-cache-context";
type Policy = Omit<ReaderSnapshot, "page">;
type PageCache = { get(key: string): Promise<unknown>; set(key: string, value: unknown, options: { ttl: number }): Promise<unknown> };
export function createReaderEdgeSnapshot(client: ConvexHttpClient, options: { now?: () => number; background: (task: Promise<unknown>) => void; pageCache?: PageCache; policyCache?: PageCache; maxAgeMs?: number }) {
  const pageCache = options.pageCache ?? getCache({ namespace: "wiki-reader-metadata-v1", keyHashFunction: key => bytesToHex(sha256(new TextEncoder().encode(key))) });
  const args = (host: string) => ({ host, ...(host.endsWith(".vercel.app") && process.env.WIKI_SITE_SLUG ? { previewSiteSlug: process.env.WIKI_SITE_SLUG } : {}) });
  const policies = createSharedReaderPolicyCache<Policy | null>({ ...options, shared: options.policyCache,
    read: host => client.query(api.documents.getReaderPolicy, args(host)) });
  const pages = new Map<string, ReaderSnapshot["page"]>();
  const keyFor = (host: string, revision: string, slug: string) => JSON.stringify([host, revision, slug]);
  const remember = (key: string, page: ReaderSnapshot["page"]) => {
    pages.delete(key); pages.set(key, page);
    while (pages.size > 512) pages.delete(pages.keys().next().value!);
  };
  return {
    warm: (host: string) => policies.get(host),
    async get(host: string, slug: string): Promise<ReaderSnapshot | null> {
      const policy = await policies.get(host);
      if (!policy) return null;
      const key = keyFor(host, policy.contentRevision, slug);
      if (options.maxAgeMs !== 0) {
        if (pages.has(key)) return { ...policy, page: pages.get(key)! };
        try {
          const stored = await pageCache.get(key) as { key: string; page: ReaderSnapshot["page"] } | null;
          if (stored?.key === key) { remember(key, stored.page); return { ...policy, page: stored.page }; }
        } catch { /* A fresh consistent read remains available when the cache fails. */ }
      }
      const snapshot = await client.query(api.documents.getReaderPage, { ...args(host), slug, metadataOnly: true });
      if (snapshot && options.maxAgeMs !== 0) {
        const currentKey = keyFor(host, snapshot.contentRevision, slug);
        remember(currentKey, snapshot.page);
        options.background(pageCache.set(currentKey, { key: currentKey, page: snapshot.page }, { ttl: 86400 }).catch(() => {}));
      }
      return snapshot;
    },
  };
}
