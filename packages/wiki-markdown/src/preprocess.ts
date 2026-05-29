// Markdown-string preprocessing shared by BOTH render paths (the server HTML
// renderer and the React WikiMarkdown component) so currency handling and
// legacy directive stripping are identical in the Next.js and Vite readers.

function stripLegacyTableDirectives(md: string): string {
  return md.replace(/^\s*<!--\s*table-cols:\s*.*?-->\s*$/gm, "");
}

function isCurrencyDollar(md: string, dollarIndex: number): boolean {
  const rest = md.slice(dollarIndex + 1);
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

function escapeCurrencyDollars(md: string): string {
  return md.replace(/(^|[^\\])\$/g, (match, prefix: string, offset: number) => {
    const dollarIndex = offset + prefix.length;

    return isCurrencyDollar(md, dollarIndex) ? `${prefix}\\$` : match;
  });
}

function normalizeCurrencyTypos(md: string): string {
  return md
    .replace(/\\(\d[\d,]*(?:\.\d+)?[KMBTkmbt])(?=\s*[-–—]\s*\$?\d)/g, "$$$1")
    .replace(
      /\$(\d[\d,]*(?:\.\d+)?[KMBTkmbt])\s*([-–—])\s*(?!\$)(\d[\d,]*(?:\.\d+)?[KMBTkmbt])/g,
      "$$$1$2$$$3",
    );
}

/**
 * Strip legacy table directives and escape currency `$` so KaTeX/remark-math
 * does not treat dollar amounts as math. Applied by both render paths.
 */
export function preprocessWikiMarkdownText(md: string): string {
  return escapeCurrencyDollars(normalizeCurrencyTypos(stripLegacyTableDirectives(md)));
}
