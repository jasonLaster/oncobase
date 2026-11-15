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
});

test("the vault has the shape the scenarios rely on", () => {
  const { files, stats } = buildVault();
  expect(stats.pages).toBe(2312);
  expect(stats.largePage).toEqual({ slug: PAGES.large, bytes: 278_718, tables: 30 });
  const slugs = new Set(files.map((f) => f.file.replace(/\.md$/, "")));
  for (const slug of [PAGES.article, PAGES.large, PAGES.largeNeighbour, ...PAGES.small]) expect(slugs.has(slug)).toBe(true);
  for (const bytes of stats.smallPageBytes) expect(bytes).toBeLessThan(12_000);
});
