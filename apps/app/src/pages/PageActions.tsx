import { CopyPageIcon } from "../shell/copy-page-icon";
import { toPortableMarkdown } from "@oncobase/wiki-markdown/mdx";
import type { WikiScope } from "@oncobase/wiki-content";
import {
  WikiPageActionButton,
  copyTextToClipboard,
} from "@oncobase/wiki-shell";
import {
  CheckIcon,
  LinkIcon,
  LockKeyhole,
} from "lucide-react";
import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from "react";

const PageShareDialog = lazy(() => import("./PageShareDialog").then(m => ({ default: m.PageShareDialog })));

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
  sensitive,
  slug,
  title,
}: {
  content: string;
  contentHash: string | null;
  scope: WikiScope;
  sensitive?: boolean;
  slug: string;
  title: string;
}) {
  const [copied, setCopied] = useState<"markdown" | "link" | null>(null);
  const [sharing, setSharing] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    try {
      // MDX components copy as their static fallback image.
      await copyTextToClipboard(`# ${title}\n\n${toPortableMarkdown(content)}`);
      markCopied("markdown");
    } catch (error) {
      // Clipboard permission can be denied; leave the copy icon unchanged.
      console.warn("[wiki-vite] copy page failed", error);
    }
  };

  const copyLink = async () => {
    try {
      await copyTextToClipboard(window.location.href);
      markCopied("link");
    } catch (error) {
      console.warn("[wiki-vite] copy page link failed", error);
    }
  };

  return (
    <div className="wiki-vite-title-copy" data-test-id="page-actions">
      {sensitive ? <WikiPageActionButton aria-label="Share private page" title="Share private page"
        className="size-11"
        data-test-id="sensitive-page-lock" aria-haspopup="dialog" onClick={event => { event.currentTarget.focus(); setSharing(true); }}>
        <LockKeyhole size={16} />
      </WikiPageActionButton> : null}
      {sharing ? <Suspense fallback={null}><PageShareDialog key={slug} slug={slug} title={title} onClose={() => setSharing(false)} /></Suspense> : null}
      <ActionButton label="Copy page link" onClick={copyLink}>
        {copied === "link" ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
      </ActionButton>
      <ActionButton label="Copy page as markdown" onClick={copyMarkdown}>
        {copied === "markdown" ? <CheckIcon size={16} /> : <CopyPageIcon />}
      </ActionButton>
    </div>
  );
}
