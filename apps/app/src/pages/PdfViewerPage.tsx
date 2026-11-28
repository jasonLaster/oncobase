import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { getDocument, GlobalWorkerOptions, TextLayer, version as pdfjsVersion, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { withContentVersion } from "@oncobase/wiki-content";
import { NumberInput, NumberInputControl } from "@oncobase/ui/number-input";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarInput } from "@oncobase/ui/toolbar";
import "./pdf-viewer-styles";

GlobalWorkerOptions.workerSrc = workerUrl;

// The account dialog loads only when a PDF turns out to need sign-in.
const PdfViewerSignIn = lazy(() => import("./PdfViewerSignIn"));

/** Why a PDF didn't open, as far as the viewer can tell without disclosing more than the server does. */
type OpenFailure =
  | { kind: "invalid" }
  // Restricted, missing, or unreachable; the account state picks the message.
  | { kind: "unavailable"; account: "checking" | "signed-out" | "signed-in" };

async function hasAccountSession() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!response.ok) return false;
    const data = await response.json() as { user?: unknown };
    return Boolean(data.user);
  } catch {
    return false;
  }
}

type ReportContext = Record<string, string | number | boolean | null>;

/** Sends a viewer failure to the server's runtime logs; never throws. */
function reportViewerError(stage: "open" | "render", path: string, cause: unknown, page: number | undefined, context: ReportContext) {
  const error = cause instanceof Error
    ? { name: cause.name.slice(0, 120), message: cause.message.slice(0, 1000), stack: cause.stack?.slice(0, 4000) }
    : { name: "NonError", message: String(cause).slice(0, 1000) };
  const body = JSON.stringify({
    source: "pdf-viewer", stage, path, page, error,
    context: {
      pdfjs: pdfjsVersion, devicePixelRatio: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, ...context,
    },
  });
  try {
    void fetch("/api/client-errors", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => undefined);
  } catch { /* reporting must never break the viewer */ }
}

