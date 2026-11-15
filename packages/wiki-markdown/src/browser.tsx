"use client";
import { memo, useEffect, useMemo, useState } from "react";
import { WikiMarkdownRenderer, type WikiMarkdownProps } from "./renderer";
import { prepareWikiMarkdown } from "./prepare";
import { markdownLightRehypePlugins, markdownRehypeTailPlugins } from "./math-common";
import { loadedMathPlugin, mayContainMath, preloadMarkdownMath } from "./math-loader";
import { loadedRawHtmlPlugin, mayContainRawHtml, preloadRawHtml } from "./raw-html-loader";
export * from "./renderer";

type Shown = {
  props: WikiMarkdownProps;
  prepared: string;
  plugins: NonNullable<Parameters<typeof WikiMarkdownRenderer>[0]["rehypePlugins"]>;
  source?: unknown;
};
type Plugin = NonNullable<ReturnType<typeof loadedMathPlugin>> | NonNullable<ReturnType<typeof loadedRawHtmlPlugin>>;

/** Load an optional pipeline stage when the document needs it. */
function useOptionalPlugin<T extends Plugin>(needed: boolean, loaded: () => T | undefined, preload: () => Promise<T>) {
  const [plugin, setPlugin] = useState(loaded);
  const [error, setError] = useState<Error | null>(null);
  const current = loaded() ?? plugin;
  const waiting = needed && !current;
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    void preload().then(value => {
      if (active) setPlugin(() => value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => { active = false; };
  }, [waiting, preload]);
  if (error) throw error;
  return { plugin: current, waiting };
}

const idle = (callback: () => void) => typeof window.requestIdleCallback === "function"
  ? window.requestIdleCallback(callback, { timeout: 10_000 })
  : window.setTimeout(callback, 3_000);

/**
 * Ordinary documents never import the math engine, and documents without raw
 * HTML never wait for rehype-raw (parse5). Both render exactly as the full
 * pipeline would (renderer-raw-html.test.tsx). Keep the current document
 * mounted if a background edit introduces either while it loads.
 */
export const WikiMarkdown = memo(function WikiMarkdown(props: WikiMarkdownProps & { loadingFallback?: React.ReactNode }) {
  const { loadingFallback = null, ...documentProps } = props;
  const { content, currentSlug, apiBasePath = "" } = props;
  const prepared = useMemo(() => prepareWikiMarkdown(content, currentSlug, apiBasePath), [content, currentSlug, apiBasePath]);
  const needsRaw = useMemo(() => mayContainRawHtml(prepared), [prepared]);
  const math = useOptionalPlugin(mayContainMath(content), loadedMathPlugin, preloadMarkdownMath);
  const raw = useOptionalPlugin(needsRaw, loadedRawHtmlPlugin, preloadRawHtml);
  const waiting = math.waiting || raw.waiting;
  const plugins = useMemo(() => [
    ...(raw.plugin && needsRaw ? [raw.plugin, ...markdownRehypeTailPlugins] : markdownLightRehypePlugins),
    ...(math.plugin ? [math.plugin] : []),
  ], [raw.plugin, needsRaw, math.plugin]);
  const [previous, setPrevious] = useState<Shown | null>(null);
  const current: Shown = { props: documentProps, prepared, plugins };
  // Remember the last renderable document during render rather than in an
  // effect: an effect committed every content change and then re-rendered the
  // whole markdown tree a second time.
  if (!waiting && (previous?.source !== props || previous.plugins !== plugins)) setPrevious({ ...current, source: props });
  // A document that needed neither may still lead to one that does: fetch the
  // raw-HTML stage once the reader is idle, so that navigation does not wait.
  useEffect(() => {
    if (loadedRawHtmlPlugin()) return;
    const handle = idle(() => { void preloadRawHtml().catch(() => {}); });
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);
  const shown = waiting
    ? previous?.props.currentSlug === props.currentSlug ? previous : null
    : current;
  if (!shown) return loadingFallback;
  return <WikiMarkdownRenderer {...shown.props} preparedContent={shown.prepared} rehypePlugins={shown.plugins} />;
});
