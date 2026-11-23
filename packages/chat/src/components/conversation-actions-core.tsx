"use client";

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@oncobase/ui/menu";

export type ConversationActionsMenuProps = {
  archiveLabel?: string;
  copyLabel?: string;
  onArchive: () => Promise<void> | void;
  onCopyUrl: () => Promise<void> | void;
};

const ITEM_CLASS =
  "flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors data-highlighted:bg-[var(--accent-light)]";

export function ConversationActionsMenu({
  archiveLabel = "Archive",
  copyLabel = "Copy link",
  onArchive,
  onCopyUrl,
}: ConversationActionsMenuProps) {
  return (
    <Menu
      onAction={(value) => (value === "archive" ? onArchive() : onCopyUrl())}
    >
      <MenuTrigger
        aria-label="Conversation actions"
        className="p-0.5 rounded hover:bg-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--foreground)] data-open:bg-[var(--sidebar-border)] data-open:text-[var(--foreground)] transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3.5" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="8" cy="12.5" r="1.2" />
        </svg>
      </MenuTrigger>
      <MenuContent
        align="end"
        sideOffset={4}
        className="m-0 w-40 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] px-0 py-1 text-[var(--foreground)] shadow-lg"
      >
        <MenuItem value="copy" className={`${ITEM_CLASS} text-[var(--foreground)]`}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
            <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
          </svg>
          {copyLabel}
        </MenuItem>
        <MenuSeparator className="my-1 border-t border-[var(--sidebar-border)]" />
        <MenuItem
          value="archive"
          className={`${ITEM_CLASS} text-[var(--text-muted)] data-highlighted:text-[var(--foreground)]`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="12" height="4" rx="1" />
            <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
            <path d="M6.5 9.5h3" />
          </svg>
          {archiveLabel}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
