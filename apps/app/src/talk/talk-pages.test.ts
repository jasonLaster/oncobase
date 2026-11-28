import { expect, test } from "bun:test";
import { isTalkRoute } from "../shell/document-routes";
import { appTalkPage } from "./talk-pages";

test("the cellularity explorer is a talk page, other diagnostics screens are not", () => {
  expect(appTalkPage("/diagnostics/cellularity")?.title).toBe("Tumor-bed cellularity explorer");
  expect(appTalkPage("/diagnostics/other")).toBeNull();
  expect(isTalkRoute("/diagnostics/cellularity")).toBe(true);
  expect(isTalkRoute("/diagnostics/other")).toBe(false);
  expect(isTalkRoute("/wiki/diagnosis")).toBe(true);
});

test("the single-cell viewer is a talk page; the tools index is not", () => {
  expect(appTalkPage("/tools/single-cell")?.slug).toBe("app/tools/single-cell");
  expect(isTalkRoute("/tools/single-cell")).toBe(true);
  expect(appTalkPage("/tools")).toBeNull();
  expect(isTalkRoute("/tools")).toBe(false);
});
