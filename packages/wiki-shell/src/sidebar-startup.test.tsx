import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResizableLayout } from "./resizable-layout.tsx";
import { installSidebarStartupState, SIDEBAR_MAX_WIDTH, SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_WIDTH_VARIABLE } from "./sidebar-startup.ts";

type FakeRoot = { dataset: Record<string, string>; style: { values: Record<string, string>; setProperty(name: string, value: string): void } };

function run(stored: string | null, { blocked = false } = {}) {
  const root: FakeRoot = { dataset: {}, style: { values: {}, setProperty(name, value) { this.values[name] = value; } } };
  const g = globalThis as Record<string, unknown>;
  g.window = { localStorage: { getItem: (key: string) => {
    if (blocked) throw new Error("SecurityError");
    return key === "sidebar-width" ? stored : null;
  } } };
  g.document = { documentElement: root };
  installSidebarStartupState();
  return root;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

test("a saved width sets the rail variable and the expanded state", () => {
  const root = run("360");
  expect(root.dataset.initialSidebarState).toBe("expanded");
  expect(root.style.values["--wiki-sidebar-width"]).toBe("360px");
});

test("a collapsed sidebar sets the collapsed state and keeps the default width", () => {
  const root = run("0");
  expect(root.dataset.initialSidebarState).toBe("collapsed");
  expect(root.style.values).toEqual({});
});

test("nothing saved, an invalid value or blocked storage changes nothing", () => {
  for (const root of [run(null), run("abc"), run("-1"), run("481"), run("300", { blocked: true })]) {
    expect(root.dataset).toEqual({});
    expect(root.style.values).toEqual({});
  }
});

test("the serialized script names the same key, limit and variable as the layout", () => {
  const source = installSidebarStartupState.toString();
  expect(source).toContain(`"${SIDEBAR_WIDTH_STORAGE_KEY}"`);
  expect(source).toContain(`"${SIDEBAR_WIDTH_VARIABLE}"`);
  expect(source).toContain(String(SIDEBAR_MAX_WIDTH));
});

test("the layout's markup carries no per-user width", () => {
  const html = renderToStaticMarkup(<ResizableLayout sidebar={<nav />}><main /></ResizableLayout>);
  // The default size only: styles.css points the panel's size at the variable until the group attaches.
  expect(html).toMatch(/data-sidebar-expanded-rail="true"[^>]*style="flex:0 1 var\(--resizable-panel-size, 256px\)/);
  expect(html).toMatch(/aria-label="Resize sidebar"[^>]*role="separator"/);
});
