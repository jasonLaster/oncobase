import { expect, test } from "bun:test";
import {
  loadSensitiveSearchPages,
  overlaySearchPages,
  prepareSearchPage,
  readPublicSearchCorpus,
  redactionConfigurationKey,
  type PublicCorpusCache,
  type SearchablePage,
  type SensitivePageCache,
} from "./search-corpus";

test("prepared search data contains only redacted lines and metadata", () => {
  const result = prepareSearchPage({ slug: "public", title: "Private name", content: 'before <redact fallback="withheld">private detail</redact> after\nline two' }, [{ pattern: /Private name/g, replacement: "Title" }]);
  expect(result).toEqual({ slug: "public", title: "Title", lines: ["before withheld after", "line two"] });
  expect(result).not.toHaveProperty("content");
  expect(JSON.stringify(result)).not.toContain("private detail");
});

test("redaction cache keys distinguish defaults, empty rules, flags and replacements", () => {
  expect(redactionConfigurationKey(undefined)).not.toBe(redactionConfigurationKey([]));
  const base = [{ pattern: /person/g, replacement: "hidden" }];
  expect(redactionConfigurationKey(base)).toBe(redactionConfigurationKey([{ pattern: new RegExp("person", "g"), replacement: "hidden" }]));
  expect(redactionConfigurationKey(base)).not.toBe(redactionConfigurationKey([{ pattern: /person/gi, replacement: "hidden" }]));
  expect(redactionConfigurationKey(base)).not.toBe(redactionConfigurationKey([{ pattern: /person/g, replacement: "changed" }]));
});

const page = (slug: string, text = slug): SearchablePage => ({ slug, title: slug, lines: [text] });

test("public corpus is fresh, then served stale while one background reload replaces it", async () => {
  const cache: PublicCorpusCache = new Map();
  let loads = 0;
  let release: (() => void) | undefined;
  const background: Promise<unknown>[] = [];
  const read = (now: number, redactionKey = "r") => readPublicSearchCorpus({
    cache, key: "site", redactionKey, now, freshMs: 100, maxStaleMs: 1000,
    background: promise => { background.push(promise); },
    load: async previous => {
      const generation = ++loads;
      // A cold read starts from nothing; a refresh receives what it replaces.
      expect(previous?.[0]?.slug).toBe(generation === 1 ? undefined : `v${generation - 1}`);
      if (generation === 2) await new Promise<void>(resolve => { release = resolve; });
      return [page(`v${generation}`)];
    },
  });

  const cold = read(0);
  expect(cold.state).toBe("miss");
  expect(cold.settled).toBe(false);
  // A second reader finds the same load still in flight.
  expect(read(1)).toMatchObject({ state: "fresh", settled: false });
  expect((await cold.pages)[0]!.slug).toBe("v1");
  expect(read(50)).toMatchObject({ state: "fresh", settled: true });
  expect(loads).toBe(1);

  // Expired: the previous corpus is returned at once while the reload is slow.
  const stale = read(200);
  expect(stale).toMatchObject({ state: "stale", settled: true });
  expect((await stale.pages)[0]!.slug).toBe("v1");
  expect(read(210).state).toBe("stale");
  expect(loads).toBe(2);
  release!();
  await Promise.all(background);
  const refreshed = read(250);
  expect(refreshed.state).toBe("fresh");
  expect((await refreshed.pages)[0]!.slug).toBe("v2");

  // A redaction change never serves the old redacted lines.
  expect(read(260, "changed").state).toBe("miss");
  // Beyond the stale bound the reader waits for a full read.
  expect(read(5000, "changed").state).toBe("miss");
});

test("a failed public reload keeps the stale corpus and a failed cold read is not retained", async () => {
  const cache: PublicCorpusCache = new Map();
  let fail = false;
  const background: Promise<unknown>[] = [];
  const read = (now: number) => readPublicSearchCorpus({
    cache, key: "site", redactionKey: "r", now, freshMs: 100, maxStaleMs: 1000,
    background: promise => { background.push(promise); },
    load: async () => { if (fail) throw new Error("unavailable"); return [page("v")]; },
  });
  await read(0).pages;
  fail = true;
  await read(200).pages;
  await Promise.all(background);
  expect(read(300).state).toBe("stale");
  cache.clear();
  await expect(read(0).pages).rejects.toThrow("unavailable");
  expect(cache.size).toBe(0);
});

test("sensitive pages fetch only authorized slugs, bounded, and reuse content by hash", async () => {
  const cache: SensitivePageCache = new Map();
  const fetched: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const hashes = new Map(Array.from({ length: 10 }, (_, index) => [`private/${index}`, "h1"]));
  const fetchPage = async (slug: string) => {
    fetched.push(slug);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await Bun.sleep(1);
    inFlight--;
    return { slug, title: slug, content: `Secret 123 ${slug}`, contentHash: hashes.get(slug)!, sensitive: true };
  };
  const patterns = [{ pattern: /123/g, replacement: "[n]" }];
  const allowed = () => [...hashes].map(([slug, contentHash]) => ({ slug, contentHash }));

  const first = await loadSensitiveSearchPages({ allowed: allowed(), fetchPage, patterns, cache, concurrency: 3 });
  expect(first.pages).toHaveLength(10);
  expect(first.pages[0]!.lines[0]).toBe("Secret [n] private/0");
  expect(maxInFlight).toBe(3);
  expect(fetched).toHaveLength(10);

  // Another reader authorized for only two of the pages: served from cache.
  const second = await loadSensitiveSearchPages({ allowed: allowed().slice(0, 2), fetchPage, patterns, cache });
  expect(second.pages.map(result => result.slug)).toEqual(["private/0", "private/1"]);
  expect(second.hits).toBe(2);
  expect(fetched).toHaveLength(10);

  // Changed content or redaction configuration re-reads the page.
  hashes.set("private/0", "h2");
  await loadSensitiveSearchPages({ allowed: allowed().slice(0, 1), fetchPage, patterns, cache });
  await loadSensitiveSearchPages({ allowed: allowed().slice(1, 2), fetchPage, patterns: [], cache });
  expect(fetched.slice(10)).toEqual(["private/0", "private/1"]);

  // Pages without a content hash are never cached; deleted pages are omitted.
  const uncached = await loadSensitiveSearchPages({
    allowed: [{ slug: "nohash", contentHash: null }, { slug: "gone", contentHash: "h" }],
    fetchPage: async slug => (slug === "gone" ? null : { slug, title: slug, content: "x" }),
    patterns, cache,
  });
  expect(uncached.pages.map(result => result.slug)).toEqual(["nohash"]);
  expect(cache.has("nohash")).toBe(false);
});

test("authorized pages overlay the public corpus in slug order", () => {
  expect(overlaySearchPages([page("a"), page("c", "public copy")], [page("b"), page("c", "private copy")]))
    .toEqual([page("a"), page("b"), page("c", "private copy")]);
});
