import { describe, expect, test } from "bun:test";
import {
  CHAT_UNAVAILABLE_CONTENT,
  readChatPageFromDocuments,
  type ChatPageDocumentsGateway,
} from "./chat-tools.ts";

function createDocumentsGateway(
  docs: Array<{
    slug: string;
    title: string;
    content: string;
    tags: string[];
    sensitive?: boolean;
  }>,
): ChatPageDocumentsGateway {
  return {
    async getBySlug({ slug, includeSensitive }) {
      const doc = docs.find((item) => item.slug === slug);
      if (!doc || (doc.sensitive && !includeSensitive)) return null;
      return doc;
    },
  };
}

describe("chat page tools", () => {
  test("returns unavailable metadata for sensitive pages", async () => {
    const result = await readChatPageFromDocuments(
      createDocumentsGateway([
        {
          slug: "private/notes",
          title: "Diana private notes",
          content: "secret",
          tags: ["private"],
          sensitive: true,
        },
      ]),
      "private/notes#follow-up",
    );

    expect(result).toEqual({
      slug: "private/notes",
      title: "Diana private notes",
      href: "/private/notes#follow-up",
      anchor: "follow-up",
      tags: ["private"],
      content: CHAT_UNAVAILABLE_CONTENT,
      linked_pages: [],
      unavailable: true,
      sensitive: true,
    });
  });

  test("redacts content and resolves linked pages", async () => {
    const result = await readChatPageFromDocuments(
      createDocumentsGateway([
        {
          slug: "wiki/plan",
          title: "Diana treatment plan",
          content: "Discuss [[wiki/labs#cbc|labs]] with Diana Laster.",
          tags: ["plan"],
        },
        {
          slug: "wiki/labs",
          title: "Diana labs",
          content: "labs",
          tags: ["labs"],
        },
      ]),
      "wiki/plan",
    );

    expect(result).toMatchObject({
      slug: "wiki/plan",
      title: "Diana treatment plan",
      content: "Discuss [[wiki/labs#cbc|labs]] with the patient.",
      linked_pages: [
        {
          slug: "wiki/labs",
          title: "Diana labs",
          href: "/wiki/labs#cbc",
          anchor: "cbc",
        },
      ],
    });
  });
});
