import { useMemo, useState } from "react";
import type { CellularityData } from "./types";
import { calcRCB, calcRcbNodalTerm, rcbClass } from "./utils";

type Props = {
  data: CellularityData;
};

function rcbSliderToCa(v: number) {
  const lo = Math.log10(0.01);
  const hi = Math.log10(50);
  return Math.pow(10, lo + (v / 1000) * (hi - lo));
}

function caToRcbSlider(ca: number) {
  const lo = Math.log10(0.01);
  const hi = Math.log10(50);
  return Math.round((1000 * (Math.log10(Math.max(0.01, Math.min(50, ca))) - lo)) / (hi - lo));
}

export function ReconcileAndRcbSection({ data }: Props) {
  const cfg = data.report.reconcile;
  const rcbCfg = cfg.rcb;
  const [activeCa, setActiveCa] = useState(rcbCfg.default_ca);
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  const compareItems = cfg.compare_bars;
  const nodalTerm = calcRcbNodalTerm(rcbCfg.positive_nodes, rcbCfg.max_met_mm);

  const cW = 880, cH = 310, cpL = 240, cpR = 54, cpT = 16, cpB = 42;
  const cx = (v: number) =>
    cpL + ((Math.log10(v) - Math.log10(0.1)) / (Math.log10(45) - Math.log10(0.1))) * (cW - cpL - cpR);
  const rowH = (cH - cpT - cpB) / Math.max(1, compareItems.length);
  const cols = { rep: "#2563eb", foc: "#eb6834", bed: "#9c471a" };

  const rW = 880, rH = 300, rpL = 52, rpR = 86, rpT = 20, rpB = 42;
  const rx = (v: number) =>
    rpL + ((Math.log10(v) - Math.log10(0.01)) / (Math.log10(55) - Math.log10(0.01))) * (rW - rpL - rpR);
  const ry = (v: number) => rpT + (1 - (v - 1.0) / (3.75 - 1.0)) * (rH - rpT - rpB);

  const rcbCurvePts = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 180; i++) {
      const ca = Math.pow(10, -2 + (i / 180) * (Math.log10(55) + 2));
      pts.push(`${rx(ca).toFixed(1)},${ry(calcRCB(ca, rcbCfg).total).toFixed(1)}`);
    }
    return pts.join(" ");
  }, [rcbCfg]);

  const rcbNow = calcRCB(activeCa, rcbCfg);
  const clsNow = rcbClass(rcbNow.total);

  return (
    <section id="reconcile" className="cel-section">
      <div className="cel-sec-head">
        <div>
          <h2>{cfg.title}</h2>
          <p>{cfg.subtitle}</p>
        </div>
      </div>

      <div className="cel-card" style={{ marginBottom: 16 }}>
        <div className="cel-table-wrap" style={{ marginBottom: 14 }}>
          <table className="cel-table">
            <thead>
              <tr><th>Reported</th><th>What it most likely describes</th><th>Closest measurement here</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {cfg.rows.map((r) => (
                <tr key={r.reported}>
                  <td>
                    <strong>{r.reported}</strong>
                    <br />
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.reported_sub}</span>
                  </td>
                  <td>{r.describes}</td>
                  <td className="cel-num">{r.measured}</td>
                  <td>
                    <span className={`cel-badge${r.verdict_tone ? ` ${r.verdict_tone}` : ""}`}>{r.verdict}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Reported vs measured cellularity (log scale)</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{hoveredBar ?? "Hover any bar for details"}</span>
        </div>
        <div className="cel-canvas-wrap" style={{ padding: 10 }}>
          <svg viewBox="0 0 880 310" style={{ width: "100%", height: "auto", display: "block" }}>
            {[0.1, 0.3, 1, 3, 10, 30].map((t) => (
              <g key={t}>
                <line x1={cx(t)} y1={cpT} x2={cx(t)} y2={cH - cpB} stroke="#efede6" />
                <text x={cx(t)} y={cH - cpB + 16} textAnchor="middle" fontSize={10.5} fill="#5b5953">{t}%</text>
              </g>
            ))}
            <line x1={cpL} y1={cpT} x2={cpL} y2={cH - cpB} stroke="#cbc6b8" />
            <line x1={cpL} y1={cH - cpB} x2={cW - cpR} y2={cH - cpB} stroke="#cbc6b8" />
            {compareItems.map((it, i) => {
              const cy = cpT + i * rowH + rowH * 0.18;
              const bh = rowH * 0.64;
              const bw = Math.max(2, cx(it.value) - cpL);
              const valStr = it.value < 1 ? `${it.value.toFixed(2)}%` : it.value < 5 && it.value !== 2 ? `${it.value.toFixed(2)}%` : `${Math.round(it.value)}%`;
              return (
                <g
                  key={it.label}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredBar(`${it.label}: ${it.detail}`)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <text x={cpL - 10} y={cy + bh * 0.72} textAnchor="end" fontSize={11.5} fill="#161614">{it.label}</text>
                  <rect x={cpL} y={cy} width={bw} height={bh} rx={3} fill={cols[it.kind]} />
                  <text x={cpL + bw + 7} y={cy + bh * 0.72} fontSize={11} fontWeight={600} fill="#161614">{valStr}</text>
                </g>
              );
            })}
            <text x={(cpL + cW - cpR) / 2} y={cH - 6} textAnchor="middle" fontSize={11} fill="#5b5953">
              Cancer cellularity (%, log scale)
            </text>
            <g transform={`translate(${cW - 235}, ${cH - cpB - 62})`}>
              <rect x={-8} y={-12} width={225} height={58} rx={6} fill="rgba(255,255,255,0.92)" stroke="#e2dfd5" />
              <rect x={0} y={-2} width={12} height={9} rx={2} fill="#2563eb" /><text x={18} y={6} fontSize={10.5} fill="#161614">{cfg.compare_legend.rep}</text>
              <rect x={0} y={14} width={12} height={9} rx={2} fill="#eb6834" /><text x={18} y={22} fontSize={10.5} fill="#161614">{cfg.compare_legend.foc}</text>
              <rect x={0} y={30} width={12} height={9} rx={2} fill="#9c471a" /><text x={18} y={38} fontSize={10.5} fill="#161614">{cfg.compare_legend.bed}</text>
            </g>
          </svg>
        </div>
        <p className="cel-footnote">{cfg.compare_footnote}</p>
      </div>

      {/* Interactive RCB Calculator */}
      <div className="cel-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Interactive RCB sensitivity calculator</h3>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{rcbCfg.subtitle}</div>
          </div>
          <div className="cel-preset-row" style={{ margin: 0 }}>
            {rcbCfg.presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`cel-preset-btn${Math.abs(Math.log10(p.ca) - Math.log10(activeCa)) < 0.04 ? " active" : ""}`}
                onClick={() => setActiveCa(p.ca)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cel-slider-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontSize: 13 }}>
              Drag tumor-bed cellularity (log scale):{" "}
              <strong className="cel-num" style={{ fontSize: 15 }}>
                {activeCa < 1 ? `${activeCa.toFixed(2)}%` : `${activeCa.toFixed(1)}%`}
              </strong>
            </span>
            <div className="cel-num" style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center", flexWrap: "wrap" }}>
              <span>Primary term: <strong>{rcbNow.prim.toFixed(2)}</strong></span>
              <span>Node term: <strong>{nodalTerm.toFixed(2)}</strong></span>
              <span>RCB Index: <strong style={{ fontSize: 16 }}>{rcbNow.total.toFixed(2)}</strong></span>
              <span className={`cel-badge ${clsNow.tone}`}>{clsNow.label}</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={caToRcbSlider(activeCa)}
            onChange={(e) => setActiveCa(rcbSliderToCa(Number(e.target.value)))}
          />
          <div className="cel-slider-labels cel-num">
            <span>0.01%</span><span>0.1%</span><span>0.3%</span><span>1%</span><span>3%</span><span>10%</span><span>30%</span><span>50%</span>
          </div>
        </div>

        <div className="cel-canvas-wrap" style={{ padding: 10 }}>
          <svg viewBox="0 0 880 300" style={{ width: "100%", height: "auto", display: "block" }}>
            <rect x={rpL} y={ry(1.36)} width={rW - rpL - rpR} height={ry(1.0) - ry(1.36)} fill="#f6f5f0" />
            <rect x={rpL} y={ry(3.28)} width={rW - rpL - rpR} height={ry(1.36) - ry(3.28)} fill="#eeede7" />
            <rect x={rpL} y={ry(3.75)} width={rW - rpL - rpR} height={ry(3.28) - ry(3.75)} fill="#e5dcd7" />
            <text x={rW - rpR + 8} y={ry(1.18)} fontSize={11} fontWeight={600} fill="#78756e">RCB-I</text>
            <text x={rW - rpR + 8} y={ry(2.35)} fontSize={11} fontWeight={600} fill="#5b5953">RCB-II</text>
            <text x={rW - rpR + 8} y={ry(3.52)} fontSize={11} fontWeight={600} fill="#8f1d14">RCB-III</text>
            <line x1={rpL} y1={ry(1.36)} x2={rW - rpR} y2={ry(1.36)} stroke="#cbc6b8" />
            <line x1={rpL} y1={ry(3.28)} x2={rW - rpR} y2={ry(3.28)} stroke="#c9b4ae" />
            {nodalTerm > 1.0 ? (
              <>
                <line x1={rpL} y1={ry(nodalTerm)} x2={rW - rpR} y2={ry(nodalTerm)} stroke="#78756e" strokeDasharray="3,3" />
                <text x={rpL + 6} y={ry(nodalTerm) + 13} fontSize={10} fill="#5b5953">
                  Node term alone = {nodalTerm.toFixed(2)}
                </text>
              </>
            ) : null}
            {[1.0, 1.5, 2.0, 2.5, 3.0, 3.5].map((t) => (
              <text key={t} x={rpL - 8} y={ry(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#5b5953">{t.toFixed(1)}</text>
            ))}
            <polyline points={rcbCurvePts} fill="none" stroke="#2563eb" strokeWidth={2.6} />
            {rcbCfg.landmarks.map((m) => {
              const mx = rx(m.ca), my = ry(calcRCB(m.ca, rcbCfg).total);
              const lx = mx + m.dx, ly = my + m.dy;
              return (
                <g key={m.label}>
                  <line x1={mx} y1={my} x2={lx} y2={ly - (m.dy > 0 ? 8 : -3)} stroke="#a7a296" />
                  <circle cx={mx} cy={my} r={4.5} fill="#2563eb" stroke="#fff" strokeWidth={1.8} />
                  <text x={lx} y={ly} textAnchor={m.anchor} fontSize={10.5} fontWeight={600} fill="#161614">{m.label}</text>
                </g>
              );
            })}
            <line x1={rx(activeCa)} y1={rpT} x2={rx(activeCa)} y2={rH - rpB} stroke="#d9481f" strokeDasharray="3,3" strokeWidth={1.3} />
            <circle cx={rx(activeCa)} cy={ry(rcbNow.total)} r={7} fill="#d9481f" stroke="#fff" strokeWidth={2.4} />
            <line x1={rpL} y1={rH - rpB} x2={rW - rpR} y2={rH - rpB} stroke="#cbc6b8" />
            {[0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 50].map((t) => (
              <text key={t} x={rx(t)} y={rH - rpB + 15} textAnchor="middle" fontSize={10} fill="#5b5953">{t}%</text>
            ))}
            <text x={(rpL + rW - rpR) / 2} y={rH - 6} textAnchor="middle" fontSize={11} fill="#5b5953">
              Tumor-bed cellularity used in RCB formula (%, log scale)
            </text>
            <text x={15} y={(rpT + rH - rpB) / 2} textAnchor="middle" fontSize={11} fill="#5b5953" transform={`rotate(-90 15 ${(rpT + rH - rpB) / 2})`}>
              RCB Index
            </text>
          </svg>
        </div>
      </div>

      <div className="cel-limits-grid">
        {cfg.limits.map((lim) => (
          <div key={lim.title} className="cel-limit-item">
            <h4>{lim.title}</h4>
            <p>{lim.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
