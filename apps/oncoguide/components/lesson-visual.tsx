"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";

/** A cartoon, diagram or table exactly as its lesson shows it. Typed chat and
 * the Talk board both render visuals through this, from the visual catalog. */
export type ShownVisual = { kind: "cartoon" | "diagram" | "table"; alt: string; src?: string; darkSrc?: string; fragment?: string };

// Only markup files written by the content build. Never a path a reply supplies.
const FRAGMENT_PATH = /^\/visuals\/[a-f0-9]{16}\.json$/;
const loaded = new Map<string, Promise<string>>();
function loadFragment(path: string): Promise<string> {
  let pending = loaded.get(path);
  if (!pending) {
    pending = fetch(path).then(async response => {
      const body = response.ok ? await response.json() as { html?: unknown } : null;
      if (typeof body?.html !== "string") throw Error("Visual unavailable");
      return body.html;
    });
    pending.catch(() => loaded.delete(path));
    loaded.set(path, pending);
  }
  return pending;
}

export function LessonVisual({ visual }: { visual: ShownVisual }) {
  const path = visual.kind !== "cartoon" && FRAGMENT_PATH.test(visual.fragment ?? "") ? visual.fragment! : null;
  const [markup, setMarkup] = useState<{ path: string; html: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let current = true;
    loadFragment(path).then(html => { if (current) setMarkup({ path, html }); }, () => { if (current) setMarkup({ path, html: null }); });
    return () => { current = false; };
  }, [path]);
  if (visual.kind === "cartoon") {
    if (!visual.src) return null;
    const image = (src: string, className?: string) => <img src={src} alt={visual.alt} loading="lazy" className={className} data-theater-image role="button" tabIndex={0} aria-label={`Enlarge: ${visual.alt}`} />;
    return visual.darkSrc ? <>{image(visual.src, "dark:hidden")}{image(visual.darkSrc, "hidden dark:block")}</> : image(visual.src);
  }
  const ready = markup && markup.path === path ? markup : null;
  if (!path || (ready && ready.html === null)) return <p className="edu-visual-missing">This {visual.kind} couldn’t load. Open the lesson to see it.</p>;
  if (!ready) return <div className="edu-visual-loading" role="status" aria-label={`Loading ${visual.kind}`} />;
  // The same first-party HTML the lesson renders. Models choose an id, never markup.
  return <div className="wiki-markdown" dangerouslySetInnerHTML={{ __html: ready.html! }} />;
}

/** Opens a diagram or table at full size. Cartoons already open in the image
 * viewer when clicked, so they need no button. */
export function VisualZoom({ visual, title }: { visual: ShownVisual; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  if (visual.kind === "cartoon") return null;
  return <>
    <button type="button" className="edu-visual-action" onClick={() => { setOpen(true); dialog.current?.showModal(); }}><Maximize2 size={13} aria-hidden="true" />Enlarge</button>
    <dialog ref={dialog} className="edu-visual-dialog" aria-label={title} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="edu-visual-dialog-body">
        <header><strong>{title}</strong><button type="button" onClick={() => dialog.current?.close()} aria-label="Close enlarged view"><X size={16} aria-hidden="true" /></button></header>
        {open ? <LessonVisual visual={visual} /> : null}
      </div>
    </dialog>
  </>;
}
