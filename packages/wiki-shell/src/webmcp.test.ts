import { afterEach, describe, expect, test } from "bun:test";
import {
  extractMarkdownSection,
  instrumentTool,
  markdownOutline,
  registerWebMcpTools,
  slugifyHeading,
  type WebMcpTool,
} from "./webmcp";

const tool = (name: string, execute: WebMcpTool["execute"] = () => ({ ok: true })): WebMcpTool => ({
  name, description: name, inputSchema: { type: "object" }, execute,
});

const globalDocument = globalThis as { document?: unknown };
afterEach(() => { delete globalDocument.document; });

describe("webmcp core", () => {
  test("registers on document.modelContext and unregisters via the signal", () => {
    const registered = new Map<string, WebMcpTool>();
    globalDocument.document = {
      modelContext: {
        registerTool: (descriptor: WebMcpTool, options: { signal: AbortSignal }) => {
          registered.set(descriptor.name, descriptor);
          options.signal.addEventListener("abort", () => registered.delete(descriptor.name));
          return Promise.resolve();
        },
      },
    };
    const controller = new AbortController();
    const count = registerWebMcpTools([tool("a"), tool("bad name!"), tool("b")], { signal: controller.signal });
    expect(count).toBe(2);
    expect([...registered.keys()]).toEqual(["a", "b"]);
    controller.abort();
    expect(registered.size).toBe(0);
  });

  test("supports legacy registrations that return an unregister handle", () => {
    let unregistered = 0;
    globalDocument.document = { modelContext: { registerTool: () => ({ unregister: () => { unregistered += 1; } }) } };
    const controller = new AbortController();
    registerWebMcpTools([tool("a")], { signal: controller.signal });
    controller.abort();
    expect(unregistered).toBe(1);
  });

  test("is a no-op without the API", () => {
    globalDocument.document = {};
    expect(registerWebMcpTools([tool("a")], { signal: new AbortController().signal })).toBe(0);
  });

  test("instrumentTool turns throws into { error } and reports every call", async () => {
    const calls: Array<{ tool: string; ok: boolean }> = [];
    const failing = instrumentTool(tool("boom", () => { throw new Error("nope"); }), (call) => calls.push(call));
    expect(await failing.execute({}, {})).toEqual({ error: "nope" });
    const soft = instrumentTool(tool("soft", () => ({ error: "bad input" })), (call) => calls.push(call));
    await soft.execute({}, {});
    const fine = instrumentTool(tool("fine"), (call) => calls.push(call));
    await fine.execute({}, {});
    expect(calls.map(({ tool: name, ok }) => [name, ok])).toEqual([["boom", false], ["soft", false], ["fine", true]]);
  });

  test("markdown helpers slice sections and list headings, skipping code fences", () => {
    const markdown = "# Title\n\n## A thing\n\none\n\n```\n# not a heading\n```\n\n### Sub\n\ntwo\n\n## B\n\nthree";
    expect(markdownOutline(markdown).map((item) => item.id)).toEqual(["title", "a-thing", "sub", "b"]);
    expect(extractMarkdownSection(markdown, "a-thing")).toBe("## A thing\n\none\n\n```\n# not a heading\n```\n\n### Sub\n\ntwo");
    expect(extractMarkdownSection(markdown, "B")).toBe("## B\n\nthree");
    expect(extractMarkdownSection(markdown, "missing")).toBeNull();
    expect(slugifyHeading("HER2-low: What's new?")).toBe("her2-low-whats-new");
  });
});
