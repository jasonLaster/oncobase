import type { UIMessage } from "ai";

/** Conversations kept only in this browser, so a reader can come back to one
 * without an account. An index lists them; each transcript has its own key,
 * so saving one turn never rewrites the others. Nothing here reaches a server. */
/** What these helpers use. Writes may throw (quota), which saveChat relies on to evict old chats. */
export type SavedChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SavedChatSummary = { id: string; title: string; updatedAt: number };

const MAX_CHATS = 20;
const MAX_TITLE = 80;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export const isSavedChatId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
export const newSavedChatId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);

const indexKey = (prefix: string) => `${prefix}:saved`;
const chatKey = (prefix: string, id: string) => `${prefix}:saved:${id}`;

export const isChatMessages = (messages: unknown): messages is UIMessage[] => Array.isArray(messages)
  && messages.every((message: UIMessage) => ["user", "assistant"].includes(message?.role) && typeof message.id === "string" && Array.isArray(message.parts));

export function savedChatTitle(messages: UIMessage[]) {
  const first = messages.find(message => message.role === "user");
  const text = first?.parts.flatMap(part => part.type === "text" ? [part.text] : []).join(" ").replace(/\s+/g, " ").trim() ?? "";
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text || "Untitled chat";
}

/** Newest first. A blocked or damaged store reads as empty. */
export function listSavedChats(storage: SavedChatStorage, prefix: string): SavedChatSummary[] {
  try {
    const saved = JSON.parse(storage.getItem(indexKey(prefix)) ?? "null");
    if (saved?.version !== 1 || !Array.isArray(saved.chats)) return [];
    return saved.chats.filter((chat: SavedChatSummary) => isSavedChatId(chat?.id) && typeof chat.title === "string" && typeof chat.updatedAt === "number")
      .sort((a: SavedChatSummary, b: SavedChatSummary) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function loadSavedChat(storage: SavedChatStorage, prefix: string, id: string): UIMessage[] | null {
  if (!isSavedChatId(id)) return null;
  try {
    const saved = JSON.parse(storage.getItem(chatKey(prefix, id)) ?? "null");
    return saved?.version === 1 && isChatMessages(saved.messages) ? saved.messages : null;
  } catch { return null; }
}

const writeIndex = (storage: SavedChatStorage, prefix: string, chats: SavedChatSummary[]) =>
  storage.setItem(indexKey(prefix), JSON.stringify({ version: 1, chats }));

/** Saves a transcript and moves it to the top. When the browser is out of room,
 * the oldest chats go first; if even this one cannot fit, it is not saved. */
export function saveChat(storage: SavedChatStorage, prefix: string, id: string, messages: UIMessage[], now = Date.now()) {
  if (!isSavedChatId(id) || !messages.length) return false;
  let chats = [{ id, title: savedChatTitle(messages), updatedAt: now }, ...listSavedChats(storage, prefix).filter(chat => chat.id !== id)];
  for (const dropped of chats.splice(MAX_CHATS)) try { storage.removeItem(chatKey(prefix, dropped.id)); } catch { /* Already gone. */ }
  const transcript = JSON.stringify({ version: 1, messages });
  for (;;) {
    try {
      storage.setItem(chatKey(prefix, id), transcript);
      writeIndex(storage, prefix, chats);
      return true;
    } catch {
      const oldest = chats.length > 1 ? chats.pop()! : null;
      if (!oldest) {
        try { storage.removeItem(chatKey(prefix, id)); writeIndex(storage, prefix, chats.slice(1)); } catch { /* Storage is unavailable. */ }
        return false;
      }
      try { storage.removeItem(chatKey(prefix, oldest.id)); } catch { /* Storage is unavailable. */ }
    }
  }
}

export function deleteSavedChat(storage: SavedChatStorage, prefix: string, id: string) {
  try {
    storage.removeItem(chatKey(prefix, id));
    writeIndex(storage, prefix, listSavedChats(storage, prefix).filter(chat => chat.id !== id));
  } catch { /* Storage is unavailable. */ }
}
