"use client";

import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { useChatRuntime } from "../runtime";
import { ArchivedChatsCore } from "../components/archived-chats-core";

export function ArchivedChatsClient() {
  const { convexApi, copy, routes, siteSlug } = useChatRuntime();
  const siteArgs = siteSlug ? { siteSlug } : {};
  const archived = useQuery(convexApi.conversations.listArchived, siteArgs);
  const restoreConversation = useMutation(convexApi.conversations.restore);

  async function handleRestore(id: string) {
    await restoreConversation({ id, ...siteArgs });
  }

  return (
    <ArchivedChatsCore
      archived={archived}
      copy={copy}
      onRestore={(conversation) => handleRestore(conversation._id)}
      renderLink={({ href, children, ...linkProps }) => (
        <Link {...linkProps} href={href}>
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}
