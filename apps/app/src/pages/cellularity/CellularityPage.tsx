import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";
import { AnatomicalContextDiagram } from "./AnatomicalContextDiagram";
import { B6CircleExplorer } from "./B6CircleExplorer";
import { BlocksAndValidationSection } from "./BlocksAndValidationSection";
import {
  BlockInspector,
  BreadloafView,
  BreastBlocksGrid2x3,
  TopDownView,
} from "./BreadloafAndTopDownViews";
import { ReconcileAndRcbSection } from "./ReconcileAndRcbSection";
import { adoptStyles } from "../../lazy-styles";
import type { CellularityData } from "./types";
import { CELLULARITY_DATA_URL, cellularityAssetUrl } from "./utils";
import cellularityCss from "./cellularity.css?inline";

adoptStyles("cellularity", cellularityCss);

const TumorModel3D = lazy(() =>
  import("./TumorModel3D").then((m) => ({ default: m.TumorModel3D })),
);

type BedMode = "webgl" | "3d" | "topdown" | "grid";

export function CellularityPage() {
  const [data, setData] = useState<CellularityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [bedMode, setBedMode] = useState<BedMode>("webgl");
  const [allDrawersOpen, setAllDrawersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(CELLULARITY_DATA_URL, { cache: "no-store" })
      .then((res) => {
        if (res.status === 404) {
          throw new Error("No tumor-bed cellularity dataset has been published for this site yet.");
        }
        if (!res.ok) throw new Error(`Failed to load cellularity data (${res.status})`);
        return res.json() as Promise<CellularityData>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load cellularity data");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <article className="cel-page" data-test-id="cellularity-page">
        <div className="cel-card">
          <h1 className="cel-h1" style={{ fontSize: 22 }}>Tumor-bed cellularity explorer</h1>
          <p style={{ color: "var(--text-muted)" }}>{error}</p>
        </div>
      </article>
    );
  }

  if (!data) {
    return (
      <article className="cel-page" data-test-id="cellularity-page">
        <div className="cel-card" style={{ padding: 28, color: "var(--text-muted)" }}>
          Loading tumor-bed cellularity data and 3D meshes…
        </div>
      </article>
    );
  }

  const { header, specimen } = data.report;
  const activeBlock = selectedBlock ?? specimen.focus_block;

  const sliceButtons = [
    ...data.slices.map((s) => ({ id: s.id, label: s.label, kind: s.kind, scanned: s.scanned })),
    ...specimen.extra_blocks.map((b) => ({
      id: b.id,
      label: b.label,
      kind: "keratin" as const,
      scanned: true,
    })),
  ];

  const handleJumpToBlock = (id: string) => {
    setSelectedBlock(id);
    document.getElementById("bed")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <article className="cel-page" data-test-id="cellularity-page">
      <nav className="cel-subnav" aria-label="Cellularity sections">
        <div className="cel-subnav-links">
          <a href="#summary">Summary</a>
          <a href="#bed">3D Tumor &amp; Bed</a>
          <a href="#focus">{header.nav_focus_label}</a>
          <a href="#blocks">All Blocks</a>
          <a href="#reconcile">Reconcile &amp; RCB</a>
          {header.report_link ? (
            <Link to={header.report_link.to}>{header.report_link.label}</Link>
          ) : null}
        </div>
        <button
          type="button"
          className="cel-btn-ghost"
          onClick={() => setAllDrawersOpen((open) => !open)}
        >
          {allDrawersOpen ? "Collapse all details" : "Expand all details"}
        </button>
      </nav>

      {/* HERO / EXECUTIVE SUMMARY */}
      <section id="summary" className="cel-section">
        <div className="cel-eyebrow">{header.eyebrow}</div>
        <h1 className="cel-h1">{header.title}</h1>
        <p className="cel-subtitle">{header.subtitle}</p>

        <div className="cel-pills">
          {header.pills.map((pill) => (
            <span key={pill.text} className={`cel-pill${pill.tone ? ` ${pill.tone}` : ""}`}>
              {pill.text}
            </span>
          ))}
        </div>

        <div className="cel-answer-grid">
          {header.summary_cards.map((card) => (
            <div key={card.source} className="cel-card">
              <div className="cel-kicker">
                <span className="cel-source-lbl">{card.source}</span>
                <span className={`cel-badge ${card.badge_tone}`}>{card.badge}</span>
              </div>
              <div className="cel-big-stat cel-num">
                {card.stat} <small>{card.unit}</small>
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)" }}>
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 1: TWO-SCALE CONTEXT + 3D TUMOR MODEL / BREADLOAF / TOP-DOWN + INSPECTOR */}
      <section id="bed" className="cel-section">
        <div className="cel-sec-head">
          <div>
            <h2>{specimen.section_title}</h2>
            <p>{specimen.section_subtitle}</p>
          </div>
          <div className="cel-seg">
            <button type="button" className={bedMode === "webgl" ? "active" : ""} onClick={() => setBedMode("webgl")}>3D Tumor Model</button>
            <button type="button" className={bedMode === "3d" ? "active" : ""} onClick={() => setBedMode("3d")}>Breadloaf Slices</button>
            <button type="button" className={bedMode === "topdown" ? "active" : ""} onClick={() => setBedMode("topdown")}>2D Top-Down</button>
            <button type="button" className={bedMode === "grid" ? "active" : ""} onClick={() => setBedMode("grid")}>All Bed Blocks</button>
          </div>
        </div>

        <AnatomicalContextDiagram
          data={data}
          selectedBlock={activeBlock}
          onSelectBlock={setSelectedBlock}
        />

        <div className="cel-bed-layout">
          <div className="cel-card">
            {bedMode === "webgl" ? (
              <Suspense fallback={<div className="cel-webgl-wrap" style={{ display: "grid", placeItems: "center", color: "#5b5953" }}>Loading 3D WebGL model…</div>}>
                <TumorModel3D data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
              </Suspense>
            ) : null}
            {bedMode === "3d" ? (
              <BreadloafView data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            ) : null}
            {bedMode === "topdown" ? (
              <TopDownView data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            ) : null}
            {bedMode === "grid" ? (
              <BreastBlocksGrid2x3 data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            ) : null}

            <div className="cel-slice-strip">
              {sliceButtons.map((it) => {
                const swColor = !it.scanned ? "#bdb9ae" : it.kind === "virtual" ? "#2563eb" : "#d9481f";
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`cel-slice-btn${it.id === activeBlock ? " active" : ""}${!it.scanned ? " unscanned" : ""}`}
                    onClick={() => setSelectedBlock(it.id)}
                  >
                    <span className="cel-swatch" style={{ background: swColor }} />
                    {it.label}
                  </button>
                );
              })}
            </div>

            <div className="cel-legend-row">
              <div>
                <span>0%</span>
                <span className="cel-colorbar-grad" />
                <span>33% keratin area (compressed scale so 1–5% stays visible)</span>
              </div>
              <div>
                <span style={{ display: "inline-block", width: 10, height: 10, border: "1.5px solid currentColor", borderRadius: 2, verticalAlign: -1 }} /> {specimen.legend_real_label}
                &nbsp;·&nbsp;
                <span style={{ display: "inline-block", width: 10, height: 10, border: "1.5px dashed #2563eb", borderRadius: 2, verticalAlign: -1 }} /> {specimen.legend_virtual_label}
              </div>
            </div>

            <p className="cel-footnote">
              <strong>Anatomical orientation &amp; 3D interpolation note:</strong> {specimen.orientation_note}
            </p>
          </div>

          <BlockInspector data={data} selectedBlock={activeBlock} />
        </div>

        <div className="cel-drawers">
          <details className="cel-drawer" open={allDrawersOpen || undefined}>
            <summary>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span className="cel-chev">▶</span> {specimen.ink_drawer.title}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{specimen.ink_drawer.meta}</span>
            </summary>
            <div className="cel-drawer-body">
              <p>{specimen.ink_drawer.body}</p>
              <img className="cel-fig-img" src={cellularityAssetUrl(specimen.ink_drawer.img)} alt="Ink-aligned whole-slide thumbnails" loading="lazy" />
            </div>
          </details>
        </div>
      </section>

      <B6CircleExplorer data={data} allDrawersOpen={allDrawersOpen} />
      <BlocksAndValidationSection data={data} onJumpToBlock={handleJumpToBlock} allDrawersOpen={allDrawersOpen} />
      <ReconcileAndRcbSection data={data} />

      <footer style={{ marginTop: 32, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
        {header.footer_note}
      </footer>
    </article>
  );
}
