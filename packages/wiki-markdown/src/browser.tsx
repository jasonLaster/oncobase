"use client";
import { memo, useEffect, useMemo, useState } from "react";
import { WikiMarkdownRenderer, type WikiMarkdownProps } from "./renderer";
import { markdownRehypePlugins } from "./math-common";
import { loadedMathPlugin, mayContainMath, preloadMarkdownMath } from "./math-loader";
export * from "./renderer";

/** Ordinary documents never import the math engine. Keep the current document
 * mounted if a background edit introduces math while its engine is loading. */
export const WikiMarkdown = memo(function WikiMarkdown(props: WikiMarkdownProps & { loadingFallback?: React.ReactNode }) {
  const { loadingFallback = null, ...documentProps } = props;
  const needsMath = mayContainMath(props.content);
  const [plugin, setPlugin] = useState(loadedMathPlugin);
  const [error, setError] = useState<Error | null>(null);
  const [previous, setPrevious] = useState<WikiMarkdownProps | null>(null);
  const currentPlugin = loadedMathPlugin() ?? plugin;
  const waiting = needsMath && !currentPlugin;
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    void preloadMarkdownMath().then(value => {
      if (active) setPlugin(() => value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => { active = false; };
  }, [waiting]);
  useEffect(() => {
    if (!waiting) setPrevious(props);
  }, [props, waiting]);
  const plugins = useMemo(() => currentPlugin
    ? [...markdownRehypePlugins, currentPlugin] : markdownRehypePlugins, [currentPlugin]);
  if (error) throw error;
  const shown = waiting
    ? previous?.currentSlug === props.currentSlug ? previous : null
    : documentProps;
  if (!shown) return loadingFallback;
  return <WikiMarkdownRenderer {...shown} rehypePlugins={plugins} />;
});
