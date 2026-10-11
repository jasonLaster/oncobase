import { expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { sessionModelMessages } from "./session-messages";
test("keeps the latest bounded turns and removes client-supplied source payloads", () => {
  const messages = Array.from({ length: 40 }, (_, index): UIMessage => ({ id: String(index), role: index % 2 ? "user" : "assistant", parts: [{ type: "text", text: `${index}: ${"x".repeat(2000)}` }, { type: "data-education", data: { sources: "not evidence" } }] }));
  const selected = sessionModelMessages(messages);
  expect(selected.at(-1)?.parts[0].text).toContain("39:");
  expect(selected[0].role).toBe("user");
  expect(selected.length).toBeLessThanOrEqual(24);
  expect(JSON.stringify(selected)).not.toContain("not evidence");
  expect(selected.reduce((sum, message) => sum + message.parts[0].text.length, 0)).toBeLessThanOrEqual(28_000);
});
