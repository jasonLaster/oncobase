import { beforeEach, describe, expect, test } from "bun:test";

const KEY = "wiki-vite-expanded-directories";

describe("revealDirectories", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Object.assign(globalThis, {
      localStorage,
      window: { localStorage, location: { search: "" }, addEventListener() {}, removeEventListener() {} },
    });
  });

  test("reopens explicitly collapsed ancestors and leaves other choices alone", async () => {
    const { toggleDirectory, revealDirectories } = await import(`./tree-expansion?${Math.random()}`);
    toggleDirectory("sources", false);
    toggleDirectory("sources/diagnostics", false);
    toggleDirectory("wiki", false);
    revealDirectories(["sources", "sources/diagnostics", "sources/other"]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      wiki: false,
      sources: true,
      "sources/diagnostics": true,
    });
  });
});

describe("expandedDirectorySlugs", () => {
  test("lists opened choices and the active ancestors the reader did not collapse", async () => {
    const { expandedDirectorySlugs } = await import(`./tree-expansion?${Math.random()}`);
    const choices = new Map([["wiki", true], ["sources", false], ["notes", true], ["archive", false]]);
    expect(expandedDirectorySlugs(choices, ["sources", "sources/diagnostics", "wiki"])).toEqual(["wiki", "notes", "sources/diagnostics"]);
  });
});
