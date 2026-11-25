// Page history client: /api/page-versions lists a page's past versions and
// returns one by id. The reader shows a past version at `?version=<id>`.
import { useEffect, useState } from "react";
import { backendHref } from "../wiki-utils";

export const VERSION_PARAM = "version";

export type PageVersionSummary = {
  id: string;
  title: string;
  versionAt: number;
  source: "publish" | "git";
  commitSha?: string;
  commitMessage?: string;
  size: number;
};

export type PageVersionList = {
  slug: string;
  current: { title: string; updatedAt: number };
  versions: PageVersionSummary[];
};

export type PageVersion = PageVersionSummary & { slug: string; content: string; tags: string[] };

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "missing" } | { status: "error" };

export function formatVersionDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function versionIdFromSearch(search: string) {
  const id = new URLSearchParams(search).get(VERSION_PARAM);
  return id && /^[a-z0-9]{1,64}$/i.test(id) ? id : null;
}

function useVersionsResource<T>(params: Record<string, string> | null) {
  const key = params ? JSON.stringify(params) : null;
  const [state, setState] = useState<{ key: string | null; value: Loadable<T> }>({ key: null, value: { status: "loading" } });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const load = async (): Promise<Loadable<T>> => {
      try {
        const response = await fetch(backendHref("/api/page-versions", JSON.parse(key) as Record<string, string>), { signal: controller.signal });
        if (response.status === 404) return { status: "missing" };
        if (!response.ok) return { status: "error" };
        return { status: "ready", data: (await response.json()) as T };
      } catch {
        return { status: "error" };
      }
    };
    void load().then(value => { if (!controller.signal.aborted) setState({ key, value }); }, () => {});
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.value : ({ status: "loading" } as const);
}

/** The version list for `slug`, fetched once `enabled` turns true. */
export function usePageVersions(slug: string, enabled: boolean) {
  return useVersionsResource<PageVersionList>(enabled ? { slug } : null);
}

/** One past version, or null params to skip. */
export function usePageVersion(slug: string, id: string | null) {
  return useVersionsResource<PageVersion>(id ? { slug, id } : null);
}
