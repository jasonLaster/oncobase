import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

function initialPage() {
  const page = Number(new URLSearchParams(window.location.hash.slice(1)).get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function PdfDocument({ path }: { path: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(page));
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(Math.max(240, window.innerWidth - 32));
  const [error, setError] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const [rendering, setRendering] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const name = path.split("/").at(-1) ?? "PDF";
  const fileUrl = `/api/file?path=${encodeURIComponent(path)}`;

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
      setPageInput(current => String(Math.min(Number(current), document.numPages)));
    }).catch((cause: unknown) => {
      if (!active) return;
      if (cause instanceof Error && cause.name === "InvalidPDFException") {
        setError("The stored file is not a valid PDF. Download the original or check its source page for a replacement.");
      } else {
        setShowSignIn(true);
        setError("This PDF could not be opened. It may require sign-in, or the file may be unavailable.");
      }
    });
    return () => { active = false; void task.destroy(); };
  }, [fileUrl, name]);

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
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (!active) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(width / original.width, 1.5) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
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
      const content = await pdfPage.getTextContent();
      if (!active) return;
      textLayer = new TextLayer({ textContentSource: content, container: textElement, viewport });
      await textLayer.render();
      if (active) setRendering(false);
    })().catch((cause: unknown) => {
      if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
        setError("This page could not be rendered. You can still download the original PDF.");
      }
    });
    return () => { active = false; renderingTask?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, width, zoom]);

  function goToPage(value: number) {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, Math.trunc(value) || 1));
    setPage(next);
    setPageInput(String(next));
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#page=${next}`);
    container.current?.scrollTo({ top: 0, left: 0 });
  }

  return <main className="pdf-viewer" aria-label="PDF viewer">
    <header className="pdf-viewer-header">
      <a className="pdf-viewer-back" href="/">← Wiki</a>
      <h1 title={path}>{name}</h1>
      <a className="pdf-viewer-download" href={`${fileUrl}&download=1`} download={name}>Download</a>
    </header>
    <div className="pdf-viewer-toolbar" aria-label="PDF controls">
      <div className="pdf-viewer-page-controls">
        <button aria-label="Previous page" disabled={!pdf || page <= 1} onClick={() => goToPage(page - 1)}>←</button>
        <form onSubmit={event => { event.preventDefault(); goToPage(Number(pageInput)); }}>
          <label htmlFor="pdf-page">Page</label>
          <input id="pdf-page" aria-label="Page number" inputMode="numeric" type="number" min="1" max={pdf?.numPages ?? 1}
            value={pageInput} disabled={!pdf} onChange={event => setPageInput(event.target.value)}
            onBlur={() => goToPage(Number(pageInput))} />
          <span>of {pdf?.numPages ?? "…"}</span>
        </form>
        <button aria-label="Next page" disabled={!pdf || page >= pdf.numPages} onClick={() => goToPage(page + 1)}>→</button>
      </div>
      <div className="pdf-viewer-zoom-controls">
        <button aria-label="Zoom out" disabled={!pdf || zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</button>
        <button className="pdf-viewer-fit" disabled={!pdf} onClick={() => setZoom(1)} aria-label="Fit page width">{zoom === 1 ? "Fit width" : `${Math.round(zoom * 100)}%`}</button>
        <button aria-label="Zoom in" disabled={!pdf || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}>+</button>
      </div>
    </div>
    <div className="pdf-viewer-content" ref={container} tabIndex={0} aria-label="PDF page">
      {error ? <div className="pdf-viewer-message" role="alert"><p>{error}</p>{showSignIn
        ? <a href={`/sign-in?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}>Sign in</a>
        : <a href={`/${path.replace(/\.pdf$/i, "")}`}>Source page</a>}</div> : null}
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
  const path = new URLSearchParams(search).get("path");
  if (!path || !/\.pdf$/i.test(path) || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part === ".")) {
    return <main className="pdf-viewer-message"><h1>Choose a PDF</h1><p>Open a PDF from the wiki file tree or a source page.</p><a href="/">Back to wiki</a></main>;
  }
  return <PdfDocument key={path} path={path} />;
}
