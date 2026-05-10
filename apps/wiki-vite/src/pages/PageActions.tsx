import type { WikiScope } from "@diana-tnbc/wiki-content";
import {
  WikiPageActionButton,
  WikiPageActionLink,
  WikiPageActions,
  copyTextToClipboard,
} from "@diana-tnbc/wiki-shell";
import {
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinkIcon,
  PrinterIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { backendHref, hrefForSlug } from "../wiki-utils";

function pageCopyHref(slug: string, contentHash: string | null, scope: WikiScope) {
  const params = new URLSearchParams({
    slug,
    cacheKey: contentHash ?? "latest",
    scope,
  });
  return backendHref(`/api/page-copy?${params.toString()}`);
}

function ActionButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <WikiPageActionButton aria-label={label} title={label} onClick={onClick}>
      {children}
    </WikiPageActionButton>
  );
}

export function PageActions({
  content,
  contentHash,
  scope,
  slug,
  title,
}: {
  content: string;
  contentHash: string | null;
  scope: WikiScope;
  slug: string;
  title: string;
}) {
  const [copied, setCopied] = useState<"markdown" | "link" | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHref = pageCopyHref(slug, contentHash, scope);
  const mainAppHref = backendHref(hrefForSlug(slug));

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const markCopied = (kind: "markdown" | "link") => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setCopied(kind);
    resetTimerRef.current = setTimeout(() => setCopied(null), 1800);
  };

  const copyMarkdown = async () => {
    await copyTextToClipboard(`# ${title}\n\n${content}`);
    markCopied("markdown");
  };

  const copyLink = async () => {
    await copyTextToClipboard(window.location.href);
    markCopied("link");
  };

  return (
    <WikiPageActions data-test-id="page-actions">
      <ActionButton label="Copy page as markdown" onClick={copyMarkdown}>
        {copied === "markdown" ? <CheckIcon size={15} /> : <ClipboardIcon size={15} />}
        <span>{copied === "markdown" ? "Copied" : "Copy"}</span>
      </ActionButton>
      <ActionButton label="Copy page link" onClick={copyLink}>
        {copied === "link" ? <CheckIcon size={15} /> : <LinkIcon size={15} />}
        <span>{copied === "link" ? "Copied" : "Link"}</span>
      </ActionButton>
      <ActionButton label="Print page" onClick={() => window.print()}>
        <PrinterIcon size={15} />
        <span>Print</span>
      </ActionButton>
      <WikiPageActionLink href={copyHref} download={`${slug.split("/").at(-1) ?? slug}.md`}>
        <DownloadIcon size={15} />
        <span>Markdown</span>
      </WikiPageActionLink>
      <WikiPageActionLink href={mainAppHref}>
        <ExternalLinkIcon size={15} />
        <span>Main app</span>
      </WikiPageActionLink>
    </WikiPageActions>
  );
}
