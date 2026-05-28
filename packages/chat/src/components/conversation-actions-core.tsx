"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

export type ConversationActionsMenuProps = {
  archiveLabel?: string;
  copyLabel?: string;
  onArchive: () => Promise<void> | void;
  onCopyUrl: () => Promise<void> | void;
};

function stopItemEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function ConversationActionsMenu({
  archiveLabel = "Archive",
  copyLabel = "Copy link",
  onArchive,
  onCopyUrl,
}: ConversationActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handler = (event: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const runAction = async (action: () => Promise<void> | void) => {
    await action();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative" onClick={(event) => event.preventDefault()}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Conversation actions"
        className="p-0.5 rounded hover:bg-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
        onClick={(event) => {
          stopItemEvent(event);
          setOpen((value) => !value);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3.5" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="8" cy="12.5" r="1.2" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] shadow-lg z-50 py-1">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors text-left"
            onClick={(event) => {
              stopItemEvent(event);
              void runAction(onCopyUrl);
            }}
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
              <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
              <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
            </svg>
            {copyLabel}
          </button>
          <div className="border-t border-[var(--sidebar-border)] my-1" />
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] transition-colors text-left"
            onClick={(event) => {
              stopItemEvent(event);
              void runAction(onArchive);
            }}
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
          </button>
        </div>
      ) : null}
    </div>
  );
}
