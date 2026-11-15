import type { Page } from "@playwright/test";

// WebMCP (document.modelContext) is an origin-trial API; stub it so the
// app's real registration and tool code run in any browser.
export async function installModelContextStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (input: unknown, options: unknown) => unknown }>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; execute: (input: unknown, options: unknown) => unknown }, options: { signal?: AbortSignal } = {}) {
          if (tools.has(tool.name)) throw new DOMException(`Duplicate tool ${tool.name}`, "InvalidStateError");
          tools.set(tool.name, tool);
          options.signal?.addEventListener("abort", () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); });
          return Promise.resolve();
        },
      },
    });
    (window as unknown as { __webmcp: unknown }).__webmcp = {
      names: () => [...tools.keys()].sort(),
      call: async (name: string, input: unknown = {}) => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`No tool ${name}`);
        return JSON.parse(JSON.stringify(await tool.execute(input, { signal: new AbortController().signal })));
      },
    };
  });
}

export type ToolResult = Record<string, any>;
export const callTool = (page: Page, name: string, input: Record<string, unknown> = {}) =>
  page.evaluate(([tool, args]) => (window as unknown as { __webmcp: { call: (n: string, i: unknown) => Promise<ToolResult> } }).__webmcp.call(tool, args), [name, input] as const);
export const toolNames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __webmcp: { names: () => string[] } }).__webmcp.names());
