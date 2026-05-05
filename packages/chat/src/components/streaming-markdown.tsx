"use client";

/**
 * Generic streaming-aware markdown renderer for chat assistant messages.
 *
 * Host apps can provide a richer renderer through <ChatRuntimeProvider>.
 * This default intentionally has no host-specific markdown transforms.
 */

import { Streamdown } from "streamdown";
import type { ChatMarkdownRendererProps } from "../types";

export function StreamingMarkdown({
  content,
  disableAnchors,
  isStreaming = false,
}: ChatMarkdownRendererProps) {
  return (
    <div className="prose min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        caret={isStreaming ? "block" : undefined}
        skipHtml
        controls={false}
        parseIncompleteMarkdown={isStreaming}
      >
        {content}
      </Streamdown>
    </div>
  );
}
