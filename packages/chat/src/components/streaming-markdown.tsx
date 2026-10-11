"use client";

/**
 * Generic streaming-aware markdown renderer for chat assistant messages.
 *
 * Host apps can provide a richer renderer through <ChatRuntimeProvider>.
 * This default intentionally has no host-specific markdown transforms.
 */

import { Streamdown, type Components } from "streamdown";
import { useMemo, type ComponentType, type ComponentProps } from "react";
import type { ChatMarkdownRendererProps } from "../types";

export function StreamingMarkdown({
  content,
  disableAnchors,
  isStreaming = false,
  LinkComponent,
}: ChatMarkdownRendererProps & { LinkComponent?: ComponentType<ComponentProps<"a">> }) {
  const components = useMemo<Components | undefined>(() => LinkComponent ? { a: props => <LinkComponent {...(props as ComponentProps<"a">)} /> } : undefined, [LinkComponent]);
  return (
    <div className="prose min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        caret={isStreaming ? "block" : undefined}
        skipHtml
        controls={false}
        parseIncompleteMarkdown={isStreaming}
        components={components}
      >
        {content}
      </Streamdown>
    </div>
  );
}
