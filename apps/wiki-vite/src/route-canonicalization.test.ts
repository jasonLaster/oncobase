import { describe, expect, test } from "bun:test";
import {
  canonicalRoutePathname,
  canonicalSlugMap,
  configuredRedirectPathname,
  matchConfiguredRedirect,
} from "./route-canonicalization";

const canonicalSlugs = canonicalSlugMap([
  "about/Index",
  "wiki/education/reading-a-tumor/index",
  "wiki/logistics/insurance",
]);

describe("route canonicalization", () => {
  test("matches exact and wildcard configured redirects", () => {
    expect(
      matchConfiguredRedirect("/old/page", {
        source: "/old/:path*",
        destination: "/new/:path*",
      }),
    ).toBe("/new/page");
    expect(
      matchConfiguredRedirect("/wiki/education/reading-a-tumor", {
        source: "/wiki/education/reading-a-tumor",
        destination: "/wiki/education/reading-a-tumor/index",
      }),
    ).toBe("/wiki/education/reading-a-tumor/index");
  });

  test("uses the same redirects.json aliases as the server", () => {
    expect(configuredRedirectPathname("/wiki/education/reading-a-tumor")).toBe(
      "/wiki/education/reading-a-tumor/index",
    );
  });

  test("resolves aliases, extensions, casing, and trailing slashes to one route", () => {
    expect(
      canonicalRoutePathname(
        "/wiki/education/reading-a-tumor/",
        canonicalSlugs,
      ),
    ).toBe("/wiki/education/reading-a-tumor/index");
    expect(
      canonicalRoutePathname("/wiki/Logistics/Insurance.mdx", canonicalSlugs),
    ).toBe("/wiki/logistics/insurance");
    expect(
      canonicalRoutePathname("/wiki/logistics/insurance.md", canonicalSlugs),
    ).toBeNull();
    expect(canonicalRoutePathname("/about", canonicalSlugs)).toBe("/about/Index");
  });
});
