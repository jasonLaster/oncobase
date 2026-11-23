import { useMemo, useState } from "react";
import type { BlockRow, CellularityData } from "./types";
import { cellularityAssetUrl } from "./utils";

type Props = {
  data: CellularityData;
  onJumpToBlock: (id: string) => void;
  allDrawersOpen: boolean;
};

export function BlocksAndValidationSection({
  data,
  onJumpToBlock,
  allDrawersOpen,
}: Props) {
  const cfg = data.report.blocks_section;
  const focusBlock = data.report.specimen.focus_block;
  const [sensIdx, setSensIdx] = useState(2);
  const [methodTabKey, setMethodTabKey] = useState(cfg.method_drawer.tabs[0]?.key ?? "");

  const rows = data.summary.rows;
  const breast = rows.filter((r) => r.part === "breast");
  const other = rows.filter((r) => r.part !== "breast");
  const pb = data.summary.pooled_breast;
  const pm = pb.measured_only;
  const fmt = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);

  const sensThresholds = useMemo(
    () => Object.keys(data.validation.sensitivity).map(Number).sort((a, b) => a - b),
    [data.validation.sensitivity],
  );
  const actT = sensThresholds[sensIdx] ?? data.validation.threshold;
  const actRow = data.validation.sensitivity[String(actT)] ?? {};

  const W = 480, H = 250, pL = 44, pR = 62, pT = 18, pB = 38;
  const x = (t: number) => pL + ((t - 0.015) / (0.155 - 0.015)) * (W - pL - pR);
  const y = (v: number) => pT + (1 - v / 1.2) * (H - pT - pB);

  const activeMethodTab =
    cfg.method_drawer.tabs.find((t) => t.key === methodTabKey) ?? cfg.method_drawer.tabs[0];

  const renderRow = (r: BlockRow) => {
    const isVirt = r.method.startsWith("virtual");
    return (
      <tr
        key={r.block}
        className={`clickable${isVirt ? " row-virtual" : ""}${r.block === focusBlock ? " row-highlight" : ""}`}
        onClick={() => onJumpToBlock(r.block)}
      >
        <td><strong>{r.block}</strong></td>
        <td>{r.part}</td>
        <td>{isVirt ? "virtual PanCK" : "real keratin"}</td>
        <td>{r.specimen_mm2.toFixed(0)}</td>
        <td>{r.keratin_mm2.toFixed(2)}</td>
        <td>{fmt(r.whole_area, 2)} / {fmt(r.whole_solid, 2)}</td>
        <td>{fmt(r.tight_area, 1)} / {fmt(r.tight_solid, 1)}</td>
        <td>{r.max1.toFixed(0)}% / {r.max2.toFixed(0)}%</td>
        <td>{r.n_ge5}</td>
        <td>{!isVirt ? fmt(r.virtual_whole_area, 2) : "—"}</td>
      </tr>
    );
  };

  return (
    <section id="blocks" className="cel-section">
      <div className="cel-sec-head">
        <div>
          <h2>{cfg.title}</h2>
          <p>{cfg.subtitle}</p>
        </div>
      </div>

      <div className="cel-card">
        <div className="cel-table-wrap">
          <table className="cel-table cel-num">
            <thead>
              <tr>
                <th>Block</th>
                <th>Part</th>
                <th>Source</th>
                <th>Tissue (mm²)</th>
                <th>Keratin+ (mm²)</th>
                <th>Whole (area / solid)</th>
                <th>Tight bed (area / solid)</th>
                <th>Max 1 / 2 mm</th>
                <th>≥5%</th>
                <th>Virtual check</th>
              </tr>
            </thead>
            <tbody>
              {breast.map(renderRow)}
              <tr className="row-summary">
                <td colSpan={3}>{cfg.pooled_label}</td>
                <td>{pb.specimen_mm2.toFixed(0)}</td>
                <td>{pb.keratin_mm2.toFixed(2)}</td>
                <td><strong>{pb.whole_area.toFixed(2)}%</strong></td>
                <td colSpan={4} style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                  {cfg.measured_label}: <strong>{pm.whole_area.toFixed(2)}%</strong> ({pm.keratin_mm2.toFixed(2)} / {pm.specimen_mm2.toFixed(0)} mm²)
                </td>
              </tr>
              <tr className="row-divider">
                <td colSpan={10}>Non-bed blocks (shown for completeness — excluded from primary bed average)</td>
              </tr>
              {other.map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cel-drawers">
        <details className="cel-drawer" open={allDrawersOpen || undefined}>
          <summary>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="cel-chev">▶</span> {cfg.validation_drawer.title}
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{cfg.validation_drawer.meta}</span>
          </summary>
          <div className="cel-drawer-body">
            <p>{cfg.validation_drawer.body}</p>
            <div className="cel-two-col" style={{ marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Interactive threshold sensitivity</div>
                <div className="cel-canvas-wrap" style={{ padding: 8 }}>
                  <svg viewBox="0 0 480 250" style={{ width: "100%", height: "auto", display: "block" }}>
                    {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((yv) => (
                      <g key={yv}>
                        <line x1={pL} y1={y(yv)} x2={W - pR} y2={y(yv)} stroke="#efede6" />
                        <text x={pL - 6} y={y(yv) + 3.5} textAnchor="end" fontSize={10} fill="#78756e">{yv.toFixed(1)}%</text>
                      </g>
                    ))}
                    <line x1={x(data.validation.threshold)} y1={pT} x2={x(data.validation.threshold)} y2={H - pB} stroke="#a7a296" strokeDasharray="3,3" />
                    <line x1={x(actT)} y1={pT} x2={x(actT)} y2={H - pB} stroke="#161614" strokeWidth={1.3} />
                    {cfg.sensitivity_blocks.map(({ block, color, dashed }) => {
                      const pts = sensThresholds
                        .map((t) => `${x(t).toFixed(1)},${y(data.validation.sensitivity[String(t)]?.[block] ?? 0).toFixed(1)}`)
                        .join(" ");
                      const vAct = actRow[block] ?? 0;
                      const vEnd = data.validation.sensitivity[String(sensThresholds[sensThresholds.length - 1])]?.[block] ?? 0;
                      return (
                        <g key={block}>
                          <polyline points={pts} fill="none" stroke={color} strokeWidth={block === focusBlock ? 2.2 : 1.7} strokeDasharray={dashed ? "5,3" : undefined} />
                          <circle cx={x(actT)} cy={y(vAct)} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
                          <text x={W - pR + 6} y={y(vEnd) + 3.5} fontSize={10.5} fontWeight={600} fill={color}>{block}</text>
                        </g>
                      );
                    })}
                    <line x1={pL} y1={H - pB} x2={W - pR} y2={H - pB} stroke="#cbc6b8" />
                    {sensThresholds.map((t) => (
                      <text key={t} x={x(t)} y={H - pB + 14} textAnchor="middle" fontSize={9.5} fill="#5b5953">{t.toFixed(2)}</text>
                    ))}
                    <text x={(pL + W - pR) / 2} y={H - 5} textAnchor="middle" fontSize={10.5} fill="#5b5953">Virtual PanCK threshold</text>
                  </svg>
                </div>
                <div className="cel-slider-panel" style={{ marginTop: 8, marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span>Inspect PanCK threshold:</span>
                    <strong className="cel-num">{actT.toFixed(2)}{actT === data.validation.threshold ? " (chosen)" : ""}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, sensThresholds.length - 1)}
                    step={1}
                    value={sensIdx}
                    onChange={(e) => setSensIdx(Number(e.target.value))}
                  />
                  <div className="cel-num" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    At PanCK &gt; {actT.toFixed(2)}:{" "}
                    {cfg.sensitivity_blocks
                      .map(({ block }) => `${block}=${(actRow[block] ?? 0).toFixed(2)}%`)
                      .join(" · ")}
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Validation across stained blocks</div>
                <img className="cel-fig-img" style={{ margin: 0 }} src={cellularityAssetUrl(cfg.validation_drawer.img)} alt="Virtual stain validation against real keratin" loading="lazy" />
                <p className="cel-footnote">{cfg.validation_drawer.footnote}</p>
              </div>
            </div>
          </div>
        </details>

        <details className="cel-drawer" open={allDrawersOpen || undefined}>
          <summary>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="cel-chev">▶</span> {cfg.qc_drawer.title}
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{cfg.qc_drawer.meta}</span>
          </summary>
          <div className="cel-drawer-body">
            <p>{cfg.qc_drawer.body}</p>
            <img className="cel-fig-img" src={cellularityAssetUrl(cfg.qc_drawer.img)} alt="Virtual stain QC crops" loading="lazy" />
          </div>
        </details>

        <details className="cel-drawer" open={allDrawersOpen || undefined}>
          <summary>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="cel-chev">▶</span> {cfg.method_drawer.title}
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{cfg.method_drawer.meta}</span>
          </summary>
          <div className="cel-drawer-body">
            <div className="cel-seg" style={{ marginTop: 10, marginBottom: 10 }}>
              {cfg.method_drawer.tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={activeMethodTab?.key === tab.key ? "active" : ""}
                  onClick={() => setMethodTabKey(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activeMethodTab ? (
              <>
                <p>{activeMethodTab.body}</p>
                {activeMethodTab.img ? (
                  <img className="cel-fig-img" src={cellularityAssetUrl(activeMethodTab.img)} alt={activeMethodTab.label} loading="lazy" />
                ) : null}
                {activeMethodTab.bullets ? (
                  <ul style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "8px 0 0 18px" }}>
                    {activeMethodTab.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        </details>
      </div>
    </section>
  );
}
