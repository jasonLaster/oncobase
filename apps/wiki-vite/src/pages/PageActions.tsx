import type { WikiScope } from "@oncobase/wiki-content";
import {
  WikiPageActionButton,
  copyTextToClipboard,
} from "@oncobase/wiki-shell";
import {
  CheckIcon,
  ClipboardIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
  title,
}: {
  content: string;
  contentHash: string | null;
  scope: WikiScope;
  slug: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const markCopied = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setCopied(true);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const copyMarkdown = async () => {
    await copyTextToClipboard(`# ${title}\n\n${content}`);
    markCopied();
  };

  return (
    <div className="wiki-vite-title-copy" data-test-id="page-actions">
      <ActionButton label="Copy page as markdown" onClick={copyMarkdown}>
        {copied ? <CheckIcon size={16} /> : <ClipboardIcon size={16} />}
      </ActionButton>
    </div>
  );
}
