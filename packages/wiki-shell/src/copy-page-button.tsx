"use client";

import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "./page-chrome";

type CopyState = "idle" | "copying" | "copied" | "error";

function pageCopyUrl(slug: string, contentHash?: string, apiBasePath = "") {
  const url = new URL(`${apiBasePath}/api/page-copy`, window.location.origin);
  url.searchParams.set("slug", slug);
  url.searchParams.set("cacheKey", contentHash ?? "latest");
  return url;
}

export type WikiCopyPageButtonProps = {
  slug: string;
  title: string;
  contentHash?: string;
  apiBasePath?: string;
};

/**
 * Shared "copy page as markdown" button used by both the Next.js reader and the
 * Vite reader. Both apps serve `/api/page-copy?slug=&cacheKey=` from the same
 * origin, so the fetch contract is identical across apps.
 */
export function WikiCopyPageButton({
  slug,
  title,
  contentHash,
  apiBasePath = "",
}: WikiCopyPageButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copied = state === "copied";

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function handleCopy() {
    if (state === "copying") return;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setState("copying");
    try {
      const response = await fetch(pageCopyUrl(slug, contentHash, apiBasePath), {
        credentials: "same-origin",
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) throw new Error(`copy request failed: ${response.status}`);

      const content = await response.text();
      await copyTextToClipboard(`# ${title}\n\n${content}`);
      setState("copied");
      resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
    } catch (error) {
      console.error("[WikiCopyPageButton] Failed to copy page", error);
      setState("error");
      resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      aria-label="Copy page as markdown"
      title={state === "error" ? "Unable to copy" : "Copy as markdown"}
      disabled={state === "copying"}
      className="wiki-shell-icon-button"
      data-test-id="copy-page-button"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="5" width="8" height="8" rx="1" />
          <path d="M3 11V3a1 1 0 011-1h8" />
        </svg>
      )}
    </button>
  );
}
