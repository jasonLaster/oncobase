import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@oncobase/ui/tabs";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";
import { AnatomicalContextDiagram } from "./AnatomicalContextDiagram";
import { B6CircleExplorer } from "./B6CircleExplorer";
import { BlocksAndValidationSection } from "./BlocksAndValidationSection";
import {
  BlockInspector,
  BreadloafView,
  BreastBlocksGrid2x3,
  TopDownView,
} from "./BreadloafAndTopDownViews";
import { CelDrawer } from "./controls";
import { ReconcileAndRcbSection } from "./ReconcileAndRcbSection";
import { adoptStyles } from "../../lazy-styles";
import { resetCellularityViewState, usePublishViewState } from "./view-state";
import type { CellularityData, FieldRef } from "./types";
import { CELLULARITY_DATA_URL, cellularityAssetUrl } from "./utils";
import cellularityCss from "./cellularity.css?inline";

adoptStyles("cellularity", cellularityCss);

const TumorModel3D = lazy(() =>
  import("./TumorModel3D").then((m) => ({ default: m.TumorModel3D })),
);

type BedMode = "webgl" | "3d" | "topdown" | "grid";

const BED_MODES: { value: BedMode; label: string }[] = [
  { value: "webgl", label: "3D Tumor Model" },
  { value: "3d", label: "Breadloaf Slices" },
  { value: "topdown", label: "2D Top-Down" },
  { value: "grid", label: "All Bed Blocks" },
];

function PageSliceStrip({
  data,
  activeBlock,
  onSelect,
}: {
  data: CellularityData;
  activeBlock: string;
  onSelect: (id: string) => void;
}) {
  const items = [
    ...data.slices.map((s) => ({ id: s.id, label: s.label, kind: s.kind, scanned: s.scanned })),
    ...data.report.specimen.extra_blocks.map((b) => ({ id: b.id, label: b.label, kind: "keratin" as const, scanned: true })),
  ];
  return (
    <ToggleGroup
      className="cel-slice-strip"
      aria-label="Inspect block"
      value={[activeBlock]}
      onValueChange={(next) => {
        if (next[0]) onSelect(next[0]);
      }}
    >
      {items.map((it) => {
        const swColor = !it.scanned ? "#bdb9ae" : it.kind === "virtual" ? "#2563eb" : "#d9481f";
        return (
          <Toggle
            key={it.id}
            value={it.id}
            className={`cel-slice-btn${!it.scanned ? " unscanned" : ""}`}
          >
            <span className="cel-swatch" style={{ background: swColor }} />
            {it.label}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}

export function CellularityPage() {
  const [data, setData] = useState<CellularityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  // Linked brushing: a 1 mm field hovered in the 3D model or the 2D inspector.
  const [hoverField, setHoverField] = useState<FieldRef | null>(null);
  /** Field whose slide image is open in the inspector (clicked in 2D or 3D). */
  const [pinnedField, setPinnedField] = useState<FieldRef | null>(null);
  const [bedMode, setBedMode] = useState<BedMode>("webgl");
  const [allDrawersOpen, setAllDrawersOpen] = useState(false);
  usePublishViewState("view", bedMode);
  usePublishViewState("selectedBlock", selectedBlock ?? data?.report.specimen.focus_block);
  useEffect(() => resetCellularityViewState, []);

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
        <Toggle
          className="cel-btn-ghost"
          aria-label="Expand all details"
          pressed={allDrawersOpen}
          onPressedChange={setAllDrawersOpen}
        >
          {allDrawersOpen ? "Collapse all details" : "Expand all details"}
        </Toggle>
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
      <Tabs<BedMode>
        render={<section id="bed" className="cel-section" />}
        value={bedMode}
        onValueChange={(next) => {
          if (next) setBedMode(next);
        }}
      >
        <div className="cel-sec-head">
          <div>
            <h2>{specimen.section_title}</h2>
            <p>{specimen.section_subtitle}</p>
          </div>
          <TabsList className="cel-seg" aria-label="Tumor bed view">
            {BED_MODES.map((mode) => (
              <TabsTab key={mode.value} value={mode.value}>
                {mode.label}
              </TabsTab>
            ))}
          </TabsList>
        </div>

        <AnatomicalContextDiagram
          data={data}
          selectedBlock={activeBlock}
          onSelectBlock={setSelectedBlock}
        />

        <div className="cel-bed-layout">
          <div className="cel-card">
            <TabsPanel value="webgl" className="cel-bed-panel">
              <Suspense fallback={<div className="cel-webgl-wrap" style={{ display: "grid", placeItems: "center", color: "#5b5953" }}>Loading 3D WebGL model…</div>}>
                <TumorModel3D data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} hoverField={hoverField} onHoverField={setHoverField} onPinField={setPinnedField} />
              </Suspense>
            </TabsPanel>
            <TabsPanel value="3d" className="cel-bed-panel">
              <BreadloafView data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            </TabsPanel>
            <TabsPanel value="topdown" className="cel-bed-panel">
              <TopDownView data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            </TabsPanel>
            <TabsPanel value="grid" className="cel-bed-panel">
              <BreastBlocksGrid2x3 data={data} selectedBlock={activeBlock} onSelectBlock={setSelectedBlock} />
            </TabsPanel>

            {/* The 3D model has its own thumbnail strip, linked to the scene. */}
            {bedMode !== "webgl" ? <PageSliceStrip data={data} activeBlock={activeBlock} onSelect={setSelectedBlock} /> : null}

            {/* The 3D model carries its own legend. */}
            {bedMode !== "webgl" ? (
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
            ) : null}

            <p className="cel-footnote">
              <strong>Anatomical orientation &amp; 3D interpolation note:</strong> {specimen.orientation_note}
            </p>
          </div>

          <BlockInspector
            data={data}
            selectedBlock={activeBlock}
            hoverField={hoverField}
            onHoverField={setHoverField}
            pinnedField={pinnedField}
            onPinField={setPinnedField}
          />
        </div>

        <div className="cel-drawers">
          <CelDrawer title={specimen.ink_drawer.title} meta={specimen.ink_drawer.meta} allOpen={allDrawersOpen}>
            <p>{specimen.ink_drawer.body}</p>
            <img className="cel-fig-img" src={cellularityAssetUrl(specimen.ink_drawer.img)} alt="Ink-aligned whole-slide thumbnails" loading="lazy" />
          </CelDrawer>
        </div>
      </Tabs>

      <B6CircleExplorer data={data} allDrawersOpen={allDrawersOpen} />
      <BlocksAndValidationSection data={data} onJumpToBlock={handleJumpToBlock} allDrawersOpen={allDrawersOpen} />
      <ReconcileAndRcbSection data={data} />

      <footer style={{ marginTop: 32, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
        {header.footer_note}
      </footer>
    </article>
  );
}
