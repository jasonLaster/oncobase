import {
  CHAT_UNAVAILABLE_CONTENT,
  readChatPageFromDocuments,
  type ChatReadPageResult,
} from "@oncobase/wiki-content/chat-tools";
import type { SiteData } from "@/lib/site-data";

export { CHAT_UNAVAILABLE_CONTENT, type ChatReadPageResult };

export function readChatPage(
  siteData: SiteData,
  slug: string,
): Promise<ChatReadPageResult> {
  return readChatPageFromDocuments(siteData.documents, slug);
}