function initialPage() {
  const page = Number(new URLSearchParams(window.location.hash.slice(1)).get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function PdfDocument({ path, version }: { path: string; version: string | null }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState<number | null>(page);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(Math.max(240, window.innerWidth - 32));
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<OpenFailure | null>(null);
  // Bumped after an account sign-in, to open the PDF again with the new session.
  const [attempt, setAttempt] = useState(0);
  const [rendering, setRendering] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const name = path.split("/").at(-1) ?? "PDF";
  // P11: a link from a page carries the manifest's hash through the redirect,
  // so the bytes PDF.js fetches cache immutably and refresh when they change.
  const fileUrl = withContentVersion(`/api/file?path=${encodeURIComponent(path)}`, version);

  useEffect(() => {
    document.title = `${name} — PDF Viewer`;
    const task = getDocument({
      url: fileUrl,
      withCredentials: true,
      cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
      iccUrl: "/pdf-assets/iccs/",
    });
    let active = true;
    void task.promise.then(document => {
      if (!active) return;
      setPdf(document);
      setPage(current => Math.min(current, document.numPages));
      setPageInput(current => Math.min(current ?? 1, document.numPages));
    }).catch((cause: unknown) => {
      if (!active) return;
      reportViewerError("open", path, cause, undefined, {});
      if (cause instanceof Error && cause.name === "InvalidPDFException") {
        setFailure({ kind: "invalid" });
        setError("The stored file is not a valid PDF. Download the original or check its source page for a replacement.");
        return;
      }
      // The server answers a restricted file and a missing one the same way;
      // the reader's own account state decides what to suggest.
      setFailure({ kind: "unavailable", account: "checking" });
      setError("This PDF could not be opened.");
      void hasAccountSession().then(signedIn => {
        if (!active) return;
        setFailure({ kind: "unavailable", account: signedIn ? "signed-in" : "signed-out" });
        setError(signedIn
          ? "Your account doesn't have access to this PDF, or it is no longer available."
          : "This PDF may be restricted to readers with an account. The shared site password doesn't open restricted files. Sign in with your account to open it.");
      });
    });
    return () => { active = false; void task.destroy(); };
  }, [attempt, fileUrl, name, path]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width - 32)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let active = true;
    let renderingTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const element = canvas.current;
    const textElement = text.current;
    setRendering(true);
    const context: ReportContext = { numPages: pdf.numPages, zoom, containerWidth: width, step: "getPage" };
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (!active) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(width / original.width, 1.5) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
      Object.assign(context, { scale, ratio, canvasWidth: element.width, canvasHeight: element.height, step: "render" });
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      const paper = element.parentElement!;
      paper.style.width = `${viewport.width}px`;
      paper.style.height = `${viewport.height}px`;
      paper.style.setProperty("--scale-factor", String(scale));
      paper.style.setProperty("--total-scale-factor", String(scale * pdfPage.userUnit));
      textElement.replaceChildren();
      renderingTask = pdfPage.render({ canvas: element, viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await renderingTask.promise;
      if (!active) return;
      context.step = "textLayer";
      const content = await pdfPage.getTextContent();
      if (!active) return;
      textLayer = new TextLayer({ textContentSource: content, container: textElement, viewport });
      await textLayer.render();
      if (active) setRendering(false);
    })().catch((cause: unknown) => {
      if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
        reportViewerError("render", path, cause, page, context);
        setError("This page could not be rendered. You can still download the original PDF.");
      }
    });
    return () => { active = false; renderingTask?.cancel(); textLayer?.cancel(); };
  }, [path, pdf, page, width, zoom]);

  // After an account sign-in, open the PDF again with the new session.
  function reopen() {
    setError("");
    setFailure(null);
    setAttempt(value => value + 1);
  }

  function goToPage(value: number | null) {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, Math.trunc(value ?? page) || 1));
    setPage(next);
    setPageInput(next);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#page=${next}`);
    container.current?.scrollTo({ top: 0, left: 0 });
  }

  return <main className="pdf-viewer" aria-label="PDF viewer">
    <header className="pdf-viewer-header">
      <a className="pdf-viewer-back" href="/">← Wiki</a>
      <h1 title={path}>{name}</h1>
      {failure?.kind === "unavailable"
        // The download is the same restricted file; offer it once the PDF opens.
        ? <button type="button" className="pdf-viewer-download" disabled
          title={failure.account === "signed-in" ? "This PDF isn't available to your account" : "Sign in to download"}>Download</button>
        : <a className="pdf-viewer-download" href={`${fileUrl}&download=1`} download={name}>Download</a>}
    </header>
    <Toolbar className="pdf-viewer-toolbar" aria-label="PDF controls">
      <ToolbarGroup className="pdf-viewer-page-controls" aria-label="Page">
        <ToolbarButton aria-label="Previous page" disabled={!pdf || page <= 1} onClick={() => goToPage(page - 1)}>←</ToolbarButton>
        <NumberInput className="pdf-viewer-page-field" value={pageInput} min={1} max={pdf?.numPages ?? 1}
          format={{ useGrouping: false }} disabled={!pdf} onValueChange={setPageInput} onValueCommit={goToPage}>
          <label htmlFor="pdf-page">Page</label>
          <ToolbarInput render={<NumberInputControl id="pdf-page" aria-label="Page number" />} />
          <span>of {pdf?.numPages ?? "…"}</span>
        </NumberInput>
        <ToolbarButton aria-label="Next page" disabled={!pdf || page >= pdf.numPages} onClick={() => goToPage(page + 1)}>→</ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup className="pdf-viewer-zoom-controls" aria-label="Zoom">
        <ToolbarButton aria-label="Zoom out" disabled={!pdf || zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</ToolbarButton>
        <ToolbarButton className="pdf-viewer-fit" disabled={!pdf} onClick={() => setZoom(1)} aria-label="Fit page width">{zoom === 1 ? "Fit width" : `${Math.round(zoom * 100)}%`}</ToolbarButton>
        <ToolbarButton aria-label="Zoom in" disabled={!pdf || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}>+</ToolbarButton>
      </ToolbarGroup>
    </Toolbar>
    <div className="pdf-viewer-content" ref={container} tabIndex={0} aria-label="PDF page">
      {error ? <div className="pdf-viewer-message" role="alert" data-pdf-viewer-failure={failure?.kind === "unavailable" ? failure.account : failure?.kind}>
        {failure?.kind === "unavailable" && failure.account === "signed-out" ? <h2>Sign in to open this PDF</h2> : null}
        <p>{error}</p>
        <div className="pdf-viewer-actions">
          {failure?.kind === "unavailable" && failure.account === "signed-out"
            ? <Suspense fallback={null}><PdfViewerSignIn onSignedIn={reopen} /></Suspense>
            : null}
          {failure?.kind === "unavailable" && failure.account === "checking"
            ? null
            : <a href={`/${path.replace(/\.pdf$/i, "")}`}>Source page</a>}
          <a href="/">Back to the wiki</a>
        </div>
      </div> : null}
      {!error && !pdf ? <p className="pdf-viewer-message" role="status">Opening PDF…</p> : null}
      <div className="pdf-viewer-paper" hidden={!pdf || Boolean(error)} aria-busy={rendering}>
        <canvas ref={canvas} role="img" aria-label={`Page ${page}${pdf ? ` of ${pdf.numPages}` : ""}`} />
        <div ref={text} className="textLayer" />
      </div>
    </div>
    <span className="pdf-viewer-status" role="status" aria-live="polite">{pdf && !error ? `Page ${page} of ${pdf.numPages}${rendering ? ", rendering…" : ""}` : ""}</span>
  </main>;
}

export function PdfViewerPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const path = params.get("path");
  const version = params.get("v");
  if (!path || !/\.pdf$/i.test(path) || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part === ".")) {
    return <main className="pdf-viewer-message"><h1>Choose a PDF</h1><p>Open a PDF from the wiki file tree or a source page.</p><a href="/">Back to wiki</a></main>;
  }
  return <PdfDocument key={`${path}\0${version ?? ""}`} path={path} version={version && /^[\w-]{1,128}$/.test(version) ? version : null} />;
}
