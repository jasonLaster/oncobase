"use client";

/**
 * Tool-call primitives shared by the message tree and host tool renderers.
 *
 * Kept separate from messages.tsx so hosts that only render tool-call chrome
 * (e.g. a sidebar chat sheet) do not pull in the streaming markdown renderer
 * and its react-markdown dependency graph.
 */

import { memo } from "react";

export const DefaultToolCallBlock = memo(function DefaultToolCallBlock({
  toolName,
  state,
}: {
  toolName: string;
  state: string;
}) {
  const done = state === "output-available" || state === "output-error";
  const readableName = toolName.replace(/[-_]+/g, " ");
  const label = done ? `Used ${readableName}` : `Running ${readableName}...`;
  return (
    <div className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
      {!done ? (
        <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 opacity-40">
          <polyline points="4 8 7 11 12 5" />
        </svg>
      )}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
});

export function getChatToolInfo(part: Record<string, unknown>) {
  const type = part.type as string;
  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    return {
      toolName: (part.toolName as string) || type.replace("tool-", ""),
      state: (part.state as string) || "call",
      output: part.output,
      input: part.input,
    };
  }
  return null;
}
