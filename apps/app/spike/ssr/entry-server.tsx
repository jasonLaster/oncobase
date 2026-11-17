// SPIKE (P3 design, 2026-11-17). Not for shipping: a throwaway measurement of
// rendering the reader's first frame on the server. See
// plans/2026-11-17-server-rendering-plan.md.
import { createElement, type ReactNode } from "react";
import { StaticRouter } from "react-router";
import { ReaderFirstFrame, type Fixture } from "./tree";

export { renderToString, renderToReadableStream } from "react-dom/server";
// Optional markdown stages load in effects on the client (wiki-markdown
// browser.tsx useOptionalPlugin), which never run on the server: preload them
// before rendering, exactly as the client must before hydrating.
export { mayContainMath, preloadMarkdownMath } from "@oncobase/wiki-markdown/math-loader";
export { documentMayNeedRawHtml, preloadRawHtml } from "@oncobase/wiki-markdown/raw-html-loader";

export { WikiMarkdown } from "@oncobase/wiki-markdown/browser";

export function ServerFirstFrame(fixture: Fixture) {
  const Router = ({ children }: { children: ReactNode }) => createElement(StaticRouter, { location: fixture.url }, children);
  return createElement(ReaderFirstFrame, { ...fixture, Router });
}
