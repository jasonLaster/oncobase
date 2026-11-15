import { expect, test } from "bun:test";
import { freezeScrollPosition, rememberScrollPosition, savedScrollPosition } from "./scroll-memory";

test("scroll positions are kept per history entry and bounded", () => {
  rememberScrollPosition("a", 900);
  rememberScrollPosition("b", 40);
  rememberScrollPosition("a", 950);
  expect(savedScrollPosition("a")).toBe(950);
  expect(savedScrollPosition("b")).toBe(40);
  expect(savedScrollPosition("never-seen")).toBeUndefined();
  for (let index = 0; index < 200; index++) rememberScrollPosition(`entry-${index}`, index);
  // The oldest entries fall out; recent ones stay.
  expect(savedScrollPosition("b")).toBeUndefined();
  expect(savedScrollPosition("entry-199")).toBe(199);
});

test("a returned-to entry keeps its place until it has been restored", () => {
  rememberScrollPosition("back", 900);
  const release = freezeScrollPosition("back");
  // The destination renders short first and the browser clamps the scroll to 0.
  rememberScrollPosition("back", 0);
  expect(savedScrollPosition("back")).toBe(900);
  release();
  rememberScrollPosition("back", 120);
  expect(savedScrollPosition("back")).toBe(120);
});
