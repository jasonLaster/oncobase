"use client";

import { useEffect, useRef, useState } from "react";

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function pageCopyUrl(slug: string, contentHash?: string) {
  const url = new URL("/api/page-copy", window.location.origin);
  url.searchParams.set("slug", slug);
  url.searchParams.set("cacheKey", contentHash ?? "latest");
  return url;
}

export function CopyPageButton({
  slug,
  title,
  contentHash,
}: {
  slug: string;
  title: string;
  contentHash?: string;
}) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copied = state === "copied";

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (state === "copying") return;

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    setState("copying");
    try {
      const response = await fetch(pageCopyUrl(slug, contentHash), {
        credentials: "same-origin",
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) {
        throw new Error(`copy request failed: ${response.status}`);
      }

      const content = await response.text();
      await writeClipboardText(`# ${title}\n\n${content}`);
      setState("copied");

      resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
    } catch (error) {
      console.error("[CopyPageButton] Failed to copy page", error);
      setState("error");
      resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      aria-label="Copy page as markdown"
      title={state === "error" ? "Unable to copy" : "Copy as markdown"}
      disabled={state === "copying"}
      className="p-1.5 rounded-md hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)] shrink-0"
      onClick={handleCopy}
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="8" height="8" rx="1" />
          <path d="M3 11V3a1 1 0 011-1h8" />
        </svg>
      )}
    </button>
  );
}
