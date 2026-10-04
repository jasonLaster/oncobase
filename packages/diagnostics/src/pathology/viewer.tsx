import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Columns2, Copy, Expand, Hand, Home, Minus, Plus, RotateCw, Ruler, Save, Square, Trash2, Undo2, X } from "lucide-react";
import useSWR from "swr";
import { formatLength, readCamera, regionLengthMicrons, type PathologyRegion, type PathologySlide, type SlideCamera } from "./model";
import { SlideCanvas, type SlideControls, type SlideTool } from "./slide-canvas";
import "./styles.css";

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Slide request failed (${response.status})`);
  return response.json();
}
interface Draft { regions: PathologyRegion[]; version: number; dirty: boolean; history: PathologyRegion[][] }

export function PathologyViewer() {
  const { data, error, mutate } = useSWR<{ slides: PathologySlide[] }>("/api/pathology/slides", json, { revalidateOnFocus: false });
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [slideId, setSlideId] = useState(() => params.get("slide"));
  const [compareId, setCompareId] = useState(() => params.get("compare"));
  const initialCamera = readCamera(params);
  const [tool, setTool] = useState<SlideTool>("pan");
  const [selectedRegion, setSelectedRegion] = useState(() => params.get("region") ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, "idle" | "saving" | "error" | "conflict">>({});
  const [shareStatus, setShareStatus] = useState("");
  const [regionsVisible, setRegionsVisible] = useState(true);
  const [linked, setLinked] = useState(false);
  const primary = useRef<SlideControls | null>(null), comparison = useRef<SlideControls | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const slides = data?.slides ?? [];
  const slide = slides.find(s => s.slideId === slideId) ?? slides[0];
  const missingSlide = Boolean(data && slideId && !slides.some(s => s.slideId === slideId));
  const compare = slides.find(s => s.slideId === compareId && s.slideId !== slide?.slideId);
  const notesUrl = slide ? `/api/pathology/slides/${slide.slideId}/regions` : null;
  const { data: notes, error: notesError, mutate: reloadNotes } = useSWR<{ regions: PathologyRegion[]; version: number }>(notesUrl, json, { revalidateOnFocus: false });
  const draft = slide ? drafts[slide.slideId] : undefined;
  const saveState = slide ? saveStates[slide.slideId] ?? "idle" : "idle";
  const regions = draft?.regions ?? notes?.regions ?? [];
  const region = regions.find(r => r.id === selectedRegion);
  const dirty = Object.values(drafts).some(d => d.dirty);

  useEffect(() => {
    const update = () => {
      const next = new URLSearchParams(window.location.search);
      setSlideId(next.get("slide")); setCompareId(next.get("compare"));
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function navigate(id: string, compareNext = compareId) {
    setSlideId(id); setCompareId(compareNext); setSelectedRegion(""); setTool("pan");
    const url = new URL(window.location.href);
    url.search = ""; url.searchParams.set("slide", id);
    if (compareNext && compareNext !== id) url.searchParams.set("compare", compareNext);
    window.history.pushState(null, "", url);
  }
  function setSaveState(value: "idle" | "saving" | "error" | "conflict") {
    if (slide) setSaveStates(previous => ({ ...previous, [slide.slideId]: value }));
  }
  function edit(next: PathologyRegion[]) {
    if (!slide || (!notes && !draft) || notesError) return;
    setDrafts(previous => ({ ...previous, [slide.slideId]: { regions: next, version: draft?.version ?? notes?.version ?? 0,
      dirty: true, history: [...(draft?.history ?? []), regions].slice(-20) } }));
    setSaveState("idle");
  }
  function undo() {
    if (!slide || !draft?.history.length) return;
    const history = draft.history.slice(0, -1);
    setDrafts(previous => ({ ...previous, [slide.slideId]: { ...draft, regions: draft.history[draft.history.length - 1], history, dirty: true } }));
  }
  async function save() {
    if (!slide || !draft?.dirty) return;
    const id = slide.slideId, saved = draft.regions;
    setSaveState("saving");
    try {
      const response = await fetch(`/api/pathology/slides/${id}/regions`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSha256: slide.sourceSha256, expectedVersion: draft.version, regions: saved }) });
      if (response.status === 409) { setSaveState("conflict"); return; }
      if (!response.ok) throw new Error("Save unavailable");
      const result = await response.json() as { version: number };
      setDrafts(previous => ({ ...previous, [id]: { ...previous[id], version: result.version, dirty: previous[id].regions !== saved } }));
      setSaveState("idle");
    } catch { setSaveState("error"); }
  }
  async function share() {
    if (!slide) return;
    const camera = primary.current?.camera();
    const url = new URL(window.location.href); url.search = ""; url.searchParams.set("slide", slide.slideId);
    if (compare) url.searchParams.set("compare", compare.slideId);
    if (selectedRegion && !draft?.dirty) url.searchParams.set("region", selectedRegion);
    if (camera) for (const [key, value] of Object.entries(camera)) url.searchParams.set(key, value.toFixed(6));
    window.history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url.href); setShareStatus("View link copied"); }
    catch { setShareStatus("Copy this view’s URL from the address bar"); }
  }
  const button = (label: string, action: () => void, icon: React.ReactNode, active = false, disabled = false) =>
    <button type="button" title={label} aria-label={label} aria-pressed={["Pan", "Draw region", "Measure"].includes(label) ? active : undefined} onClick={action} disabled={disabled}>{icon}</button>;
  const index = slides.findIndex(s => s.slideId === slide?.slideId);

  return <div className="pathology-workspace" ref={workspace} data-test-id="pathology-workspace">
    <header className="pathology-header">
      <a href="/diagnostics/imaging" className="pathology-back" aria-label="Back to imaging"><ArrowLeft size={18} /><span>Imaging</span></a>
      <div className="pathology-heading"><span className="pathology-eyebrow">Digital pathology</span><h1>H&E slides</h1></div>
      <div className="pathology-header-actions">
        {button("Copy current view link", () => void share(), <Copy size={18} />)}
        {button("Full screen", () => { if (document.fullscreenElement) void document.exitFullscreen(); else void workspace.current?.requestFullscreen(); }, <Expand size={18} />)}
        <span role="status" className="pathology-share-status">{shareStatus}</span>
      </div>
    </header>
    {error ? <div className="pathology-empty" role="alert"><h2>Slides could not load</h2><p>Check your connection or sign in again.</p><button onClick={() => void mutate()}>Retry</button><a href="/sign-in">Sign in</a></div>
      : !data ? <div className="pathology-empty" role="status">Loading slide collection…</div>
      : missingSlide ? <div className="pathology-empty" role="alert"><h2>This slide is unavailable</h2><p>The shared slide is not in this collection.</p>{slides[0] && <button onClick={() => navigate(slides[0].slideId)}>Open slide collection</button>}</div>
      : !slide ? <div className="pathology-empty"><h2>No slides available</h2><p>Prepared H&E slides will appear here.</p></div>
      : <div className="pathology-layout">
        <aside className="pathology-slide-rail" aria-label="Slide collection">
          <div className="pathology-rail-title"><h2>Slides</h2><span>{slides.length}</span></div>
          <div className="pathology-slide-list">{slides.map((s, i) => <button key={s.slideId} className={`pathology-slide-card ${slide.slideId === s.slideId ? "is-selected" : ""}`}
            onClick={() => navigate(s.slideId)} aria-pressed={slide.slideId === s.slideId} data-test-id="pathology-slide-card">
            <img src={`/api/pathology/slides/${s.slideId}/thumbnail`} alt={`Tissue overview for ${s.label}`} loading="lazy" />
            <span><strong>{s.label}</strong><small>{s.stain} · {s.objectivePower ? `${s.objectivePower}× scan` : "Whole slide"}{drafts[s.slideId]?.dirty ? " · unsaved notes" : ""}</small></span><b>{i + 1}</b>
          </button>)}</div>
          <details className="pathology-details"><summary>Slide information</summary><dl>
            <dt>Accession</dt><dd>{slide.accession ?? "Not supplied"}</dd><dt>Stain</dt><dd>{slide.stain}</dd>
            <dt>Scanned</dt><dd>{slide.scanDate ?? "Not supplied"}</dd><dt>Scanner</dt><dd>{slide.scanner}</dd>
            <dt>Size</dt><dd>{slide.width.toLocaleString()} × {slide.height.toLocaleString()} px</dd>
            <dt>Pixel size</dt><dd>{slide.mppX && slide.mppY ? `${slide.mppX} × ${slide.mppY} µm` : "Not calibrated"}</dd>
            <dt>Color</dt><dd>{slide.colorProfile}</dd><dt>Source file</dt><dd>{slide.sourceFileName}</dd>
            <dt>Source SHA-256</dt><dd className="pathology-hash">{slide.sourceSha256}</dd>
          </dl><p>Specimen site and collection date have not been supplied.</p></details>
          <details className="pathology-help"><summary>Navigation help</summary><p>Drag to pan. Scroll or pinch to zoom. Double-click to zoom in. Click the overview navigator to move through the tissue.</p><p>With the slide focused: + / − zoom, 0 fits tissue, R rotates, arrow keys pan. Regions and measurements are saved in original image coordinates.</p></details>
        </aside>
        <section className="pathology-review" aria-label="Slide review">
          <div className="pathology-toolbar" role="toolbar" aria-label="Slide tools">
            <div className="pathology-tool-group">
              {button("Previous slide", () => navigate(slides[index - 1].slideId), <ChevronLeft size={18} />, false, index <= 0)}
              <span className="pathology-slide-counter">{index + 1} / {slides.length}</span>
              {button("Next slide", () => navigate(slides[index + 1].slideId), <ChevronRight size={18} />, false, index >= slides.length - 1)}
            </div>
            <div className="pathology-tool-group">
              {button("Pan", () => setTool("pan"), <Hand size={18} />, tool === "pan")}
              {button("Draw region", () => setTool(tool === "region" ? "pan" : "region"), <Square size={18} />, tool === "region", !notes && !draft || Boolean(notesError))}
              {button("Measure", () => setTool(tool === "ruler" ? "pan" : "ruler"), <Ruler size={18} />, tool === "ruler", !slide.mppX || !slide.mppY || !notes && !draft || Boolean(notesError))}
              {button("Undo annotation edit", undo, <Undo2 size={18} />, false, !draft?.history.length)}
              {button("Rotate 90 degrees", () => primary.current?.rotate(), <RotateCw size={18} />)}
            </div>
            <div className="pathology-tool-group">
              {button("Fit tissue", () => primary.current?.home(), <Home size={18} />)}
              {button("Zoom out", () => primary.current?.zoom(1 / 1.5), <Minus size={18} />)}
              {button("Zoom in", () => primary.current?.zoom(1.5), <Plus size={18} />)}
              {[2, 5, 10, 20, 40].filter(power => slide.objectivePower && power <= slide.objectivePower).map(power => <button key={power} onClick={() => primary.current?.magnify(power)} aria-label={`${power}× magnification`}>{power}×</button>)}
            </div>
            <label className="pathology-compare-label"><Columns2 size={16} /><span>Compare</span><select aria-label="Compare with slide" value={compare?.slideId ?? ""}
              onChange={event => { setCompareId(event.target.value || null); const url = new URL(window.location.href); if (event.target.value) url.searchParams.set("compare", event.target.value); else url.searchParams.delete("compare"); window.history.replaceState(null, "", url); }}>
              <option value="">Single slide</option>{slides.filter(s => s.slideId !== slide.slideId).map(s => <option key={s.slideId} value={s.slideId}>{s.label}</option>)}
            </select></label>
          </div>
          {tool !== "pan" && <div className="pathology-tool-hint" role="status">{tool === "region" ? "Drag a box around a region of interest." : "Drag between two points to measure distance."} <button onClick={() => setTool("pan")}>Return to pan</button></div>}
          {compare && <div className="pathology-comparison-tools"><span>{slide.label} ↔ {compare.label}</span><label><input type="checkbox" checked={linked} onChange={event => setLinked(event.target.checked)} /> Link magnification</label><span>Pan independently; slides are not registered.</span>
            <button onClick={() => navigate(compare.slideId, slide.slideId)}>Swap slides</button>{button("Close comparison", () => navigate(slide.slideId, null), <X size={16} />)}</div>}
          <div className={`pathology-viewports ${compare ? "is-comparing" : ""}`}>
            <SlideCanvas key={slide.slideId} slide={slide} title={slide.label} controlsRef={primary} tool={tool}
              regions={regionsVisible ? regions : []} selectedRegion={selectedRegion} initialCamera={slide.slideId === params.get("slide") ? initialCamera : null}
              onRegion={newRegion => { edit([...regions, newRegion]); setSelectedRegion(newRegion.id); setTool("pan"); }}
              onCamera={camera => { if (linked && compare?.objectivePower && slide.objectivePower) comparison.current?.magnify(camera.zoom * slide.objectivePower); }}
              onRendered={() => {
                const url = new URL(window.location.href);
                if (region && url.searchParams.get("region") === region.id && !readCamera(url.searchParams)) {
                  primary.current?.focus(region);
                  url.searchParams.delete("region"); window.history.replaceState(null, "", url);
                }
              }} />
            {compare && <div className="pathology-compare-pane"><div className="pathology-compare-pane-tools">
              {button("Fit comparison tissue", () => comparison.current?.home(), <Home size={16} />)}
              {button("Zoom comparison out", () => comparison.current?.zoom(1 / 1.5), <Minus size={16} />)}
              {button("Zoom comparison in", () => comparison.current?.zoom(1.5), <Plus size={16} />)}
              {button("Rotate comparison", () => comparison.current?.rotate(), <RotateCw size={16} />)}
            </div><SlideCanvas key={compare.slideId} slide={compare} title={compare.label} controlsRef={comparison} /></div>}
          </div>
          <footer className="pathology-review-footer"><span>{slide.stain} · {slide.objectivePower ? `${slide.objectivePower}× acquisition` : "Whole-slide scan"}</span><span>Drag to pan · scroll to zoom</span><span>{slide.mppX && slide.mppY ? "Scale from scanner calibration" : "Uncalibrated image"}</span></footer>
        </section>
        <aside className="pathology-notes" aria-label="Regions and notes">
          <div className="pathology-rail-title"><h2>Regions & notes</h2><span>{regions.length}</span></div>
          <div className="pathology-note-controls"><label><input type="checkbox" checked={regionsVisible} onChange={event => setRegionsVisible(event.target.checked)} /> Show on slide</label>
            <button onClick={() => void save()} disabled={!draft?.dirty || saveState === "saving" || Boolean(notesError)} data-test-id="pathology-save-notes"><Save size={15} />{saveState === "saving" ? "Saving…" : "Save"}</button></div>
          <p className="pathology-save-state" role="status">{saveState === "error" ? "Save failed. Your edits are still here; retry Save." : saveState === "conflict" ? "Another reviewer changed these notes. Your draft is preserved; copy your changes before loading their version." : draft?.dirty ? "Unsaved changes" : notes || draft ? "All changes saved" : "Loading notes…"}</p>
          {saveState === "conflict" && <button onClick={async () => { const result = await reloadNotes(); if (result) { setDrafts(previous => ({ ...previous, [slide.slideId]: { regions: result.regions, version: result.version, dirty: false, history: [regions] } })); setSaveState("idle"); } }}>Load latest notes</button>}
          {notesError && <p role="alert">Notes could not load. <button onClick={() => void reloadNotes()}>Retry</button></p>}
          {!regions.length && <div className="pathology-notes-empty"><Square size={22} /><p>Mark a region or take a measurement, then add a note.</p><button onClick={() => setTool("region")} disabled={!notes}>Draw a region</button></div>}
          <ol className="pathology-region-list">{regions.map((r, i) => <li key={r.id}><button className={selectedRegion === r.id ? "is-selected" : ""} onClick={() => { setSelectedRegion(r.id); primary.current?.focus(r); }}>
            <span className="pathology-region-number" style={{ borderColor: r.color }}>{i + 1}</span><span><strong>{r.label}</strong><small>{r.kind === "ruler" && regionLengthMicrons(r, slide) !== null ? formatLength(regionLengthMicrons(r, slide)!) : r.note || "Region of interest"}</small></span>
          </button></li>)}</ol>
          {region && <div className="pathology-region-editor"><label>Label<input aria-label="Region label" value={region.label} maxLength={160} onChange={event => edit(regions.map(r => r.id === region.id ? { ...r, label: event.target.value } : r))} /></label>
            <label>Note<textarea aria-label="Region note" value={region.note} maxLength={4000} rows={5} onChange={event => edit(regions.map(r => r.id === region.id ? { ...r, note: event.target.value } : r))} placeholder="Describe what you want to review…" /></label>
            <label>Color<input type="color" aria-label="Region color" value={region.color} onChange={event => edit(regions.map(r => r.id === region.id ? { ...r, color: event.target.value } : r))} /></label>
            <button onClick={() => { edit(regions.filter(r => r.id !== region.id)); setSelectedRegion(""); }}><Trash2 size={15} /> Delete region</button>
          </div>}
        </aside>
      </div>}
  </div>;
}
