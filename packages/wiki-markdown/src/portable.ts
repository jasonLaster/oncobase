import { figureToPortableMarkdown } from "./figure-spec.ts";
import { toPortableMdx } from "./mdx-components.ts";

const PORTABLE_COLUMNS_OPEN_RE = /^[ \t]*:::columns(?:\{[^}\n]*\})?[ \t]*$/;
const PORTABLE_CONTAINER_OPEN_RE = /^[ \t]*:::[A-Za-z][A-Za-z0-9_-]*(?=$|[\s[\]{])/;
const PORTABLE_CONTAINER_CLOSE_RE = /^[ \t]*:::[ \t]*$/;
const PORTABLE_CALLOUT_RE = /^([ \t]*>[ \t]*)\[!([A-Za-z][A-Za-z0-9_-]*)\][+-]?(?:[ \t]+([^\r\n]*))?$/;
const PORTABLE_PAGE_BREAK_RE = /^[ \t]*<!--\s*page-break\s*-->[ \t]*$/i;
const PORTABLE_FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})([^\n]*)$/;

function stripLayoutDirectivesForPortable(md: string): string {
  if (
    !md.includes(":::columns") &&
    !md.includes("[!") &&
    !md.includes("```figure") &&
    !md.includes("~~~figure") &&
    !/page-break/i.test(md)
  ) {
    return md;
  }

  const lines = md.split("\n");
  const out: string[] = [];
  let fence: { char: string; length: number; isFigure: boolean; buffer: string[] } | null = null;
  const containerStack: Array<"columns" | "other"> = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const fenceMatch = line.match(PORTABLE_FENCE_RE);

    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[2]![0] === fence.char &&
        fenceMatch[2]!.length >= fence.length &&
        !(fenceMatch[3] ?? "").trim()
      ) {
        if (fence.isFigure) {
          out.push(figureToPortableMarkdown(fence.buffer.join("\n")));
        } else {
          out.push(raw);
        }
        fence = null;
      } else if (fence.isFigure) {
        fence.buffer.push(line);
      } else {
        out.push(raw);
      }
      continue;
    }

    if (fenceMatch) {
      const info = (fenceMatch[3] ?? "").trim().toLowerCase();
      const isFigure = info === "figure";
      fence = {
        char: fenceMatch[2]![0]!,
        length: fenceMatch[2]!.length,
        isFigure,
        buffer: [],
      };
      if (!isFigure) out.push(raw);
      continue;
    }

    if (PORTABLE_PAGE_BREAK_RE.test(line)) {
      continue;
    }

    if (PORTABLE_COLUMNS_OPEN_RE.test(line)) {
      containerStack.push("columns");
      continue;
    }

    if (PORTABLE_CONTAINER_OPEN_RE.test(line)) {
      containerStack.push("other");
      out.push(raw);
      continue;
    }

    if (PORTABLE_CONTAINER_CLOSE_RE.test(line)) {
      const top = containerStack.pop();
      if (top === "columns") continue;
      out.push(raw);
      continue;
    }

    const calloutMatch = line.match(PORTABLE_CALLOUT_RE);
    if (calloutMatch) {
      const prefix = calloutMatch[1]!;
      const type = calloutMatch[2]!;
      const title = calloutMatch[3]?.trim() || type[0]!.toUpperCase() + type.slice(1).toLowerCase();
      out.push(`${prefix}**${title}**`);
      continue;
    }

    out.push(raw);
  }

  if (fence?.isFigure) {
    out.push(`\`\`\`figure\n${fence.buffer.join("\n")}`);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Markdown that reads cleanly outside the wiki: MDX imports removed and
 * components replaced by fallbacks, layout directives unwrapped, callouts
 * simplified, and figures rendered as plain-text bullet lists.
 */
export function toPortableMarkdown(md: string): string {
  return stripLayoutDirectivesForPortable(toPortableMdx(md));
}
