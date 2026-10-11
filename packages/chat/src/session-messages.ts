import type { UIMessage } from "ai";

/** Keep bounded text history; never send rendered source/tool payloads back as
 * evidence. Retain the latest turns even when a long session stays on screen. */
export function sessionModelMessages(messages: UIMessage[]) {
  const selected: Array<{ role: UIMessage["role"]; parts: Array<{ type: "text"; text: string }> }> = [];
  let characters = 0;
  for (const message of [...messages].reverse().slice(0, 24)) {
    const parts = message.parts.flatMap(part => part.type === "text" ? [{ type: "text" as const, text: part.text }] : []);
    const size = parts.reduce((sum, part) => sum + part.text.length, 0);
    if (characters + size > 28_000) break;
    characters += size;
    selected.unshift({ role: message.role, parts });
  }
  if (selected.length > 1 && selected[0].role === "assistant") selected.shift();
  return selected;
}
