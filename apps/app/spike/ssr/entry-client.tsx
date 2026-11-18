// SPIKE (P3 design, 2026-11-17). Not for shipping: hydrate the server-rendered
// first frame and report every mismatch React recovers from.
import "../../src/styles.css";
import { createElement, Fragment, useLayoutEffect, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { flushSync } from "react-dom";
// The palette rides in the render-blocking module graph (static import), so a
// shortcut pressed before hydration opens it in the first interactive frame.
import "../../src/shell/CommandPalette";
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
let afterRoot!: () => void;
(window as any).__ssrAfterRoot = new Promise<void>(resolve => { afterRoot = resolve; });
window.__SPIKE__.startedAt = performance.now();
performance.mark("ssr-hydrate-call");
// Resolves in the root pass's layout effects: everything outside a Suspense
// boundary is hydrated. Renders nothing, so it cannot affect hydration.
// A named 2 ms spin, so a CPU profile can find the commit (profile.ts).
function spikeCommitMarker() { if (!new URLSearchParams(location.search).has("profile")) return; const t = performance.now(); while (performance.now() - t < 2) { /* spin */ } }
let committed!: () => void;
const rootCommitted = new Promise<void>(resolve => { committed = resolve; });
function RootCommitted() {
  useLayoutEffect(() => { performance.mark("ssr-root-committed"); spikeCommitMarker(); committed(); }, []);
  return null;
}
// Hydrate the root pass synchronously (SyncLane via flushSync), inside the
// render-blocking module's evaluation: Chrome unblocks rendering at the
// module's first real await, so anything async here would paint first.
// Suspense boundaries still defer to OffscreenLane.
let root!: ReturnType<typeof hydrateRoot>;
flushSync(() => { root = hydrateRoot(document.getElementById("root")!, createElement(Fragment, null,
  createElement(ReaderFirstFrame, { ...fixture, Router }), createElement(RootCommitted)), {
  onRecoverableError(error, info) {
    const e = error as Error & { cause?: Error };
    window.__SPIKE__.recoverable.push(`${e.message}${e.cause ? ` | cause: ${e.cause.message}` : ""}${info.componentStack ? ` | ${info.componentStack.split("\n").slice(1, 4).join(" <").trim()}` : ""}`);
  },
}); });
(window as any).__ssrReplay?.attach(root);
requestAnimationFrame(() => { window.__SPIKE__.hydratedAt = performance.now(); });
// With <script type="module" blocking="render"> (SPIKE_GATE), the browser does
// not paint until this module finishes evaluating: hold it until the root pass
// has committed, so the first frame the user sees is already interactive.
await rootCommitted;
// Rendering is unblocked now; the head's safety timer must not fire later.
document.querySelector("script[blocking=render]")?.removeAttribute("blocking");
// Body hydration waits for the first idle period after the root commit.
const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
if (idle) idle(() => afterRoot(), { timeout: 1000 }); else setTimeout(afterRoot, 200);
