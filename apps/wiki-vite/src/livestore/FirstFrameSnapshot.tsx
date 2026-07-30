import { useStore } from "@livestore/react";
import type {
  WikiScope,
  WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { PageContentRow, SiteStateRow } from "../types";
import { slugFromPath } from "../wiki-utils";
import {
  isCurrentReaderHydrated,
  retirePreviousReaderStore,
} from "./cache-retirement";
import {
  dismissFirstFrameSnapshot,
  persistFirstFrameSnapshot,
  retirePreviousFirstFrameSnapshot,
} from "./first-frame-snapshot";
import { fileTree$, pageContentBySlug$, siteState$ } from "./queries";

function snapshotSafeShell(shell: HTMLElement) {
  const clone = shell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, iframe, object, embed").forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        ((name === "href" || name === "src" || name === "formaction") &&
          (value.startsWith("javascript:") ||
            value.startsWith("data:text/html")))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return clone.outerHTML;
}

export function FirstFrameSnapshotSync({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
  const { store } = useStore();
  const location = useLocation();
  const slug = slugFromPath(location.pathname);
  const state = store.useQuery(siteState$) as SiteStateRow | null;
  const page = store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const fileTree = store.useQuery(fileTree$) as { treeJson: string } | null;
  const retirementStarted = useRef(false);

  useEffect(() => {
    if (
      scope !== "public" ||
      !fileTree ||
      !isCurrentReaderHydrated({ identity, state, page, scope })
    ) {
      return;
    }

    let frame = 0;
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
        !article?.querySelector("h1") ||
        !sidebar?.textContent?.trim() ||
        article.querySelector('[data-test-id="page-loading"]')
      ) {
        attempts += 1;
        if (attempts < 300) {
          frame = window.requestAnimationFrame(capture);
        }
        return;
      }

      try {
        const persisted = persistFirstFrameSnapshot(
          window.localStorage,
          window.location.origin,
          {
            html: snapshotSafeShell(shell),
            pathname: location.pathname,
          },
          { validatedAt: state?.lastValidatedAt ?? 0 },
        );
        if (persisted && !retirementStarted.current) {
          retirementStarted.current = true;
          retirePreviousFirstFrameSnapshot(
            window.localStorage,
            window.location.origin,
          );
          void retirePreviousReaderStore({
            identity,
            origin: window.location.origin,
            scope,
          });
        }
      } catch {
        // The hydrated app remains authoritative when storage is unavailable.
      }
      dismissFirstFrameSnapshot();
    };
    frame = window.requestAnimationFrame(capture);

    return () => window.cancelAnimationFrame(frame);
  }, [fileTree, identity, location.pathname, page, scope, state]);

  return null;
}
