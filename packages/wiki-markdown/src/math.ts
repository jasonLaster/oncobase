import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function walkMarkdownTree(node: MarkdownNode, visit: (child: MarkdownNode) => void) {
  visit(node);

  for (const child of node.children ?? []) {
    walkMarkdownTree(child, visit);
  }
}

export function normalizeMathValue(value: string): string {
  let normalized = value.trim();

  if (normalized.startsWith("(") && !normalized.includes(")")) {
    normalized += ")";
  }

  normalized = normalized.replace(/~/g, "\\,");
  normalized = normalized.replace(/(\d(?:\.\d+)?)\s*-\s*\\mu\b/g, "$1\\,\\mu");
  normalized = normalized.replace(/(\d(?:\.\d+)?)\s*\\mu\b/g, "$1\\,\\mu");
  normalized = normalized.replace(/\\mu\s+\\mathrm\{/g, "\\mu\\mathrm{");
  normalized = normalized.replace(/\s+([),.;])/g, "$1");
  normalized = normalized.replace(/([,(])\s+/g, "$1");

  return normalized;
}

export function remarkCleanMath() {
  return (tree: MarkdownNode) => {
    walkMarkdownTree(tree, (node) => {
      if (node.type === "inlineMath" || node.type === "math") {
        node.value = normalizeMathValue(node.value ?? "");
      }
    });
  };
}

export const markdownRemarkPlugins = [remarkGfm, remarkMath, remarkCleanMath];
export const markdownRehypePlugins = [rehypeRaw, rehypeKatex];
