import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { detailItems, features, groups, interfaces, renderFeaturesMd, renderLlmsTxt } from "./features-data";

const publicFile = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");

describe("features data", () => {
  test("every feature belongs to a known group and has a summary", () => {
    const ids = new Set(groups.map((group) => group.id));
    for (const feature of features) {
      expect(ids.has(feature.group), feature.name).toBe(true);
      expect(feature.summary.length, feature.name).toBeGreaterThan(20);
    }
    expect(new Set(features.map((feature) => feature.name)).size).toBe(features.length);
    for (const group of groups) expect(features.some((feature) => feature.group === group.id), group.id).toBe(true);
  });

  test("the agent-readable files match the data (run bun scripts/build-llms-txt.ts)", () => {
    expect(publicFile("llms.txt")).toBe(renderLlmsTxt());
    expect(publicFile("features.md")).toBe(renderFeaturesMd());
  });

  test("features.md lists every feature, interface, and detail", () => {
    const full = renderFeaturesMd();
    for (const feature of features) expect(full).toContain(feature.name);
    for (const item of interfaces) expect(full).toContain(item.name);
    for (const item of detailItems) expect(full).toContain(item.title);
  });
});
