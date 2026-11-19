import { expect, test } from "bun:test";
import { entryChunkName, exactName } from "./bundle-entry";

const chunks = [
  { name: "index-Cp8y3eqz.js", source: () => 'window.addEventListener("vite:preloadError",()=>{})' },
  // swr's dist/index/index.mjs: same name shape, not the entry.
  { name: "index-CyiBkCtm.js", source: () => "export{useSWR}" },
];

test("the entry comes from the document's module script", () => {
  expect(entryChunkName('<script type="module" crossorigin src="/assets/index-Cp8y3eqz.js"></script>', chunks)).toBe("index-Cp8y3eqz.js");
});

test("without index.html, the one index chunk with the preload recovery is the entry", () => {
  expect(entryChunkName(null, chunks)).toBe("index-Cp8y3eqz.js");
});

test("without index.html, an index facade over the chunk with the preload recovery is the entry", () => {
  const facade = [
    { name: "index-DcAn2fa6.js", source: () => 'import{t as e}from"./app-B4JuHUCf.js";e();' },
    { name: "app-B4JuHUCf.js", source: () => "window.addEventListener(`vite:preloadError`,()=>{})" },
    // The preload helper dispatches the event; it is not the recovery.
    { name: "preload-helper-CmT4b5Rb.js", source: () => "new Event(`vite:preloadError`,{cancelable:!0})" },
    chunks[1]!,
  ];
  expect(entryChunkName(null, facade)).toBe("index-DcAn2fa6.js");
});

test("an ambiguous or missing entry fails loudly", () => {
  expect(() => entryChunkName(null, [chunks[1]!])).toThrow("none");
  expect(() => entryChunkName(null, [chunks[0]!, { ...chunks[0]!, name: "index-other.js" }])).toThrow("index-Cp8y3eqz.js, index-other.js");
});

test("exact names match only themselves", () => {
  expect(exactName("index-Cp8y3eqz.js").test("index-Cp8y3eqz.js")).toBe(true);
  expect(exactName("index-Cp8y3eqz.js").test("index-Cp8y3eqzXjs")).toBe(false);
});
