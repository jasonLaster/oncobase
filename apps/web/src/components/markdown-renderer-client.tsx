"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  WikiMarkdown,
  type WikiMarkdownLinkProps,
  type WikiMarkdownRouteAdapter,
} from "@oncobase/wiki-markdown";
import { toast } from "sonner";
import {
  isInternalChatResponseHref,
  resolveChatResponseHref,
} from "@/lib/chat-response-links";
import { NextWikiImage } from "@/components/image-theater";

function NextMarkdownLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link href={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

/**
 * Client-side markdown renderer for interactive contexts (chat, search)
 * where content streams in and server rendering isn't practical.
 * For static wiki pages, use the server-side MarkdownRenderer instead.
 */
export function MarkdownRendererClient({
  content,
  disableAnchors,
}: {
  content: string;
  disableAnchors?: boolean;
}) {
  const router = useRouter();
  const routeAdapter = useMemo<WikiMarkdownRouteAdapter>(
    () => ({
      push: (href, options) => {
        router.push(href, { scroll: options?.scroll });
      },
    }),
    [router],
  );

  return (
    <WikiMarkdown
      content={content}
      disableAnchors={disableAnchors}
      ImageComponent={NextWikiImage}
      isInternalHref={isInternalChatResponseHref}
      LinkComponent={NextMarkdownLink}
      notification={{
        success: (message) => toast.success(message),
        error: (message) => toast.error(message),
      }}
      routeAdapter={routeAdapter}
      resolveLinkHref={(href) => resolveChatResponseHref(href)}
    />
  );
}
