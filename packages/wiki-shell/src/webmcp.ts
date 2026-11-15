import { useEffect, useRef } from "react";

/**
 * WebMCP: tools a page registers so an AI agent in the browser can call them
 * (https://webmachinelearning.github.io/webmcp/). Supported browsers expose
 * `document.modelContext`. Early Chrome builds used `navigator.modelContext`,
 * and that registration returned `{ unregister }` instead of honouring an
 * AbortSignal. Everything here is a no-op where neither exists.
 *
 * Tools run in the page with the reader's own session, so they can never see
 * more than the reader can. Results are plain JSON. A tool reports a failure
 * the agent should act on as `{ error }`, not by throwing, so the model gets
 * the message rather than an opaque OperationError.
 */

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  /** The result carries text written by other users (comments, guest names). */
  untrustedContentHint?: boolean;
  /** The call changes something outside the page; browsers may confirm first. */
  consequentialHint?: boolean;
};

export type WebMcpTool<Input = Record<string, unknown>> = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (input: Input, options: { signal?: AbortSignal }) => unknown;
};

export type WebMcpCall = {
  tool: string;
  durationMs: number;
  ok: boolean;
  resultBytes: number;
};

type ModelContextLike = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => unknown;
};

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function getModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  const candidate =
    (document as unknown as { modelContext?: ModelContextLike }).modelContext ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as unknown as { modelContext?: ModelContextLike }).modelContext);
  return candidate && typeof candidate.registerTool === "function" ? candidate : null;
}

export function webMcpError(message: string, details?: Record<string, unknown>) {
  return { error: message, ...details };
}

function resultSize(value: unknown) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

/** Wrap execute so a thrown error becomes `{ error }` and every call is
 * reported to `onCall` (telemetry), success or not. */
export function instrumentTool(
  tool: WebMcpTool,
  onCall?: (call: WebMcpCall) => void,
): WebMcpTool {
  return {
    ...tool,
    execute: async (input, options) => {
      const startedAt = performance.now();
      let result: unknown;
      let ok = true;
      try {
        result = await tool.execute((input ?? {}) as Record<string, unknown>, options ?? {});
        ok = !(result && typeof result === "object" && "error" in result);
      } catch (error) {
        ok = false;
        if (options?.signal?.aborted) throw error;
        result = webMcpError(error instanceof Error ? error.message : String(error));
      }
      onCall?.({
        tool: tool.name,
        durationMs: Math.round(performance.now() - startedAt),
        ok,
        resultBytes: resultSize(result),
      });
      return result;
    },
  };
}

/** Register tools until `signal` aborts. Returns how many were registered. */
export function registerWebMcpTools(
  tools: WebMcpTool[],
  { signal, onCall }: { signal: AbortSignal; onCall?: (call: WebMcpCall) => void },
): number {
  const context = getModelContext();
  if (!context || signal.aborted) return 0;
  let registered = 0;
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) {
      console.warn(`[webmcp] skipped tool with invalid name: ${tool.name}`);
      continue;
    }
    try {
      const handle = context.registerTool(instrumentTool(tool, onCall), { signal });
      // Legacy registrations ignore the signal and return an unregister handle.
      const legacy = handle as { unregister?: () => void } | undefined;
      if (legacy && typeof legacy.unregister === "function") {
        signal.addEventListener("abort", () => legacy.unregister?.(), { once: true });
      }
      if (handle instanceof Promise) {
        handle.catch((error: unknown) => {
          if (!signal.aborted) console.warn(`[webmcp] could not register ${tool.name}`, error);
        });
      }
      registered += 1;
    } catch (error) {
      // A duplicate name (another component registered it) must not take
      // down the rest of the tool set.
      console.warn(`[webmcp] could not register ${tool.name}`, error);
    }
  }
  return registered;
}

/**
 * Keep `tools` registered while the component is mounted. Re-registers only
 * when `key` changes; execute callbacks read the latest closure through a ref,
 * so passing a fresh array every render is fine.
 */
export function useWebMcpTools(
  tools: WebMcpTool[] | null,
  { key = "", onCall, enabled = true }: { key?: string; onCall?: (call: WebMcpCall) => void; enabled?: boolean } = {},
) {
  const latest = useRef(tools);
  latest.current = tools;
  const onCallRef = useRef(onCall);
  onCallRef.current = onCall;
  const names = tools?.map((tool) => tool.name).join(",") ?? "";

  useEffect(() => {
    if (!enabled || !names || !getModelContext()) return;
    const controller = new AbortController();
    const current = latest.current ?? [];
    const proxies = current.map((tool): WebMcpTool => ({
      ...tool,
      execute: (input, options) => {
        const live = latest.current?.find((candidate) => candidate.name === tool.name) ?? tool;
        return live.execute(input, options);
      },
    }));
    registerWebMcpTools(proxies, {
      signal: controller.signal,
      onCall: (call) => onCallRef.current?.(call),
    });
    return () => controller.abort();
  }, [enabled, names, key]);
}

