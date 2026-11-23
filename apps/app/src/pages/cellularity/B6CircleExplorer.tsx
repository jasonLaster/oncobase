import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@oncobase/ui/tabs";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";
import { CelDrawer, CelSlider } from "./controls";
import type { CellularityData } from "./types";
import { cellularityAssetUrl, draw2DGrid } from "./utils";

type Props = {
  data: CellularityData;
  allDrawersOpen: boolean;
};

export function B6CircleExplorer({ data, allDrawersOpen }: Props) {
  const b6C = data.b6_cum;
  const cfg = data.report.focus_explorer;
  const [k, setK] = useState(cfg.default_k);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sliderVal = Math.round((1000 * Math.log(Math.max(1, k))) / Math.log(b6C.total));
  const sliderToK = (v: number) =>
    Math.max(1, Math.min(b6C.total, Math.round(Math.pow(b6C.total, v / 1000))));
  const activePreset = cfg.presets.find((p) => Math.abs(p.k - k) <= (p.k > 20 ? 3 : 0));
  const idx = Math.max(0, Math.min(b6C.total - 1, k - 1));
  const area = b6C.area[idx];
  const nlo = b6C.nlo[idx];
  const nmid = b6C.nmid[idx];
  const nhi = b6C.nhi[idx];

  const verdict = useMemo(() => {
    const match = cfg.verdicts.find((v) => k <= v.max_k);
    return match?.text ?? cfg.verdicts[cfg.verdicts.length - 1]?.text ?? "";
  }, [cfg.verdicts, k]);

  useEffect(() => {
    const g = data.grids[cfg.block_id];
    if (!canvasRef.current || !g) return;
    const hl = new Set<string>();
    for (let i = 0; i < k && i < b6C.order.length; i++) {
      const [c, r] = b6C.order[i];
      hl.add(`${c},${r}`);
    }
    draw2DGrid(canvasRef.current, g, { showBed: false, showNums: true, highlightSet: hl });
  }, [data, cfg.block_id, k, b6C.order]);

  const W = 640, H = 275, pL = 44, pR = 22, pT = 22, pB = 42;
  const x = (v: number) => pL + (Math.log(v) / Math.log(Math.max(300, b6C.total))) * (W - pL - pR);
  const y = (v: number) => pT + (1 - Math.min(65, Math.max(0, v)) / 65) * (H - pT - pB);

  const pts = (vals: readonly number[]) => vals.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`);
  const areaPts = pts(b6C.area).join(" ");
  const nmidPts = pts(b6C.nmid).join(" ");
  const bandPoly = pts(b6C.nhi).concat(pts(b6C.nlo).reverse()).join(" ");

  const f = data.f33;

  return (
    <section id="focus" className="cel-section">
      <div className="cel-sec-head">
        <div>
          <h2>{cfg.section_title}</h2>
          <p>{cfg.section_subtitle}</p>
        </div>
      </div>

      <div className="cel-card">
        <ToggleGroup
          className="cel-preset-row"
          aria-label="Circled area presets"
          value={activePreset ? [String(activePreset.k)] : []}
          onValueChange={(next) => {
            const preset = cfg.presets.find((p) => String(p.k) === next[0]);
            if (preset) setK(preset.k);
          }}
        >
          {cfg.presets.map((p) => (
            <Toggle key={p.k} value={String(p.k)} className="cel-preset-btn">
              {p.label}
            </Toggle>
          ))}
        </ToggleGroup>

        <div className="cel-b6-grid">
          <div>
            <div className="cel-slider-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13.5 }}>{cfg.slider_title}</strong>
                <span className="cel-num" style={{ fontSize: 14, fontWeight: 700 }}>
                  {k} mm² ({k} field{k > 1 ? "s" : ""})
                </span>
              </div>
              <CelSlider
                label={cfg.slider_title}
                min={0}
                max={1000}
                value={sliderVal}
                format={(v) => `${sliderToK(v)} mm²`}
                onValueChange={(v) => setK(sliderToK(v))}
              />
              <div className="cel-slider-labels cel-num">
                {cfg.slider_ticks.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
              <div className="cel-live-kpis cel-num">
                <div className="cel-live-kpi">
                  <div className="k">By area (RCB-style)</div>
                  <div className="v blue">{area.toFixed(1)}%</div>
                </div>
                <div className="cel-live-kpi">
                  <div className="k">By nuclei (150–250 µm²/cell)</div>
                  <div className="v orange">{nmid.toFixed(1)}%</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>band {nlo.toFixed(0)}–{nhi.toFixed(0)}%</div>
                </div>
                <div className="cel-live-kpi">
                  <div className="k">Match to reports</div>
                  <div style={{ fontSize: 12.5, fontWeight: 650, marginTop: 4, lineHeight: 1.25 }}>{verdict}</div>
                </div>
              </div>
            </div>

            <div className="cel-canvas-wrap" style={{ padding: 8 }}>
              <svg viewBox="0 0 640 275" style={{ width: "100%", height: "auto", display: "block" }}>
                {[0, 10, 20, 30, 40, 50, 60].map((t) => (
                  <g key={t}>
                    <line x1={pL} y1={y(t)} x2={W - pR} y2={y(t)} stroke="#efede6" />
                    <text x={pL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#78756e">{t}%</text>
                  </g>
                ))}
                {[
                  [b6C.n_ge5, `dense focus (${b6C.n_ge5})`],
                  [b6C.n_tight, `tight bed (${b6C.n_tight})`],
                  [b6C.total, `whole (${b6C.total})`],
                ].map(([xv, lbl]) => (
                  <g key={String(lbl)}>
                    <line x1={x(Number(xv))} y1={pT} x2={x(Number(xv))} y2={H - pB} stroke="#d8d4c8" />
                    <text x={x(Number(xv)) - 3} y={pT + 10} textAnchor="end" fontSize={9.5} fill="#78756e">{lbl}</text>
                  </g>
                ))}
                {cfg.ref_lines.map((rl) => (
                  <g key={rl.label}>
                    <line x1={pL} y1={y(rl.pct)} x2={W - pR} y2={y(rl.pct)} stroke={rl.strong ? "#161614" : "#5b5953"} strokeDasharray="3,3" />
                    <text x={pL + 4} y={y(rl.pct) - 4} fontSize={10} fontWeight={rl.strong ? 600 : 400} fill={rl.strong ? "#161614" : "#5b5953"}>
                      {rl.label}
                    </text>
                  </g>
                ))}
                <polygon points={bandPoly} fill="rgba(217,72,31,0.16)" />
                <polyline points={nmidPts} fill="none" stroke="#d9481f" strokeWidth={2.2} />
                <polyline points={areaPts} fill="none" stroke="#2563eb" strokeWidth={2.2} />
                <line x1={x(k)} y1={pT} x2={x(k)} y2={H - pB} stroke="#161614" strokeWidth={1.3} />
                <circle cx={x(k)} cy={y(nmid)} r={5} fill="#d9481f" stroke="#fff" strokeWidth={2} />
                <circle cx={x(k)} cy={y(area)} r={5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
                <line x1={pL} y1={H - pB} x2={W - pR} y2={H - pB} stroke="#cbc6b8" />
                {[1, 2, 5, 10, 20, 50, 100, b6C.total].map((t) => (
                  <text key={t} x={x(t)} y={H - pB + 15} textAnchor="middle" fontSize={10} fill="#5b5953">{t}</text>
                ))}
                <text x={(pL + W - pR) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#5b5953">
                  area circled on {cfg.block_id}, in mm² (log scale, richest fields first)
                </text>
                <g transform={`translate(${W - 210}, ${pT + 22})`}>
                  <line x1={0} y1={0} x2={14} y2={0} stroke="#d9481f" strokeWidth={2.5} />
                  <text x={20} y={3.5} fontSize={10.5} fill="#161614">Share of nuclei (150–250 µm²)</text>
                  <line x1={0} y1={16} x2={14} y2={16} stroke="#2563eb" strokeWidth={2.5} />
                  <text x={20} y={19.5} fontSize={10.5} fill="#161614">Share of area (RCB-style)</text>
                </g>
              </svg>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span>Included fields on {cfg.block_id}</span>
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>Highlighted in gold outline</span>
            </div>
            <div className="cel-canvas-wrap">
              <canvas ref={canvasRef} width={440} height={310} />
            </div>
            <p className="cel-footnote">{cfg.footnote}</p>
          </div>
        </div>
      </div>

      <div className="cel-drawers">
        <CelDrawer title={cfg.hotfields_drawer.title} meta={cfg.hotfields_drawer.meta} allOpen={allDrawersOpen}>
          <p>{cfg.hotfields_drawer.body}</p>
          <img className="cel-fig-img" src={cellularityAssetUrl(cfg.hotfields_drawer.img)} alt="High-resolution focus fields" loading="lazy" />
          <div className="cel-table-wrap" style={{ marginTop: 12 }}>
            <table className="cel-table cel-num">
              <thead>
                <tr><th>Region</th><th>Size</th><th>Cancer % of area</th><th>Cancer % of solid tissue</th><th>Cancer % of nuclei</th></tr>
              </thead>
              <tbody>
                {cfg.hotfields_drawer.rows.map((r) => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CelDrawer>

        <CelDrawer title={cfg.serial_drawer.title} meta={cfg.serial_drawer.meta} allOpen={allDrawersOpen}>
          <p>{cfg.serial_drawer.body}</p>
          <Tabs defaultValue={cfg.serial_drawer.tabs[0]?.key}>
            <TabsList className="cel-seg" aria-label={cfg.serial_drawer.title} style={{ marginBottom: 10 }}>
              {cfg.serial_drawer.tabs.map((tab) => (
                <TabsTab key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTab>
              ))}
            </TabsList>
            {cfg.serial_drawer.tabs.map((tab) => (
              <TabsPanel key={tab.key} value={tab.key}>
                <img className="cel-fig-img" src={cellularityAssetUrl(tab.img)} alt={tab.label} loading="lazy" />
              </TabsPanel>
            ))}
          </Tabs>
        </CelDrawer>

        <CelDrawer title={cfg.recount_drawer.title} meta={cfg.recount_drawer.meta} allOpen={allDrawersOpen}>
          <p>{cfg.recount_drawer.body}</p>
          <img className="cel-fig-img" src={cellularityAssetUrl(cfg.recount_drawer.img)} alt="Pixel-level recount" loading="lazy" />
          <div className="cel-table-wrap" style={{ marginTop: 12 }}>
            <table className="cel-table cel-num">
              <thead><tr><th>Quantity</th><th>Pixels</th><th>Value / Area</th><th>How it is used</th></tr></thead>
              <tbody>
                <tr><td>Field (denominator, RCB area)</td><td>{f.tot.toLocaleString()}</td><td>{f.field_mm2.toFixed(3)} mm² ({Math.round(f.side_um)} × {Math.round(f.side_um)} µm)</td><td>Whole field is inside specimen</td></tr>
                <tr><td>Keratin+ cancer area (numerator)</td><td>{f.final.toLocaleString()}</td><td>{f.ker_mm2.toFixed(3)} mm²</td><td>Pixels left after hue, ink &amp; hole-fill steps</td></tr>
                <tr><td>Cancer ÷ field</td><td>—</td><td><strong>{((100 * f.final) / f.tot).toFixed(1)}%</strong></td><td>Quoted area cellularity for this field</td></tr>
                <tr><td>Solid-tissue denominator (excl. fat)</td><td>{f.solid.toLocaleString()}</td><td>{((100 * f.final) / f.solid).toFixed(1)}%</td><td>Excludes empty fat lumens</td></tr>
                <tr><td>Snapped to MD Anderson bin</td><td>—</td><td>30%</td><td>Protocol bins: 0, 1, 5, 10, 20, 30…%</td></tr>
                <tr><td>Without black-ink rule (sensitivity)</td><td>{f.no_ink.toLocaleString()}</td><td>{((100 * f.no_ink) / f.tot).toFixed(1)}%</td><td>Ink rule trims darkest keratin edges (conservative)</td></tr>
              </tbody>
            </table>
          </div>
        </CelDrawer>
      </div>
    </section>
  );
}
