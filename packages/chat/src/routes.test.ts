import { describe, expect, test } from "bun:test";
import { createChatRoutes } from "./routes";

describe("createChatRoutes", () => {
  test("builds default chat paths", () => {
    const routes = createChatRoutes();

    expect(routes.basePath).toBe("/chat");
    expect(routes.newChatPath).toBe("/chat");
    expect(routes.archivedPath).toBe("/chat/archived");
    expect(routes.conversationPath("abc123")).toBe("/chat/abc123");
    expect(routes.conversationUrl("abc123", "https://example.com/")).toBe(
      "https://example.com/chat/abc123"
    );
    expect(routes.matchConversationId("/chat/abc123")).toBe("abc123");
    expect(routes.matchConversationId("/chat/archived")).toBeNull();
    expect(routes.matchConversationId("/chat")).toBeNull();
  });

  test("supports a host-defined base path", () => {
    const routes = createChatRoutes({ basePath: "/assistant" });

    expect(routes.newChatPath).toBe("/assistant");
    expect(routes.archivedPath).toBe("/assistant/archived");
    expect(routes.conversationPath("conv-1")).toBe("/assistant/conv-1");
    expect(routes.matchConversationId("/assistant/conv-1?debug=1")).toBe(
      "conv-1"
    );
    expect(routes.isNewChatPath("/assistant/")).toBe(true);
    expect(routes.isArchivedPath("/assistant/archived")).toBe(true);
  });

  test("honors fully custom route functions", () => {
    const routes = createChatRoutes({
      basePath: "/threads",
      newChatPath: "/threads/new",
      archivedPath: "/threads/archive",
      conversationPath: (id) => `/threads/view/${id}`,
      conversationUrl: (id, origin) => `${origin}/share/${id}`,
      matchConversationId: (pathname) =>
        pathname.startsWith("/threads/view/")
          ? pathname.replace("/threads/view/", "")
          : null,
    });

    expect(routes.newChatPath).toBe("/threads/new");
    expect(routes.archivedPath).toBe("/threads/archive");
    expect(routes.conversationPath("abc")).toBe("/threads/view/abc");
    expect(routes.conversationUrl("abc", "https://example.com")).toBe(
      "https://example.com/share/abc"
    );
    expect(routes.matchConversationId("/threads/view/abc")).toBe("abc");
  });
});
