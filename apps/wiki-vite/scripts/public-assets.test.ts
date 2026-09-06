import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("reader HTML cannot bypass the gate through Vite public assets", () => {
  const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
  expect([...new Bun.Glob("**/*.{html,htm}").scanSync(publicDirectory)]).toEqual([]);
});
