import { describe, expect, test } from "bun:test";
import { isReaderAppRoute } from "../../reader-app-routes";
import { rootRouteFor } from "../../root-route";
import { pageAccess } from "./tool-access";
import { DIANA_TOOLS, groupTools, toolAvailability, toolsForBrand, type ToolEntry } from "./tools-config";

describe("tools config", () => {
  test("every tool links to an app route the reader or a specialist viewer serves", () => {
    for (const tool of DIANA_TOOLS) {
      const served = isReaderAppRoute(tool.href) || rootRouteFor(tool.href, false) !== "reader";
      expect(served, tool.href).toBe(true);
      expect(tool.audience.length, tool.id).toBeGreaterThan(0);
      expect(tool.shows.length, tool.id).toBeGreaterThan(20);
      expect(tool.question.endsWith("?"), tool.id).toBe(true);
    }
    expect(new Set(DIANA_TOOLS.map((tool) => tool.id)).size).toBe(DIANA_TOOLS.length);
    expect(isReaderAppRoute("/tools")).toBe(true);
  });

  test("tool lists are per site brand", () => {
    expect(toolsForBrand({ name: "Diana" })).toBe(DIANA_TOOLS);
    expect(toolsForBrand({ name: "Kevin" })).toEqual([]);
  });

  test("page-gated tools open only when the reader lists their owner page", () => {
    const singleCell = DIANA_TOOLS.find((tool) => tool.id === "single-cell")!;
    expect(singleCell.access).toMatchObject({ kind: "page", slug: "sources/diagnostics/single-cell/index" });
    expect(toolAvailability(singleCell, new Set(), false)).toBe("locked");
    expect(toolAvailability(singleCell, new Set(), true)).toBe("checking");
    expect(toolAvailability(singleCell, new Set(["sources/diagnostics/single-cell/index"]), false)).toBe("open");
    const timeline = DIANA_TOOLS.find((tool) => tool.id === "timeline")!;
    expect(toolAvailability(timeline, new Set(), false)).toBe("open");
  });

  test("groups current before archival and hides locked tools that ask to be hidden", () => {
    const base = { shows: "x".repeat(30), question: "Why?", audience: ["everyone" as const], href: "/tools" };
    const tools: ToolEntry[] = [
      { ...base, id: "old", title: "Old", status: "archival", access: { kind: "site" } },
      { ...base, id: "now", title: "Now", status: "current", access: { kind: "site" } },
      { ...base, id: "secret", title: "Secret", status: "current", access: { kind: "page", slug: "p", requirement: "r" }, hideWhenLocked: true },
      { ...base, id: "marked", title: "Marked", status: "current", access: { kind: "page", slug: "p", requirement: "r" } },
    ];
    const groups = groupTools(tools, (tool) => toolAvailability(tool, new Set(), false));
    expect(groups.map((g) => g.status)).toEqual(["current", "archival"]);
    expect(groups[0].tools.map((t) => [t.tool.id, t.availability])).toEqual([["now", "open"], ["marked", "locked"]]);
  });

  test("page access never distinguishes restricted from unpublished", () => {
    expect(pageAccess({ slug: "a" }, false)).toBe("allowed");
    expect(pageAccess(null, false)).toBe("denied");
    expect(pageAccess(null, true)).toBe("pending");
  });
});
