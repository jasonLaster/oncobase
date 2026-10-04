import { expect, test } from "bun:test";
import { createManifestBuildRequester } from "./manifest-build-requests";

test("snapshot build requests run in the background, throttled per site", async () => {
  let clock = 1_000;
  const background: Promise<unknown>[] = [];
  const warnings: unknown[] = [];
  const request = createManifestBuildRequester({ intervalMs: 10_000, now: () => clock, background: promise => { background.push(promise); }, logger: { warn: (...args: unknown[]) => { warnings.push(args); } } });
  const calls: string[] = [];
  let release!: () => void;
  const never = new Promise<void>(resolve => { release = resolve; });
  expect(request("alpha", async () => { calls.push("alpha"); await never; })).toBe(true);
  expect(request("alpha", async () => { calls.push("alpha-again"); })).toBe(false);
  expect(request("beta", async () => { calls.push("beta"); throw new Error("fixture outage"); })).toBe(true);
  clock += 10_000;
  expect(request("alpha", async () => { calls.push("alpha-later"); })).toBe(true);
  expect(background).toHaveLength(3); // Each accepted request is kept alive past the response.
  release();
  await Promise.all(background);
  expect(calls).toEqual(["alpha", "beta", "alpha-later"]);
  expect(warnings).toHaveLength(1); // A failed request is logged, never thrown into the reader.
});

test("a missing or throwing background hook still runs the request", async () => {
  let ran = false;
  const request = createManifestBuildRequester({ background: () => { throw new Error("no request context"); } });
  request("alpha", async () => { ran = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(ran).toBe(true);
});
