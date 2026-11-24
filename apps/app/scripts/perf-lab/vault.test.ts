import { expect, test } from "bun:test";
import { buildVault, PAGES } from "./vault";

// Pinned so a change to the synthetic vault is deliberate: it moves every number.
const VAULT_FINGERPRINT = "0b70083febc368e7";

test("the synthetic vault is deterministic", () => {
  const a = buildVault();
  const b = buildVault();
  expect(a.stats.fingerprint).toBe(b.stats.fingerprint);
  expect(a.stats.fingerprint).toBe(VAULT_FINGERPRINT);
  expect(buildVault(7).stats.fingerprint).not.toBe(VAULT_FINGERPRINT);
  expect(a.stats.assets).toBe(0);
}, 30_000);

test("the vault has the shape the scenarios rely on", () => {
  const { files, stats } = buildVault();
  expect(stats.pages).toBe(2312);
  expect(stats.largePage).toEqual({ slug: PAGES.large, bytes: 278_718, tables: 30 });
  const slugs = new Set(files.map((f) => f.file.replace(/\.md$/, "")));
  for (const slug of [PAGES.article, PAGES.large, PAGES.largeNeighbour, ...PAGES.small]) expect(slugs.has(slug)).toBe(true);
  for (const bytes of stats.smallPageBytes) expect(bytes).toBeLessThan(12_000);
});

// The production-shaped vault (O0 in plans/2026-11-23-opportunities-and-analytics.md).
const PROD_VAULT_FINGERPRINT = "5262b14ea73c90e7";

test("the prod-scale vault matches production's shape and keeps the lab pages", () => {
  const { files, assets, stats } = buildVault(42, "prod");
  expect(stats.fingerprint).toBe(PROD_VAULT_FINGERPRINT);
  expect(stats.pages).toBe(8746);
  expect(stats.assets).toBe(14_431);
  const slugs = new Set(files.map((f) => f.file.replace(/\.md$/, "")));
  for (const slug of [PAGES.article, PAGES.large, PAGES.largeNeighbour, ...PAGES.small]) expect(slugs.has(slug)).toBe(true);
  expect(stats.largePage.tables).toBe(30);
  // One folder dominates, as in production.
  expect(files.filter((f) => f.file.startsWith("sources/library/c0-")).length).toBe(4500);
  expect(assets.filter((f) => f.file.endsWith(".jpg")).length).toBeGreaterThan(10_000);
}, 60_000);
