import postcss, { type Container } from "postcss";

// Select from the actual compiled stylesheet so typography, breakpoints,
// variables and cascade layers cannot drift from the interactive reader.
export function criticalReaderCss(css: string) {
  const root = postcss.parse(css);
  const reader = /\.(?:wiki-markdown|smart-table(?:-(?:shell|wrapper|header|body|footer|row|head-cell|cell|caption))?|prototype-shell|app-shell|app-content|content-shell|page-shell|wiki-shell-outline-(?:root|content|content-inner)|wiki-shell-document-article|wiki-shell-page-header|prose|max-w-none)(?![\w-])/;
  const keepRule = (selector: string) =>
    (reader.test(selector) && !/sidebar-|(?:resize|toolbar|popover|pagination|toggle|overlay)/.test(selector)) ||
    [".hidden", ".dark", ".dark\\:hidden", ".dark\\:block"].includes(selector) ||
    /:root|:host/.test(selector) || /^(?:html|body|\*)(?![\w-])/.test(selector);
  const prune = (container: Container, base = false) => {
    for (const node of [...(container.nodes ?? [])]) {
      if (node.type === "rule") {
        if (!base && !keepRule(node.selector)) node.remove();
      } else if (node.type === "atrule") {
        if (node.name === "font-face" || node.name === "property" ||
          (node.name === "layer" && node.params === "properties") || /keyframes$/.test(node.name)) node.remove();
        else if (node.nodes && node.name !== "property") {
          prune(node, base || (node.name === "layer" && node.params === "base"));
          if (!node.nodes.length) node.remove();
        }
      } else if (node.type === "comment") node.remove();
    }
  };
  prune(root);
  const result = root.toString();
  if (/<\/style/i.test(result)) throw new Error("Unsafe critical stylesheet");
  return result;
}
