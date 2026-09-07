import { useStore } from "@livestore/react";
import type {
  WikiScope,
  WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import {
  isCurrentReaderHydrated,
  isCurrentReaderManifestValidated,
  isRouteUnavailableInCurrentReader,
  retirePreviousReaderStore,
} from "./cache-retirement";
import {
  dismissFirstFrameSnapshot,
  retireFirstFrameSnapshotsForPath,
} from "./first-frame-snapshot";
import {
  fileTree$,
  pageContentBySlug$,
  pageIndexBySlug$,
  siteState$,
} from "./queries";


export function FirstFrameSnapshotSync({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
  const { store } = useStore();
  const location = useLocation();
  const slug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  const state = store.useQuery(siteState$) as SiteStateRow | null;
  const page = store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const index = store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const fileTree = store.useQuery(fileTree$) as { treeJson: string } | null;
  const retirementStarted = useRef(false);

  useEffect(() => {
    const unavailable = scope === "public"
      ? isRouteUnavailableInCurrentReader({ index, page })
      : !index || ["deleted", "missing", "sensitive-unavailable"].includes(page?.contentStatus ?? "");
    if (
      !fileTree ||
      !isCurrentReaderManifestValidated({ identity, scope, state }) ||
      !unavailable
    ) {
      return;
    }

    retireFirstFrameSnapshotsForPath(
      window.localStorage,
      window.location.origin,
      location.pathname,
    );
    dismissFirstFrameSnapshot();
    if (scope === "public" && !retirementStarted.current) {
      retirementStarted.current = true;
      void retirePreviousReaderStore({
        identity,
        origin: window.location.origin,
        scope,
      });
    }
  }, [fileTree, identity, index, location.pathname, page, scope, state]);

  useEffect(() => {
    if (
      !fileTree ||
      !isCurrentReaderHydrated({ identity, state, page, scope })
    ) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const capture = () => {
      const shell = document.querySelector<HTMLElement>(
        "#root .prototype-shell",
      );
      const article = shell?.querySelector(
        '[data-test-id="document-article"]',
      );
      const sidebar = shell?.querySelector('[data-test-id="wiki-sidebar"]');
      if (
        !shell ||
        // Home intentionally omits its title. The rendered markdown body is
        // the readiness signal; a heading is a presentation choice.
        !article?.querySelector(".wiki-markdown") ||
        !sidebar?.textContent?.trim() ||
        article.querySelector('[data-test-id="page-loading"]')
      ) {
        attempts += 1;
        if (attempts < 300) {
          frame = window.requestAnimationFrame(capture);
        }
        return;
      }

      // Hand control to the hydrated app before cloning/serializing its DOM.
      // This cache optimization must never hold the first interactive frame.
      dismissFirstFrameSnapshot();
      // Authenticated content may take over a public snapshot, but must never
      // be copied into the public first-frame cache.
      if (scope !== "public") return;
      persistTimer = setTimeout(async () => {
        try {
          const { persistSafeSnapshot } = await import("./snapshot-html");
          if (cancelled || !shell.isConnected) return;
          const persisted = persistSafeSnapshot(shell, location.pathname, state?.lastValidatedAt ?? 0);
          if (persisted && !retirementStarted.current) {
            retirementStarted.current = true;
            void retirePreviousReaderStore({
              identity,
              origin: window.location.origin,
              scope,
            });
          }
        } catch {
          // The hydrated app remains authoritative when storage is unavailable.
        }
      }, 100);
    };
    frame = window.requestAnimationFrame(capture);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (persistTimer !== undefined) clearTimeout(persistTimer);
    };
  }, [fileTree, identity, location.pathname, page, scope, state]);

  return null;
}
