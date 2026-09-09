import { describe, expect, test } from "bun:test";
import { legacyRedirectResponse } from "../server/redirects";
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
  test("preserves current research pages and recovers mistakenly redirected reviews", () => {
    const review = "/wiki/research/reviews/breast-conservation-survival";
    const slugs = canonicalSlugMap([review.slice(1), "wiki/research/index"]);
    for (const path of [review, `${review}/`, `${review}.md`,
      "/wiki/research/index", "/wiki/research/essays/amazon-ai-oncology-investment"]) {
      expect(configuredRedirectPathname(path)).toBeNull();
      expect(legacyRedirectResponse(new Request(`https://example.test${path}`))).toBeNull();
    }
    expect(canonicalRoutePathname(review, slugs)).toBeNull();
    expect(canonicalRoutePathname("/wiki/research", slugs)).toBe("/wiki/research/index");
    const broken = "/sources/research/reviews/breast-conservation-survival";
    expect(canonicalRoutePathname(broken, slugs)).toBe(review);
    const response = legacyRedirectResponse(new Request(`https://example.test${broken}?scope=public`));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(`https://example.test${review}?scope=public`);
  });

  test("retains historical research source redirects outside current wiki branches", () => {
    for (const suffix of ["papers/example", "claude/example", "research-review", "reviews-old/example"]) {
      expect(configuredRedirectPathname(`/wiki/research/${suffix}`))
        .toBe(`/sources/research/${suffix}`);
    }
  });

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
    expect(canonicalRoutePathname("/timeline", canonicalSlugs)).toBe(
      "/diagnostics",
    );
    expect(canonicalRoutePathname("/admin/access", canonicalSlugs)).toBe(
      "/admin/pages",
    );
  });
});
