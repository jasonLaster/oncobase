import { expect, test } from "bun:test";
import { mayContainMath } from "./math-loader";

test("plain documents skip math, while every supported math marker opts in", () => {
  expect(mayContainMath("# Ordinary article\n\nA table | value\n[link](/wiki/one)")).toBe(false);
  for (const text of ["$x^2$", "$$x$$", "cost $200", "```math\nx+y\n```", "~~~~ math\nx\n~~~~", '<code class="math-inline">x</code>', '<pre class="math-display">x</pre>', '<code class="language-math">x</code>']) {
    expect(mayContainMath(text)).toBe(true);
  }
});
