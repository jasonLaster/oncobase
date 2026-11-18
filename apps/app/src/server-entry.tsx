// SSR stage 0 (plans/2026-11-17-server-rendering-plan.md): the reader's first
// frame rendered on the server. Built as its own lazy server module
// (scripts/build-reader-ssr.ts) with its own budget; no response uses it yet.
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { preloadOptionalMarkdownStages } from "@oncobase/wiki-markdown/optional-stages";
import { StrictMode, Suspense } from "react";
// prerender, not renderToReadableStream: it waits for every boundary and emits
// completed ones inline. A streamed render outlines any boundary that suspends
// once (a lazy module on its first use) and reveals it later from an inline
// script, so the first paint would be the article's loading fallback.
import { prerender } from "react-dom/static";
import { StaticRouter } from "react-router";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppStarting, ReaderPending } from "./AppStarting";
import { bootBlocksFromHtml, bootInputs, documentPublicIdentity, documentSessionIdentity, type ReaderBootInputs } from "./bootstrap/boot-inputs";
import { documentInitialReaderData, type InitialReaderData } from "./bootstrap/initial-reader-data";
import { explicitReaderScope } from "./reader-session";
import { PresentingReader, ReaderApp } from "./ReaderRoot";
import { WikiIdentityPendingContext } from "./wiki-context";

export type FirstFrame = {
  identity: WikiSessionIdentity;
  /** The document's own session answer was used; otherwise identity is still pending on the client. */
  identityPending: boolean;
  scope: WikiScope;
  initial: InitialReaderData;
};

/**
 * What the client's first render presents for these boot inputs, with the
 * same derivations it uses (boot-inputs.ts): a session document's own
 * identity, else a fresh public payload's, and the page and navigation slice
 * that identity may see. Null when the client would not present a page from
 * the document (it waits for its own requests instead).
 */
export function firstFrameFor(inputs: ReaderBootInputs): FirstFrame | null {
  const session = documentSessionIdentity(inputs);
  const identity = session ?? documentPublicIdentity(inputs, explicitReaderScope(inputs.search));
  if (!identity) return null;
  const initial = documentInitialReaderData(inputs, identity);
  if (!initial) return null;
  return { identity, identityPending: !session, scope: session ? session.scope : explicitReaderScope(inputs.search) ?? "public", initial };
}

/** The first-frame tree: main.tsx's boundaries above WikiViteRoot's and
 * ReaderSession's presenting render, under a static router. */
export function ReaderFirstFrame({ frame, inputs }: { frame: FirstFrame; inputs: ReaderBootInputs }) {
  const storeId = makeWikiStoreId({ siteSlug: frame.identity.siteSlug, scope: frame.scope, origin: inputs.origin, cacheKey: frame.identity.cacheKey });
  return (
    <StrictMode>
      <AppErrorBoundary>
        <StaticRouter location={`${inputs.pathname}${inputs.search}`}>
          <Suspense fallback={<AppStarting />}>
            <Suspense fallback={<ReaderPending />}>
              <WikiIdentityPendingContext.Provider value={frame.identityPending}>
                <PresentingReader host={null} cachedStartup={false} kit={null} initial={frame.initial}>
                  <ReaderApp identity={frame.identity} scope={frame.scope} storeId={storeId}
                    devtoolsFooterVisible={false} liveStoreDevtoolsEnabled={false} />
                </PresentingReader>
              </WikiIdentityPendingContext.Provider>
            </Suspense>
          </Suspense>
        </StaticRouter>
      </AppErrorBoundary>
    </StrictMode>
  );
}

export type RenderFirstFrameOptions = {
  /** The document's URL. */
  url: URL;
  /** The data blocks the response carries (page-bootstrap.ts output). */
  payloadHtml: string;
  env?: { VITE_WIKI_API_ORIGIN?: string; VITE_WIKI_SITE_SLUG?: string };
  /** Abort and give up after this long (the response then carries the payload only). */
  timeoutMs?: number;
  now?: number;
};

/**
 * Renders the reader's first frame for a response's own payload, or returns
 * null when the client would not present it, the render errors, or it takes
 * longer than `timeoutMs`. Data comes only from `payloadHtml`, which the
 * response already carries, so the HTML holds nothing the payload does not.
 */
export async function renderReaderFirstFrame({ url, payloadHtml, env = {}, timeoutMs = 250, now = Date.now() }: RenderFirstFrameOptions): Promise<string | null> {
  const inputs = bootInputs({ origin: url.origin, pathname: url.pathname, search: url.search }, env, bootBlocksFromHtml(payloadHtml, now), now);
  const frame = firstFrameFor(inputs);
  if (!frame) return null;
  // Fizz may render a small tree within one task, before a timer can fire,
  // so the elapsed time is checked as well as the abort signal.
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("first-frame render timed out")), timeoutMs);
  let failed = false;
  try {
    await preloadOptionalMarkdownStages(frame.initial.page.content, frame.initial.page.slug);
    const { prelude } = await prerender(<ReaderFirstFrame frame={frame} inputs={inputs} />, {
      signal: controller.signal,
      // Never outline a large completed boundary into a later reveal script.
      progressiveChunkSize: Number.POSITIVE_INFINITY,
      onError() { failed = true; },
    });
    const html = await new Response(prelude).text();
    return failed || controller.signal.aborted || performance.now() - started > timeoutMs ? null : html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
