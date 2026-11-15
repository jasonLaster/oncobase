import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { deleteSavedChat, isSavedChatId, listSavedChats, loadSavedChat, newSavedChatId, saveChat, savedChatTitle } from "./saved-chats";

class MemoryStorage implements Storage {
  items = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) {
    const used = [...this.items].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), 0);
    if (used + value.length > this.quota) throw new DOMException("Full", "QuotaExceededError");
    this.items.set(key, value);
  }
}
const chat = (question: string, answer = "An answer"): UIMessage[] => [
  { id: "u", role: "user", parts: [{ type: "text", text: question }] },
  { id: "a", role: "assistant", parts: [{ type: "text", text: answer }] },
];
const ids = Array.from({ length: 25 }, (_, i) => `chat${String(i).padStart(6, "0")}`);

describe("saved chats", () => {
  test("new IDs are URL-safe and validated", () => {
    expect(isSavedChatId(newSavedChatId())).toBe(true);
    for (const bad of ["", "short", "../../etc", "a".repeat(65), "has space1", 7]) expect(isSavedChatId(bad)).toBe(false);
  });

  test("saves, lists newest first and reopens transcripts", () => {
    const storage = new MemoryStorage();
    saveChat(storage, "k", ids[0], chat("What is ctDNA?"), 1);
    saveChat(storage, "k", ids[1], chat("How do vaccines work?"), 2);
    saveChat(storage, "k", ids[0], [...chat("What is ctDNA?"), ...chat("And MRD?")], 3);
    expect(listSavedChats(storage, "k").map(row => [row.id, row.title, row.updatedAt])).toEqual([[ids[0], "What is ctDNA?", 3], [ids[1], "How do vaccines work?", 2]]);
    expect(loadSavedChat(storage, "k", ids[0])).toHaveLength(4);
    expect(loadSavedChat(storage, "other", ids[0])).toBeNull();
  });

  test("deleting removes the transcript and the listing", () => {
    const storage = new MemoryStorage();
    saveChat(storage, "k", ids[0], chat("One"));
    saveChat(storage, "k", ids[1], chat("Two"));
    deleteSavedChat(storage, "k", ids[0]);
    expect(listSavedChats(storage, "k").map(row => row.id)).toEqual([ids[1]]);
    expect(loadSavedChat(storage, "k", ids[0])).toBeNull();
  });

  test("keeps the newest twenty and drops the oldest when the browser is full", () => {
    const storage = new MemoryStorage();
    ids.forEach((id, i) => saveChat(storage, "k", id, chat(`Q${i}`), i));
    expect(listSavedChats(storage, "k")).toHaveLength(20);
    expect(loadSavedChat(storage, "k", ids[0])).toBeNull();
    expect([...storage.items.keys()].filter(key => key.startsWith("k:saved:"))).toHaveLength(20);

    const small = new MemoryStorage(1200);
    for (let i = 0; i < 6; i++) expect(saveChat(small, "k", ids[i], chat(`Q${i}`, "x".repeat(300)), i)).toBe(true);
    const kept = listSavedChats(small, "k").map(row => row.id);
    expect(kept[0]).toBe(ids[5]);
    expect(kept).not.toContain(ids[0]);
    expect(saveChat(small, "k", ids[6], chat("Huge", "x".repeat(5000)), 9)).toBe(false);
    expect(listSavedChats(small, "k").map(row => row.id)).not.toContain(ids[6]);
  });

  test("damaged storage reads as empty and titles are trimmed", () => {
    const storage = new MemoryStorage();
    storage.setItem("k:saved", "{not json");
    storage.setItem(`k:saved:${ids[0]}`, JSON.stringify({ version: 1, messages: [{ role: "system" }] }));
    expect(listSavedChats(storage, "k")).toEqual([]);
    expect(loadSavedChat(storage, "k", ids[0])).toBeNull();
    expect(savedChatTitle(chat(`  ${"word ".repeat(40)}`)).length).toBeLessThanOrEqual(80);
    expect(savedChatTitle([])).toBe("Untitled chat");
  });
});
