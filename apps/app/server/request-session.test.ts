import { expect, test } from "bun:test";
import { getSessionUser } from "./wiki-api";

const request = () => new Request("https://example.test/private/plan", {
  headers: { Cookie: "wiki_user_session=fixture-session" },
});

test("session verification is shared only within a request and site", async () => {
  let reads = 0;
  let user: { _id: string; email: string } | null = { _id: "reader", email: "reader@example.test" };
  const client = { query: async () => { reads++; return user; } };
  const first = request();
  const results = await Promise.all([getSessionUser(first, client as never, "one"), getSessionUser(first, client as never, "one")]);
  expect(results.map(value => String(value?._id))).toEqual(["reader", "reader"]);
  expect(reads).toBe(1);
  await getSessionUser(first, client as never, "two");
  expect(reads).toBe(2);
  user = null;
  expect(await getSessionUser(request(), client as never, "one")).toBeNull();
  expect(reads).toBe(3);
});

test("a failed lookup is not reused by the next request", async () => {
  let reads = 0;
  const client = { query: async () => { reads++; throw new Error("Session backend unavailable"); } };
  const first = request();
  for (const incoming of [first, first, request()]) {
    await expect(getSessionUser(incoming, client as never, "one")).rejects.toThrow("Session backend unavailable");
  }
  expect(reads).toBe(2);
});
