import { expect, test } from "bun:test";
import { cn } from "./ui";

test("diagnostic overrides win over variant colors without dropping text size", () => {
  expect(cn("text-xs border-border text-foreground", "border-white/15 text-emerald-100"))
    .toBe("text-xs border-white/15 text-emerald-100");
  expect(cn("bg-background hover:bg-accent", "bg-black hover:bg-white/10", false))
    .toBe("bg-black hover:bg-white/10");
});
