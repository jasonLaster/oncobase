import { expect, test } from "bun:test";
import { canReadEducationAsset, educationDocumentsGateway, isEducationSlug, isPublicEducationAsset, isPublicEducationPage } from "./education-access";
import { isEducationPathname } from "../src/education-access";
import type { WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";

test("curriculum scope rejects adjacent prefixes and traversal", () => {
  for (const slug of ["wiki/education", "wiki/education/index", "Wiki/Education/Oncology 101/index"]) expect(isEducationSlug(slug)).toBe(true);
  for (const slug of ["wiki/education-private/index", "wiki/care/index", "wiki/education/../care", "wiki/education//index",
    "wiki/education/%2e%2e/index", "wiki/education/\\care", "/wiki/education/index"]) expect(isEducationSlug(slug)).toBe(false);
  expect(isEducationPathname("/wiki/education/oncology-101/index.md")).toBe(true);
  expect(isEducationPathname("/wiki/education/%252e%252e/care")).toBe(false);
  expect(isEducationPathname("/wiki/education/%zz")).toBe(false);
});

test("shared education illustrations require explicitly public wiki owners", async () => {
  const asset = { path: "wiki/education/images/shared.png", sensitive: false,
    ownerSlugs: ["wiki/education/index", "wiki/updates/week-13"] };
  expect(await canReadEducationAsset(asset, async () => ({ sensitive: false }))).toBe(true);
  for (const owner of [null, {}, { sensitive: true }]) {
    expect(await canReadEducationAsset(asset, async () => owner)).toBe(false);
  }
  expect(await canReadEducationAsset(asset, async () => { throw Error("Unavailable"); })).toBe(false);
  expect(await canReadEducationAsset({ ...asset, sensitive: true }, async () => ({ sensitive: false }))).toBe(false);
  expect(await canReadEducationAsset({ ...asset, ownerSlugs: ["wiki/updates/week-13"] }, async () => ({ sensitive: false }))).toBe(false);
});

test("public education requires explicit sensitivity and complete scoped ownership", () => {
  const slug = "wiki/education/index";
  expect(isPublicEducationPage({ slug, sensitive: false })).toBe(true);
  expect(isPublicEducationPage({ slug })).toBe(false);
  expect(isPublicEducationPage({ slug, sensitive: true })).toBe(false);
  const asset = { path: "wiki/education/cartoon.png", sensitive: false, ownerSlugs: [slug] };
  expect(isPublicEducationAsset(asset)).toBe(true);
  for (const patch of [{ sensitive: true }, { sensitive: undefined }, { ownerSlugs: undefined }, { ownerSlugs: [] },
    { ownerSlugs: [slug, "wiki/care/index"] }, { path: "sources/clinical/scan.png" }]) {
    expect(isPublicEducationAsset({ ...asset, ...patch })).toBe(false);
  }
});

test("filtered batches preserve pagination and never request sensitive documents", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const documents = { listManifestPage: async (args: Record<string, unknown>) => {
    calls.push(args);
    return args.cursor === null
      ? { page: [{ slug: "wiki/care/index", sensitive: false }], isDone: false, continueCursor: "next" }
      : { page: [{ slug: "wiki/education/index", sensitive: false }], isDone: true, continueCursor: null };
  }, getBySlug: async (args: Record<string, unknown>) => { calls.push(args); return { slug: String(args.slug), sensitive: true }; } };
  const gateway = educationDocumentsGateway(documents as unknown as WikiApiDocumentsGateway);
  const first = await gateway.listManifestPage({ cursor: null, numItems: 100, includeSensitive: true });
  expect(first).toEqual({ page: [], isDone: false, continueCursor: "next" });
  const second = await gateway.listManifestPage({ cursor: first.continueCursor, numItems: 100, includeSensitive: true });
  expect(second.page.map(page => page.slug)).toEqual(["wiki/education/index"]);
  expect(await gateway.getBySlug({ slug: "wiki/education/private-case", includeSensitive: true })).toBeNull();
  const before = calls.length;
  expect(await gateway.getBySlug({ slug: "wiki/care/index" })).toBeNull();
  expect(calls).toHaveLength(before);
  expect(calls.every(call => call.includeSensitive === false)).toBe(true);
});
