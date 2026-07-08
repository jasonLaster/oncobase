import { describe, expect, test } from "bun:test";
import { cn } from "./utils.ts";

describe("wiki-shell utilities", () => {
  test("joins conditional class names", () => {
    expect(cn("root", false, null, undefined, "active")).toBe("root active");
  });
});
