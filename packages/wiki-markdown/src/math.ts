import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function isCurrencyDollar(markdown: string, dollarIndex: number) {
  const rest = markdown.slice(dollarIndex + 1);
  const placeholder = rest.match(/^X\b/);

  if (placeholder) {
    return rest[placeholder[0].length] !== "$";
  }

  const amount = rest.match(/^\d[\d,]*(?:\.\d+)?[KMBTkmbt]?/);

  if (!amount) {
    return false;
  }

  const value = amount[0];
  const next = rest.slice(value.length);

  if (next.startsWith("$")) {
    return false;
  }

  if (/^\/[A-Za-z]/.test(next)) {
    return true;
  }

  const operator = next.match(/^\s*([-+*/=<>–—])/);

  if (operator) {
    const afterOperator = next.slice(operator[0].length);

    if (
      (operator[1] === "-" || operator[1] === "–" || operator[1] === "—") &&
      /^\s*\$?\d/.test(afterOperator)
    ) {
      return true;
    }

    return (
      value.includes(",") ||
      /[KMBTkmbt]$/.test(value) ||
      /^\d{4,}/.test(value) ||
      /^\d+\.\d{2}$/.test(value)
    );
  }

  return (
    value.includes(",") ||
    /[KMBTkmbt]$/.test(value) ||
    /^\d{4,}/.test(value) ||
    /^\d+\.\d{2}$/.test(value) ||
    next.length === 0 ||
    /^[\s,.;:)\]}*_]/.test(next)
  );
}

function escapeCurrencyDollars(markdown: string) {
  return markdown.replace(
    /(^|[^\\])\$/g,
    (match, prefix: string, offset: number) => {
      const dollarIndex = offset + prefix.length;

      return isCurrencyDollar(markdown, dollarIndex)
        ? `${prefix}\\$`
        : match;
    },
  );
}

function normalizeCurrencyTypos(markdown: string) {
  return markdown
    .replace(
      /\\(\d[\d,]*(?:\.\d+)?[KMBTkmbt])(?=\s*[-–—]\s*\$?\d)/g,
      "$$$1",
    )
    .replace(
      /\$(\d[\d,]*(?:\.\d+)?[KMBTkmbt])\s*([-–—])\s*(?!\$)(\d[\d,]*(?:\.\d+)?[KMBTkmbt])/g,
      "$$$1$2$$$3",
    );
}

export function protectCurrencyFromMath(markdown: string) {
  return escapeCurrencyDollars(normalizeCurrencyTypos(markdown));
}

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
export const markdownRehypePlugins = [rehypeRaw, rehypeSlug, rehypeKatex];
