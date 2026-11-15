import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Store } from "@livestore/livestore";
import { expandCompactFileTree, type CompactFileNode, type FileNode } from "@oncobase/wiki-content";
import { useWebMcpTools, type WebMcpCall } from "@oncobase/wiki-shell/webmcp";
import { assets$, fileTree$, pageContentBySlug$, pageIndex$ } from "../livestore/queries";
import type { AssetIndexRow, PageContentRow, PageIndexRow } from "../types";
import { AGENT_ACCESS_CHANGE_EVENT, agentsMayReadPrivatePages } from "./agent-access";
import { createReaderTools } from "./reader-tools";

const env = import.meta.env as Record<string, string | undefined>;
const commentsEnabled = (env.VITE_NEXT_PUBLIC_ENABLE_COMMENTS ?? env.VITE_ENABLE_COMMENTS) !== "false";

const CONTENT_ROOT = '[data-test-id="document-article"] .wiki-markdown';

/**
 * Registers the reader's WebMCP tools on every reader route while the
 * LiveStore store exists. Mounted by ReaderAgentTools (agent-tools.tsx) only in
 * browsers with WebMCP; renders nothing.
 */
export function ReaderWebMcp({
  store,
  scope,
  signedIn,
  recentSlugs,
  routeContentSlug,
  onCall,
}: {
  store: Store;
  scope: "public" | "session";
  signedIn: boolean;
  recentSlugs: () => string[];
  routeContentSlug: (pathname: string) => string;
  onCall: (call: WebMcpCall) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  const tools = useMemo(() => {
    let treeSource = "";
    let treeCache: FileNode[] = [];
    return createReaderTools({
      scope,
      signedIn,
      pages: () => store.query(pageIndex$) as PageIndexRow[],
      tree: () => {
        const raw = store.query(fileTree$)?.treeJson ?? "[]";
        if (raw !== treeSource) {
          treeSource = raw;
          try {
            treeCache = expandCompactFileTree(JSON.parse(raw) as CompactFileNode[]);
          } catch {
            treeCache = [];
          }
        }
        return treeCache;
      },
      assets: () => store.query(assets$) as AssetIndexRow[],
      cachedPage: (slug) => (store.query(pageContentBySlug$(slug)) as PageContentRow | null) ?? null,
      recentSlugs,
      allowPrivate: agentsMayReadPrivatePages,
      commentsEnabled,
      navigate: (href) => navigate(href),
      location: () => locationRef.current,
      fetch: (input, init) => fetch(input, init),
      contentRoot: () => document.querySelector<HTMLElement>(CONTENT_ROOT),
      pageReady: (slug) =>
        routeContentSlug(window.location.pathname).toLowerCase() === slug.toLowerCase()
        && Boolean(document.querySelector('[data-reader-ready="true"]'))
        && Boolean(document.querySelector(CONTENT_ROOT)),
    });
  }, [navigate, recentSlugs, routeContentSlug, scope, signedIn, store]);

  // Re-register when consent changes so descriptions and results agree.
  const [accessVersion, setAccessVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setAccessVersion((value) => value + 1);
    window.addEventListener(AGENT_ACCESS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(AGENT_ACCESS_CHANGE_EVENT, onChange);
  }, []);

  useWebMcpTools(tools, { key: `${scope}:${signedIn ? "1" : "0"}:${accessVersion}`, onCall });
  return null;
}
