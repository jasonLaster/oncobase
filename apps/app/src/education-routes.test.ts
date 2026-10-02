import { expect, test } from "bun:test";
import {
  educationHref,
  educationLinkHref,
  educationSlugFromPathname,
  isEducationHubPathname,
} from "./education-routes";

test("education URLs preserve wiki identifiers without accepting adjacent paths or traversal", () => {
  expect(isEducationHubPathname("/education")).toBe(true);
  expect(isEducationHubPathname("/education-private/index")).toBe(false);
  for (const pathname of [
    "/education",
    "/education/search",
    "/education/%zz",
    "/education/%252e%252e/care",
    "/education/../care",
    "/education//index",
  ]) {
    expect(educationSlugFromPathname(pathname)).toBeNull();
  }
  const slug = "wiki/education/Oncology 101/index";
  expect(educationSlugFromPathname(educationHref(slug))).toBe(slug);
  expect(educationSlugFromPathname("/education/oncology-101/index.md")).toBe(
    "wiki/education/oncology-101/index",
  );
});

test("curriculum links retain query and heading while assets and external references keep working", () => {
  const current = "wiki/education/oncology-101/index";
  for (const href of [
    "/wiki/education/oncology-101/lesson.md?q=one#two",
    "lesson.md?q=one#two",
    "wiki/education/oncology-101/lesson?q=one#two",
  ]) {
    expect(educationLinkHref(href, current)).toBe(
      "/education/oncology-101/lesson?q=one#two",
    );
  }
  expect(educationLinkHref("../RNA%20biology/index", current)).toBe(
    "/education/RNA%20biology/index",
  );
  expect(
    educationLinkHref("/api/file?path=wiki%2Feducation%2Flab.html#lab"),
  ).toBe("/api/education/file?path=wiki%2Feducation%2Flab.html#lab");
  for (const href of [
    "https://example.com/paper",
    "mailto:hello@example.com",
    "#immune-cells",
    "/wiki/care/index",
    "/education/search?q=immune",
    "/wiki/education/%zz",
    "lesson%25zz",
  ]) {
    expect(educationLinkHref(href, current)).toBe(href);
  }
});