// ---------------------------------------------------------------------------
// Shared DOM helpers for "show, don't tell" tools.

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Find the smallest block element under `root` whose text contains `quote`
 * (whitespace and case-insensitive). */
export function findPassageElement(root: ParentNode, quote: string): HTMLElement | null {
  const needle = normalize(quote);
  if (needle.length < 3) return null;
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, figcaption, dd, dt, pre"),
  );
  let best: HTMLElement | null = null;
  for (const block of blocks) {
    if (!normalize(block.textContent ?? "").includes(needle)) continue;
    if (!best || (best.contains(block) && best !== block)) best = block;
    else if (!block.contains(best) && (block.textContent?.length ?? 0) < (best.textContent?.length ?? 0)) {
      best = block;
    }
  }
  if (best) return best;
  // Quotes that span blocks: fall back to a prefix of the quote.
  const words = needle.split(" ");
  if (words.length > 6) return findPassageElement(root, words.slice(0, 6).join(" "));
  return null;
}

const HIGHLIGHT_ATTR = "data-webmcp-highlight";

/** Scroll a passage into view and flash a highlight on it. */
export function highlightElement(element: HTMLElement, durationMs = 4000) {
  document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((node) => node.removeAttribute(HIGHLIGHT_ATTR));
  element.setAttribute(HIGHLIGHT_ATTR, "true");
  const previous = { outline: element.style.outline, background: element.style.backgroundColor, transition: element.style.transition };
  element.style.transition = "background-color 300ms ease, outline-color 300ms ease";
  element.style.outline = "2px solid color-mix(in srgb, currentColor 35%, transparent)";
  element.style.backgroundColor = "color-mix(in srgb, #facc15 28%, transparent)";
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => {
    if (element.getAttribute(HIGHLIGHT_ATTR) !== "true") return;
    element.removeAttribute(HIGHLIGHT_ATTR);
    element.style.outline = previous.outline;
    element.style.backgroundColor = previous.background;
    window.setTimeout(() => { element.style.transition = previous.transition; }, 350);
  }, durationMs);
}

/** Wait (up to `timeoutMs`) until `find` returns an element, for tools that
 * navigate first and then act on the newly rendered page. */
export function waitForElement<T>(
  find: () => T | null | undefined,
  { timeoutMs = 5000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => {
      if (signal?.aborted) return resolve(null);
      const found = find();
      if (found) return resolve(found);
      if (performance.now() - startedAt > timeoutMs) return resolve(null);
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

/** Rendered headings (h1-h4 with ids) under `root`, without anchor glyphs. */
export function collectHeadings(root: ParentNode, selector = "h1[id], h2[id], h3[id], h4[id]") {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .map((heading) => {
      const clone = heading.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('a[href^="#"], a[aria-hidden="true"], .anchor, .header-anchor, .heading-anchor').forEach((node) => node.remove());
      const text = (clone.textContent ?? "").replace(/^#{1,6}\s*/, "").replace(/(?:\s*#\s*)+$/, "").trim();
      return { id: heading.id, text: text || heading.id, level: Number(heading.tagName.slice(1)) };
    })
    .filter((item) => item.id && item.text && Number.isFinite(item.level));
}

/** Put `#id` in the URL (keeping routers in sync) and scroll the heading in. */
export function scrollToHeading(id: string, root: ParentNode = document) {
  const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
  return Boolean(target);
}

/** Markdown section extraction: the heading whose text or slug matches
 * `section`, through to the next heading of the same or higher level. */
export function extractMarkdownSection(markdown: string, section: string): string | null {
  const target = slugifyHeading(section);
  const lines = markdown.split("\n");
  let start = -1;
  let level = 0;
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const headingLevel = match[1]!.length;
    if (start >= 0 && headingLevel <= level) {
      return lines.slice(start, index).join("\n").trim();
    }
    if (start < 0 && slugifyHeading(match[2]!) === target) {
      start = index;
      level = headingLevel;
    }
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

/** Headings of a markdown body, with the ids the renderer gives them
 * (GitHub-style slugs). */
export function markdownOutline(markdown: string) {
  const outline: Array<{ id: string; text: string; level: number }> = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2]!.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`]/g, "").trim();
    if (text) outline.push({ id: slugifyHeading(text), text, level: match[1]!.length });
  }
  return outline;
}

export function slugifyHeading(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
