import { expect, test } from "bun:test";
import { canPrefetch, planPrefetch, PREFETCH_LIMITS, type CachedPage } from "./prefetch-policy";
const page = (slug: string, size = 100) => ({ slug, size, contentHash: "new" });
const cached = (slug: string, size = 100): CachedPage => ({ ...page(slug, size), fetchedAt: 1, contentStatus: "fresh" });

test("prefetch yields to offline, hidden, saving-data, slow networks, pressure and input", () => {
  const healthy = { online: true, visible: true };
  expect(canPrefetch(healthy)).toBe(true);
  for (const constraint of [{ online: false }, { visible: false }, { saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }, { pressure: 0.8 }, { inputPending: true }]) expect(canPrefetch({ ...healthy, ...constraint })).toBe(false);
});

test("current and recent pages precede global ranking, with 150-page and byte caps", () => {
  const index = Array.from({ length: 250 }, (_, i) => page(`p${i}`));
  const result = planPrefetch({ activeSlug: "p249", recent: ["p248"], ranked: index.map(p => p.slug), index, cached: [cached("p249")] });
  expect(result.queue[0]).toBe("p248");
  expect(result.queue).toHaveLength(149);
  expect(result.queue).not.toContain("p249");
  expect(result.evict).toEqual([]);
  const large = page("large", PREFETCH_LIMITS.bytes);
  expect(planPrefetch({ activeSlug: "p249", recent: [], ranked: ["large"], index: [...index, large], cached: [cached("p249")] }).queue).toEqual([]);
});

test("current body is retained even over budget; obsolete bodies are evicted without touching metadata", () => {
  const result = planPrefetch({ activeSlug: "current", recent: [], ranked: ["other"], index: [page("current"), page("other")], cached: [cached("current", PREFETCH_LIMITS.bytes + 1), cached("deleted"), cached("other")] });
  expect(result.evict).toEqual(["deleted", "other"]);
  expect(result.queue).toEqual([]);
});

test("only missing or changed bodies are fetched; unknown and denied pages are excluded", () => {
  const index = [page("current"), page("fresh"), page("stale"), page("missing"), page("denied")];
  const result = planPrefetch({ activeSlug: "current", recent: [], ranked: ["fresh", "stale", "missing", "denied", "unknown"], index, cached: [cached("fresh"), { ...cached("stale"), contentStatus: "stale" }, { ...cached("denied"), contentStatus: "sensitive-unavailable" }] });
  expect(result.queue).toEqual(["stale", "missing"]);
});
