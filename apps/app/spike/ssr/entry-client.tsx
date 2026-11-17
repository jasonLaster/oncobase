// SPIKE (P3 design, 2026-11-17). Not for shipping: hydrate the server-rendered
// first frame and report every mismatch React recovers from.
import "../../src/styles.css";
import { createElement, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { mayContainMath, preloadMarkdownMath } from "@oncobase/wiki-markdown/math-loader";
import { documentMayNeedRawHtml, preloadRawHtml } from "@oncobase/wiki-markdown/raw-html-loader";
import { ReaderFirstFrame, type Fixture } from "./tree";

declare global { interface Window { __SPIKE__: { recoverable: string[]; hydratedAt?: number; startedAt?: number; preloadMs?: number } } }

window.__SPIKE__ = { recoverable: [] };
const fixture = JSON.parse(document.getElementById("spike-fixture")!.textContent!) as Fixture;
const md = fixture.initial.page.content;
const t0 = performance.now();
await Promise.all([
  mayContainMath(md) ? preloadMarkdownMath() : null,
  documentMayNeedRawHtml(md) ? preloadRawHtml() : null,
]);
window.__SPIKE__.preloadMs = performance.now() - t0;
const Router = ({ children }: { children: ReactNode }) => createElement(BrowserRouter, null, children);
window.__SPIKE__.startedAt = performance.now();
hydrateRoot(document.getElementById("root")!, createElement(ReaderFirstFrame, { ...fixture, Router }), {
  onRecoverableError(error, info) {
    const e = error as Error & { cause?: Error };
    window.__SPIKE__.recoverable.push(`${e.message}${e.cause ? ` | cause: ${e.cause.message}` : ""}${info.componentStack ? ` | ${info.componentStack.split("\n").slice(1, 4).join(" <").trim()}` : ""}`);
  },
});
requestAnimationFrame(() => { window.__SPIKE__.hydratedAt = performance.now(); });
