import { describe, expect, test } from "bun:test";
import {
  preprocessCitations,
  resolveAssetPath,
  resolveHref,
  resolveWikilinks,
  splitWikilinkAlias,
} from "./index";

describe("wiki markdown helpers", () => {
  test("splits wikilink aliases", () => {
    expect(splitWikilinkAlias("wiki/foo|Foo")).toEqual({
      target: "wiki/foo",
      display: "Foo",
    });
  });

  test("resolves wikilinks and pdfs", () => {
    expect(resolveWikilinks("[[wiki/foo|Foo]] and [[paper.pdf]]", "wiki/current")).toBe(
      "[Foo](/wiki/foo) and [paper](/api/file?path=wiki%2Fpaper.pdf)",
    );
  });

  test("rewrites relative asset paths", () => {
    expect(resolveAssetPath("images/scan.png", "wiki/diagnostics/index")).toBe(
      "wiki/diagnostics/images/scan.png",
    );
  });

  test("normalizes markdown and pdf hrefs", () => {
    expect(resolveHref("foo.md#bar")).toBe("foo#bar");
    expect(resolveHref("paper.pdf", "wiki/research/index")).toBe(
      "/api/file?path=wiki%2Fresearch%2Fpaper.pdf",
    );
  });

  test("turns citations into markdown links", () => {
    expect(preprocessCitations("Finding [1] and gene^{2-3}")).toContain(
      "[[1]](#references)",
    );
  });
});
