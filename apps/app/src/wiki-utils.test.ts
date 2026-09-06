import { describe, expect, test } from "bun:test";
import { contentSlugFromRouteSlug, slugFromPath } from "./wiki-utils";

describe("slugFromPath", () => {
  test("treats markdown extensions as article aliases", () => {
    expect(slugFromPath("/wiki/logistics/insurance.md")).toBe(
      "wiki/logistics/insurance",
    );
    expect(slugFromPath("/wiki/logistics/insurance.MDX")).toBe(
      "wiki/logistics/insurance",
    );
  });

  test("normalizes trailing slashes without changing the root slug", () => {
    expect(slugFromPath("/wiki/logistics/insurance/")).toBe(
      "wiki/logistics/insurance",
    );
    expect(slugFromPath("/")).toBe("index");
  });
});

describe("contentSlugFromRouteSlug", () => {
  test("maps the canonical about index route to root content", () => {
    expect(contentSlugFromRouteSlug("about/Index")).toBe("index");
    expect(contentSlugFromRouteSlug("ABOUT/index")).toBe("index");
  });

  test("leaves ordinary document slugs unchanged", () => {
    expect(contentSlugFromRouteSlug("wiki/logistics/insurance")).toBe(
      "wiki/logistics/insurance",
    );
  });
});
