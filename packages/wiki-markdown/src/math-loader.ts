import type rehypeKatex from "rehype-katex";

type MathPlugin = typeof rehypeKatex;
let loaded: MathPlugin | undefined;
let pending: Promise<MathPlugin> | undefined;

// Deliberately conservative: currency and escaped dollars may load math too.
// Raw HTML and fenced language-math blocks use the same rehype-katex support.
export function mayContainMath(content: string) {
  return content.includes("$") || /(?:math-inline|math-display|language-math)/.test(content) || /(?:`{3,}|~{3,})[ \t]*math\b/.test(content);
}

export function loadedMathPlugin() { return loaded; }
export function preloadMarkdownMath() {
  return pending ??= import("rehype-katex").then(module => (loaded = module.default));
}
