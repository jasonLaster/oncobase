import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatComposer } from "./chat-composer";
import { ConversationActionsMenu } from "./conversation-actions-core";
import { HintButton } from "./hint-button";
import { SessionChat } from "./session-chat";

const noop = () => {};

// Each opening tag of `name` in the markup, as its attributes.
function tags(html: string, name: string) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "g"))].map(([, attrs]) =>
    Object.fromEntries([...attrs!.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? ""])),
  );
}

function composer(status: "ready" | "streaming", value = "") {
  return renderToStaticMarkup(
    <ChatComposer value={value} onValueChange={noop} onSubmit={noop} onStop={noop} status={status} placeholder="Ask a question..." />,
  );
}

describe("chat composer", () => {
  test("names the textarea and disables Submit until there is text", () => {
    const empty = composer("ready");
    expect(tags(empty, "form")[0]).toMatchObject({ "data-test-id": "chat-composer" });
    expect(empty).toContain(">Message</label>");
    expect(tags(empty, "textarea")[0]).toMatchObject({ name: "message", placeholder: "Ask a question..." });
    expect(tags(empty, "button")).toEqual([expect.objectContaining({ type: "submit", "aria-label": "Submit", disabled: "" })]);
    expect(tags(composer("ready", "hi"), "button")[0]).not.toHaveProperty("disabled");
  });

  test("while a reply streams, the button is a type=button named Stop", () => {
    const html = composer("streaming");
    expect(tags(html, "button")).toEqual([expect.objectContaining({ type: "button", "aria-label": "Stop" })]);
  });
});

describe("session chat composer keeps the OncoGuide WebMCP contract", () => {
  test("textarea#learning-question sits in a form with a submit button and a visible label", () => {
    const html = renderToStaticMarkup(
      <SessionChat apiPath="/api/chat" title="Learn" description="Ask" suggestions={["What is DNA?"]} />,
    );
    const form = html.slice(html.indexOf('<form class="session-chat-composer"'));
    expect(tags(form, "textarea")[0]).toMatchObject({ id: "learning-question" });
    expect(tags(form, "button")).toContainEqual(expect.objectContaining({ type: "submit", "aria-label": "Ask" }));
    expect(form).toContain(">Your question</label>");
    expect(tags(html, "div")).toContainEqual(expect.objectContaining({ role: "log", "aria-label": "Learning conversation", "aria-live": "polite", "aria-relevant": "additions" }));
    expect(tags(html, "button")).toContainEqual(expect.objectContaining({ "aria-label": "Scroll to latest reply", hidden: "" }));
  });
});

describe("conversation actions", () => {
  test("the kebab is a named menu trigger", () => {
    const html = renderToStaticMarkup(<ConversationActionsMenu onArchive={noop} onCopyUrl={noop} />);
    expect(tags(html, "button")[0]).toMatchObject({ "aria-label": "Conversation actions", "aria-haspopup": "menu", "aria-expanded": "false" });
  });
});

describe("hint button", () => {
  test("keeps its own name and renders the hint as a tooltip", () => {
    const html = renderToStaticMarkup(<HintButton hint="Regenerate this response" aria-label="Regenerate response">Regenerate</HintButton>);
    expect(tags(html, "button")[0]).toMatchObject({ type: "button", "aria-label": "Regenerate response" });
    expect(tags(html, "div")).toContainEqual(expect.objectContaining({ role: "tooltip" }));
    expect(html).toContain(">Regenerate this response</div>");
  });
});
