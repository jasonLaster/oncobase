import { CopyPageIcon } from "../shell/copy-page-icon";
import type { WikiScope } from "@oncobase/wiki-content";
import { copyTextToClipboard } from "@oncobase/wiki-shell";
import { toast } from "@oncobase/ui/toast";
import { Toolbar, ToolbarButton } from "@oncobase/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import { History, LinkIcon, LockKeyhole } from "lucide-react";
import { type ComponentProps, lazy, Suspense, useState } from "react";

// Lazy: the menu and its fetch stay out of the reader's first-paint chunk.
const PageHistoryMenu = lazy(() => import("./PageHistoryMenu"));

const PAGE_HISTORY_PLACEHOLDER = (
  <ToolbarButton aria-label="Page history" className="wiki-shell-page-action page-action" disabled>
    <History size={16} />
  </ToolbarButton>
);

const PageShareDialog = lazy(() => import("./PageShareDialog").then(m => ({ default: m.PageShareDialog })));

function ActionButton({
  className,
  label,
  ...props
}: Omit<ComponentProps<typeof ToolbarButton>, "className"> & { className?: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<ToolbarButton aria-label={label} className={["wiki-shell-page-action page-action", className].filter(Boolean).join(" ")} {...props} />}
      />
      <TooltipContent className="reader-tooltip">{label}</TooltipContent>
    </Tooltip>
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
  const [sharing, setSharing] = useState(false);

  const copyMarkdown = async () => {
    try {
      // MDX components, layout directives and data figures copy as portable markdown.
      const { toPortableMarkdown } = await import("@oncobase/wiki-markdown/portable");
      await copyTextToClipboard(`# ${title}\n\n${toPortableMarkdown(content)}`);
      toast.success("Page copied as markdown");
    } catch (error) {
      console.warn("[wiki-vite] copy page failed", error);
      toast.error("Copy failed");
    }
  };

  const copyLink = async () => {
    try {
      await copyTextToClipboard(window.location.href);
      toast.success("Link copied");
    } catch (error) {
      console.warn("[wiki-vite] copy page link failed", error);
      toast.error("Copy failed");
    }
  };

  return (
    <>
      <Toolbar aria-label="Page actions" className="wiki-vite-title-copy" data-test-id="page-actions">
        {sensitive ? (
          <ActionButton
            aria-haspopup="dialog"
            className="size-11"
            data-test-id="sensitive-page-lock"
            label="Share private page"
            onClick={() => setSharing(true)}
          >
            <LockKeyhole size={16} />
          </ActionButton>
        ) : null}
        <Suspense fallback={PAGE_HISTORY_PLACEHOLDER}>
          <PageHistoryMenu slug={slug} />
        </Suspense>
        <ActionButton label="Copy page link" onClick={copyLink}>
          <LinkIcon size={16} />
        </ActionButton>
        <ActionButton label="Copy page as markdown" onClick={copyMarkdown}>
          <CopyPageIcon />
        </ActionButton>
      </Toolbar>
      {sharing ? (
        <Suspense fallback={null}>
          <PageShareDialog key={slug} slug={slug} title={title} onClose={() => setSharing(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
