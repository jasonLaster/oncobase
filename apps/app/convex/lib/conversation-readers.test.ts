// Sensitive-derived chat text lives in `conversations`/`messages`. The only
// code allowed to read those tables is the owner-checked conversations module
// and the operator-only (internal) migrations; no admin, export, download or
// telemetry path may grow a reader without a deliberate change here.
import { expect, test } from "bun:test";

async function sources(directory: string) {
  const files: Array<{ path: string; text: string }> = [];
  for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan(directory)) {
    if (path.includes("_generated") || /\.test\.tsx?$/.test(path) || path.endsWith(".d.ts")) continue;
    files.push({ path: `${directory}/${path}`, text: await Bun.file(`${directory}/${path}`).text() });
  }
  return files;
}

test("only the owner-checked conversations module and internal migrations read the chat tables", async () => {
  const convex = (await sources("convex")).filter(({ text }) => /["'](?:conversations|messages)["']/.test(text)).map(({ path }) => path).sort();
  expect(convex).toEqual(["convex/conversations.ts", "convex/migrations.ts", "convex/schema.ts"]);
  const migrations = await Bun.file("convex/migrations.ts").text();
  expect(migrations).not.toMatch(/\bexport const \w+ = (?:query|mutation|action)\(/);
});

test("server code reaches conversations only through the chat route, which binds every call to an owner", async () => {
  const users = [...(await sources("server")), ...(await sources("scripts"))]
    .filter(({ text }) => /api\.conversations|internal\.conversations/.test(text)).map(({ path }) => path).sort();
  // (The production gate probe only asserts that anonymous/foreign callers are denied.)
  expect(users).toEqual(["scripts/verify-production-backend-gate.ts", "server/chat-route.ts"]);
  const route = await Bun.file("server/chat-route.ts").text();
  const calls = route.match(/api\.conversations\.\w+/g) ?? [];
  expect(calls.length).toBeGreaterThan(0);
  // Every direct call goes through asOwner(...); the flusher binds the rest.
  for (const call of calls.filter((name) => name !== "api.conversations")) {
    const at = route.indexOf(call);
    expect(route.slice(at, at + 160), call).toContain("asOwner(");
  }
  expect(route).toContain("runWrites.mutation(ref, { ...args, ownerKey })");
});
