function splitTitleWikilinkAlias(inner: string): {
  target: string;
  display?: string;
} {
  const pipeIndex = inner.indexOf("|");
  if (pipeIndex === -1) return { target: inner.trim() };

  return {
    target: inner.slice(0, pipeIndex).trim(),
    display: inner.slice(pipeIndex + 1).trim(),
  };
}

export function markdownTitleToText(title: string): string {
  return title
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]]+)]]/g, (_match, inner: string) => {
      const { target, display } = splitTitleWikilinkAlias(inner);
      return display || target.split("/").pop()?.replace(/\.(?:md|mdx)$/i, "") || target;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
