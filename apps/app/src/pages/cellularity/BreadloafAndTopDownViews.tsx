import { useEffect, useRef, useState } from "react";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";
import { CelCheckbox, CelSlider } from "./controls";
import type { BlockRow, CellularityData, SliceMeta } from "./types";
import { draw2DGrid, type GridGeometry, heatColor } from "./utils";

function pointInPoly(px: number, py: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function BreadloafView({
  data,
  selectedBlock,
  onSelectBlock,
}: {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitPolysRef = useRef<Array<{ id: string; poly: [number, number][] }>>([]);
  const [spread, setSpread] = useState(44);
  const [angleDeg, setAngleDeg] = useState(28);
  const [showBox, setShowBox] = useState(true);
  const [showShaves, setShowShaves] = useState(true);
  const [showUnscanned, setShowUnscanned] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.parentElement?.clientWidth || 720;
      const cssH = Math.round(cssW * 0.62);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const sp = spread / 100;
      const yaw = (angleDeg * Math.PI) / 180;
      const xStep = (1 + sp * 0.9) * (cssW / 90);
      const faceScale = cssW / 70;
      const originX = cssW * 0.14 + (1 - sp) * 22;
      const originY = cssH * 0.58;
      const yVecX = faceScale * Math.sin(yaw + 0.35) * 0.78;
      const yVecY = faceScale * Math.cos(yaw + 0.35) * 0.42;
      const zVecY = faceScale * 0.92;
      const xVecX = xStep * Math.cos(yaw * 0.45);
      const xVecY = -xStep * Math.sin(yaw * 0.45) * 0.48;

      const proj = (xMm: number, yMm: number, zMm: number): [number, number] => [
        originX + xMm * xVecX + yMm * yVecX,
        originY + xMm * xVecY + yMm * yVecY - zMm * zVecY,
      ];

      const strokeLine3D = (a: [number, number, number], b: [number, number, number], color: string, dash: number[] = [], lw = 1) => {
        const p1 = proj(...a), p2 = proj(...b);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.restore();
      };

      strokeLine3D([0, 12.5, -10.5], [41, 12.5, -10.5], "#b8b4a8", [], 1.2);
      [0, 10, 20, 30, 41].forEach((mm) => {
        const p = proj(mm, 12.5, -10.5), pt = proj(mm, 14.0, -10.5);
        ctx.strokeStyle = "#b8b4a8";
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke();
        ctx.fillStyle = "#6c6960";
        ctx.font = "10.5px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(mm === 0 ? "0 mm (Lat)" : mm === 41 ? "41 mm (Med)" : `${mm} mm`, pt[0], pt[1] + 13);
        ctx.textAlign = "left";
      });

      ctx.fillStyle = "#5b5953";
      ctx.font = "10.5px -apple-system, sans-serif";
      ctx.fillText("Ink-aligned: ↑ Anterior (magenta) · ↓ Posterior (black) · back-left Superior (blue) · front-right Inferior (green)", 12, 18);

      if (showShaves) {
        const drawShave = (pts: [number, number][], lblPos: [number, number], lbl: string) => {
          ctx.save();
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fillStyle = "rgba(21,128,61,0.10)";
          ctx.fill();
          ctx.strokeStyle = "rgba(21,128,61,0.65)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = "#15803d";
          ctx.font = "600 9.5px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(lbl, lblPos[0], lblPos[1]);
          ctx.restore();
        };
        drawShave(
          [proj(46, -7, -5.5), proj(46, 7, -5.5), proj(46, 7, 5.5), proj(46, -7, 5.5)],
          proj(46, 2, -7.8),
          "D1–D2 (benign)",
        );
        drawShave(
          [proj(10, -13.2, -4.5), proj(30, -13.2, -4.5), proj(30, -13.2, 4.5), proj(10, -13.2, 4.5)],
          proj(13, -13.2, 8.2),
          "Part C (sup. benign)",
        );
      }

      if (showBox) {
        const y0 = -10, y1 = 10, z0 = -8, z1 = 8;
        strokeLine3D([0, y0, z0], [41, y0, z0], "rgba(155,28,28,0.22)", [4, 4]);
        strokeLine3D([0, y0, z1], [41, y0, z1], "rgba(155,28,28,0.22)", [4, 4]);
        strokeLine3D([0, y0, z0], [0, y0, z1], "rgba(155,28,28,0.22)", [4, 4]);
        strokeLine3D([41, y0, z0], [41, y0, z1], "rgba(155,28,28,0.22)", [4, 4]);
        strokeLine3D([0, y0, z0], [0, y1, z0], "rgba(155,28,28,0.22)", [4, 4]);
        strokeLine3D([41, y0, z0], [41, y1, z0], "rgba(155,28,28,0.22)", [4, 4]);
      }

      const list = data.slices
        .filter((s) => (s.id !== "E1" || showShaves) && (s.scanned || showUnscanned))
        .slice()
        .reverse();

      const polys: Array<{ id: string; poly: [number, number][] }> = [];

      list.forEach((s) => {
        const xm = (s.x0_mm + s.x1_mm) / 2;
        const isSel = s.id === selectedBlock;
        const isHov = s.id === hoveredId;
        const liftZ = isSel ? 2.4 : isHov ? 1.1 : 0;

        if (!s.scanned) {
          const xA = s.x0_mm, xB = s.x1_mm;
          const yMin = -9.5, yMax = 9.5, zMin = -6.8 + liftZ, zMax = 6.8 + liftZ;
          const backFace = [proj(xB, yMin, zMin), proj(xB, yMax, zMin), proj(xB, yMax, zMax), proj(xB, yMin, zMax)];
          const frontFace = [proj(xA, yMin, zMin), proj(xA, yMax, zMin), proj(xA, yMax, zMax), proj(xA, yMin, zMax)];
          const topFace = [proj(xA, yMin, zMax), proj(xA, yMax, zMax), proj(xB, yMax, zMax), proj(xB, yMin, zMax)];
          ctx.save();
          [backFace, topFace, frontFace].forEach((poly, idx) => {
            ctx.beginPath();
            poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.closePath();
            ctx.fillStyle = isSel ? "rgba(120,115,105,0.22)" : idx === 1 ? "rgba(190,186,176,0.20)" : "rgba(190,186,176,0.12)";
            ctx.fill();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = isSel ? "#161614" : "#9c988d";
            ctx.lineWidth = isSel ? 1.8 : 1;
            ctx.stroke();
          });
          ctx.setLineDash([]);
          ctx.strokeStyle = isSel ? "#5b5953" : "rgba(130,125,115,0.7)";
          [-5, 0, 5].forEach((sy) => {
            const sp2 = [proj(xA, sy, zMin), proj(xB, sy, zMin), proj(xB, sy, zMax), proj(xA, sy, zMax)];
            ctx.beginPath();
            sp2.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.closePath();
            ctx.fillStyle = "rgba(160,155,145,0.12)";
            ctx.fill();
            ctx.stroke();
          });
          ctx.restore();
          const topLbl = proj(xm, 0, zMax + 2.2);
          ctx.fillStyle = isSel ? "#161614" : "#6c6960";
          ctx.font = `${isSel ? "700" : "600"} 10.5px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(s.label, topLbl[0], topLbl[1] - 4);
          ctx.font = "9px -apple-system, sans-serif";
          ctx.fillText("perp. cap · unscanned", topLbl[0], topLbl[1] + 7);
          ctx.textAlign = "left";
          polys.push({ id: s.id, poly: frontFace });
          return;
        }

        const g = data.grids[s.id];
        if (!g) return;
        const wMm = Math.min(24, g.w_mm);
        const hMm = Math.min(16.5, g.h_mm);
        const yStart = -wMm / 2;
        const zStart = -hMm / 2 + liftZ;
        const framePts: [number, number][] = [
          proj(xm, yStart - 0.5, zStart - 0.5),
          proj(xm, yStart + wMm + 0.5, zStart - 0.5),
          proj(xm, yStart + wMm + 0.5, zStart + hMm + 0.5),
          proj(xm, yStart - 0.5, zStart + hMm + 0.5),
        ];

        const isVirt = s.kind === "virtual";
        ctx.save();
        ctx.beginPath();
        framePts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fillStyle = isSel
          ? isVirt
            ? "rgba(37,99,235,0.09)"
            : "rgba(217,72,31,0.08)"
          : "rgba(255,255,255,0.32)";
        ctx.fill();
        ctx.setLineDash(isVirt ? [4, 3] : []);
        ctx.strokeStyle = isSel
          ? isVirt
            ? "#2563eb"
            : "#161614"
          : isHov
            ? "#5b5953"
            : isVirt
              ? "rgba(37,99,235,0.45)"
              : "rgba(22,22,20,0.30)";
        ctx.lineWidth = isSel ? 2.2 : isHov ? 1.5 : 1;
        ctx.stroke();
        ctx.restore();

        const dy = wMm / g.sil_w;
        const dz = hMm / g.sil_h;
        ctx.fillStyle = isSel ? "rgba(235, 232, 224, 0.94)" : "rgba(235, 232, 224, 0.62)";
        for (let r = 0; r < g.sil_h; r++) {
          const rowStr = g.sil_rows[r];
          let c = 0;
          while (c < g.sil_w) {
            if (rowStr?.[c] === "1") {
              let cEnd = c;
              while (cEnd < g.sil_w && rowStr[cEnd] === "1") cEnd++;
              const zTop = zStart + (g.sil_h - r) * dz;
              const zBot = zStart + (g.sil_h - r - 1) * dz;
              const p1 = proj(xm, yStart + c * dy, zBot);
              const p2 = proj(xm, yStart + cEnd * dy, zBot);
              const p3 = proj(xm, yStart + cEnd * dy, zTop);
              const p4 = proj(xm, yStart + c * dy, zTop);
              ctx.beginPath();
              ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]);
              ctx.closePath();
              ctx.fill();
              c = cEnd;
            } else c++;
          }
        }

        const fy = wMm / g.cols;
        const fz = hMm / g.rows;
        for (const [col, row, ca] of g.fields) {
          if (ca < 0.25) continue;
          const yA = yStart + col * fy;
          const zTop = zStart + (g.rows - row) * fz;
          const p1 = proj(xm, yA, zTop - fz);
          const p2 = proj(xm, yA + fy, zTop - fz);
          const p3 = proj(xm, yA + fy, zTop);
          const p4 = proj(xm, yA, zTop);
          ctx.fillStyle = heatColor(ca);
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]);
          ctx.closePath();
          ctx.fill();
        }

        const topPos = proj(xm, -4.2, zStart + hMm + 1.8);
        ctx.textAlign = "center";
        ctx.fillStyle = isSel ? (isVirt ? "#1d4ed8" : "#161614") : isVirt ? "#2563eb" : "#3a3935";
        ctx.font = `${isSel ? "700" : "600"} 11.5px -apple-system, sans-serif`;
        ctx.fillText(s.label, topPos[0], topPos[1] - 4);
        if (s.id === "B6") {
          ctx.fillStyle = "#9b1c1c";
          ctx.font = "600 10px -apple-system, sans-serif";
          ctx.fillText("33% focus", topPos[0], topPos[1] - 17);
        }
        ctx.textAlign = "left";
        polys.push({ id: s.id, poly: framePts });
      });

      if (showBox) {
        const y0 = -10, y1 = 10, z0 = -8, z1 = 8;
        strokeLine3D([0, y1, z0], [41, y1, z0], "rgba(155,28,28,0.45)", [5, 4], 1.2);
        strokeLine3D([0, y1, z1], [41, y1, z1], "rgba(155,28,28,0.45)", [5, 4], 1.2);
        strokeLine3D([0, y1, z0], [0, y1, z1], "rgba(155,28,28,0.45)", [5, 4], 1.2);
        strokeLine3D([41, y1, z0], [41, y1, z1], "rgba(155,28,28,0.45)", [5, 4], 1.2);
        strokeLine3D([0, y0, z1], [0, y1, z1], "rgba(155,28,28,0.35)", [5, 4], 1);
        strokeLine3D([41, y0, z1], [41, y1, z1], "rgba(155,28,28,0.35)", [5, 4], 1);
        const boxLbl = proj(31, y1, z1 + 1.5);
        ctx.fillStyle = "#9b1c1c";
        ctx.font = "600 10.5px -apple-system, sans-serif";
        ctx.fillText("UCSF 41 × 20 mm bed", boxLbl[0] - 45, boxLbl[1] - 2);
      }

      hitPolysRef.current = polys;
    };

    draw();
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [data, selectedBlock, hoveredId, spread, angleDeg, showBox, showShaves, showUnscanned]);

  return (
    <>
      <div className="cel-controls">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Spread <CelSlider label="Spread" min={0} max={100} value={spread} onValueChange={setSpread} style={{ width: 96 }} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Angle <CelSlider label="Angle" min={10} max={65} value={angleDeg} format={(v) => `${v}°`} onValueChange={setAngleDeg} style={{ width: 96 }} />
        </span>
        <CelCheckbox checked={showBox} onCheckedChange={setShowBox}>41×20 mm bed box</CelCheckbox>
        <CelCheckbox checked={showShaves} onCheckedChange={setShowShaves}>Cavity shaves (C, D, E1)</CelCheckbox>
        <CelCheckbox checked={showUnscanned} onCheckedChange={setShowUnscanned}>Perp. end-caps</CelCheckbox>
      </div>
      <div className="cel-canvas-wrap">
        <canvas
          ref={canvasRef}
          style={{ cursor: hoveredId ? "pointer" : "default" }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            let found: string | null = null;
            for (let i = hitPolysRef.current.length - 1; i >= 0; i--) {
              if (pointInPoly(px, py, hitPolysRef.current[i].poly)) {
                found = hitPolysRef.current[i].id;
                break;
              }
            }
            if (found !== hoveredId) setHoveredId(found);
          }}
          onMouseLeave={() => setHoveredId(null)}
          onClick={() => {
            if (hoveredId) onSelectBlock(hoveredId);
          }}
        />
      </div>
    </>
  );
}

export function TopDownView({
  data,
  selectedBlock,
  onSelectBlock,
}: {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);
  const [showBox, setShowBox] = useState(true);
  const [showE1, setShowE1] = useState(true);
  const [showUnscanned, setShowUnscanned] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.parentElement?.clientWidth || 720;
      const cssH = 400;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const padL = 72, padR = 30, padT = 46, padB = 58;
      const minX = showE1 ? -8 : 0, maxX = 42;
      const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
      const xPx = (mm: number) => padL + ((mm - minX) / (maxX - minX)) * plotW;
      const yPx = (mm: number) => padT + ((mm + 13.5) / 27) * plotH;

      ctx.strokeStyle = "#ece9df";
      [-10, -5, 0, 5, 10].forEach((y) => {
        ctx.beginPath(); ctx.moveTo(padL, yPx(y)); ctx.lineTo(cssW - padR, yPx(y)); ctx.stroke();
      });

      const rects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
      data.slices.forEach((s) => {
        if (s.id === "E1" && !showE1) return;
        if (!s.scanned && !showUnscanned) return;
        const x1 = xPx(s.x0_mm) + 2, x2 = xPx(s.x1_mm) - 2;
        const w = Math.max(8, x2 - x1);
        const isSel = s.id === selectedBlock;
        const isVirt = s.kind === "virtual";

        if (!s.scanned) {
          const yTop = yPx(-11.5), yBot = yPx(11.5);
          ctx.save();
          ctx.fillStyle = "rgba(210,206,196,0.22)";
          ctx.fillRect(x1, yTop, w, yBot - yTop);
          ctx.strokeStyle = "rgba(140,136,126,0.55)";
          for (let yy = yTop + 14; yy < yBot - 6; yy += 14) {
            ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x1 + w, yy); ctx.stroke();
          }
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isSel ? "#161614" : "#8c887e";
          ctx.lineWidth = isSel ? 2 : 1.1;
          ctx.strokeRect(x1, yTop, w, yBot - yTop);
          ctx.restore();
          ctx.fillStyle = "#6c6960";
          ctx.font = "600 11px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(s.label, x1 + w / 2, padT - 12);
          ctx.font = "9.5px -apple-system, sans-serif";
          ctx.fillText("perp.", x1 + w / 2, yPx(-0.8));
          ctx.fillText("cap", x1 + w / 2, yPx(1.2));
          rects.push({ id: s.id, x: x1, y: yTop, w, h: yBot - yTop });
          return;
        }

        const g = data.grids[s.id];
        if (!g) return;
        const halfH = Math.min(13.2, g.w_mm / 2);
        const yTop = yPx(-halfH), yBot = yPx(halfH);
        const cellH = (yBot - yTop) / g.si_profile.length;
        g.si_profile.forEach(([hasTissue, maxCa], idx) => {
          if (!hasTissue) return;
          ctx.fillStyle = heatColor(maxCa);
          ctx.fillRect(x1, yTop + idx * cellH, w, cellH + 0.6);
        });
        ctx.save();
        ctx.setLineDash(isVirt ? [4, 3] : []);
        ctx.strokeStyle = isSel ? (isVirt ? "#2563eb" : "#161614") : isVirt ? "rgba(37,99,235,0.55)" : "rgba(22,22,20,0.35)";
        ctx.lineWidth = isSel ? 2.4 : 1.1;
        ctx.strokeRect(x1, yTop, w, yBot - yTop);
        ctx.restore();
        ctx.textAlign = "center";
        ctx.fillStyle = isVirt ? "#1d4ed8" : "#161614";
        ctx.font = `${isSel ? "700" : "600"} 11.5px -apple-system, sans-serif`;
        ctx.fillText(s.label, x1 + w / 2, padT - 12);
        if (s.stats) {
          ctx.fillStyle = "#6c6960";
          ctx.font = "10px ui-monospace, monospace";
          ctx.fillText(`${s.stats.whole_area.toFixed(2)}%`, x1 + w / 2, cssH - padB + 16);
        }
        rects.push({ id: s.id, x: x1, y: yTop, w, h: yBot - yTop });
      });

      if (showBox) {
        ctx.save();
        ctx.strokeStyle = "#9b1c1c";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(xPx(0), yPx(-10), xPx(41) - xPx(0), yPx(10) - yPx(-10));
        ctx.restore();
        ctx.fillStyle = "#9b1c1c";
        ctx.font = "600 11px -apple-system, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("UCSF 41 × 20 mm tumor bed", xPx(41) - 4, yPx(-10) - 6);
      }

      ctx.textAlign = "center";
      ctx.fillStyle = "#5b5953";
      ctx.font = "11.5px -apple-system, sans-serif";
      ctx.fillText("Lateral (0 mm)  ←   Breadloaf slice position along Part B (41 mm)   →  Medial (41 mm)", padL + plotW / 2, cssH - 12);
      ctx.save();
      ctx.translate(18, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("Superior (blue) ↑  ↔  ↓ Inferior (green)", 0, 0);
      ctx.restore();
      ctx.textAlign = "right";
      ctx.font = "10.5px ui-monospace, monospace";
      [-10, 0, 10].forEach((y) => ctx.fillText(`${y > 0 ? "+" : ""}${y} mm`, padL - 8, yPx(y) + 3.5));
      ctx.textAlign = "left";
      hitRectsRef.current = rects;
    };

    draw();
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [data, selectedBlock, showBox, showE1, showUnscanned]);

  return (
    <>
      <div className="cel-controls">
        <CelCheckbox checked={showBox} onCheckedChange={setShowBox}>41×20 mm bed box</CelCheckbox>
        <CelCheckbox checked={showE1} onCheckedChange={setShowE1}>E1 lateral margin</CelCheckbox>
        <CelCheckbox checked={showUnscanned} onCheckedChange={setShowUnscanned}>Perp. end-caps</CelCheckbox>
      </div>
      <div className="cel-canvas-wrap">
        <canvas
          ref={canvasRef}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const hit = hitRectsRef.current.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
            if (hit) onSelectBlock(hit.id);
          }}
        />
      </div>
    </>
  );
}

function MiniBlockTile({
  block,
  row,
  data,
}: {
  block: string;
  row: BlockRow;
  data: CellularityData;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const isVirt = row.method.startsWith("virtual");
  useEffect(() => {
    const g = data.grids[block];
    if (ref.current && g) draw2DGrid(ref.current, g, { showBed: false, showNums: true, small: true });
  }, [block, data]);

  return (
    <Toggle
      value={block}
      className={`cel-mini-card${isVirt ? " virtual" : ""}`}
      style={{ textAlign: "left", width: "100%" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, fontWeight: 650, marginBottom: 4 }}>
        <span style={{ color: isVirt ? "#2563eb" : "#161614" }}>{block} · {isVirt ? "virtual" : "real"}</span>
        <span className="cel-num" style={{ fontSize: 11, fontWeight: 500, color: "#5b5953" }}>
          {row.whole_area.toFixed(2)}% · max {row.max1.toFixed(1)}%
        </span>
      </div>
      <canvas ref={ref} width={220} height={140} />
    </Toggle>
  );
}

export function BreastBlocksGrid2x3({
  data,
  selectedBlock,
  onSelectBlock,
}: {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
}) {
  const byBlock = Object.fromEntries(data.summary.rows.map((r) => [r.block, r]));
  return (
    <ToggleGroup
      className="cel-blocks-2x3"
      aria-label="Bed blocks"
      value={[selectedBlock]}
      onValueChange={(next) => {
        if (next[0]) onSelectBlock(next[0]);
      }}
    >
      {["B3", "B4", "B5", "B6", "B7", "B8"].map((b) => {
        const row = byBlock[b];
        if (!row) return null;
        return (
          <MiniBlockTile
            key={b}
            block={b}
            row={row}
            data={data}
          />
        );
      })}
    </ToggleGroup>
  );
}

const DEFAULT_HOVER_TEXT = {
  left: "Hover any 1 mm field to inspect exact % keratin",
  right: "",
};

export function BlockInspector({
  data,
  selectedBlock,
}: {
  data: CellularityData;
  selectedBlock: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geoRef = useRef<GridGeometry | null>(null);
  const [showBed, setShowBed] = useState(true);
  const [showNums, setShowNums] = useState(true);
  const [hover, setHover] = useState<{
    block: string;
    cell: [number, number];
    text: { left: string; right: string };
  } | null>(null);

  const slice: SliceMeta | undefined = data.slices.find((s) => s.id === selectedBlock);
  const row: BlockRow | undefined = data.summary.rows.find((r) => r.block === selectedBlock);
  const grid = data.grids[selectedBlock];

  const activeHover = hover?.block === selectedBlock ? hover : null;
  const hoverCell = activeHover?.cell ?? null;
  const hoverText = activeHover?.text ?? DEFAULT_HOVER_TEXT;

  useEffect(() => {
    if (!canvasRef.current || !grid) return;
    geoRef.current = draw2DGrid(canvasRef.current, grid, { showBed, showNums, hoverCell });
  }, [grid, showBed, showNums, hoverCell]);

  if (!grid || !row) {
    return (
      <div className="cel-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{slice ? `${slice.label} · Slice ${slice.slice_num}` : selectedBlock}</h3>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
              {slice ? `${slice.part} · ${slice.x0_mm}–${slice.x1_mm} mm from lateral edge` : ""}
            </div>
          </div>
          <span className="cel-badge">Perp. End-Cap · Unscanned</span>
        </div>
        {slice ? (
          <>
            <div className="cel-stat-mini-grid cel-num">
              <div className="cel-stat-mini"><div className="lbl">End-cap thickness</div><div className="val">{(slice.x1_mm - slice.x0_mm).toFixed(0)} mm</div></div>
              <div className="cel-stat-mini"><div className="lbl">Sectioning</div><div className="val">Perpendicular strips</div></div>
            </div>
            <p style={{ fontSize: 13.2, color: "var(--text-muted)", margin: "10px 0 6px" }}>{slice.report_note}</p>
            <div className="cel-margin-tags">
              {slice.margins.map((m) => <span key={m} className="cel-margin-tag">{m}</span>)}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  const isVirt = row.method.startsWith("virtual");
  const fmt = (v: number | null, d = 2) => (v == null ? "—" : `${v.toFixed(d)}%`);

  return (
    <div className="cel-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>
            {slice ? `${slice.label} · ${slice.slice_num ? `Slice ${slice.slice_num}` : "Margin"}` : `${selectedBlock} · Lymph node`}
          </h3>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
            {row.part} · {grid.w_mm} × {grid.h_mm} mm · {row.n_fields} scored 1 mm fields
          </div>
        </div>
        <span className={`cel-badge ${isVirt ? "blue" : "red"}`}>
          {isVirt ? "Strand Virtual PanCK" : "Real PanKeratin"}
        </span>
      </div>

      {grid.aligned ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            marginBottom: 6,
            padding: "4px 8px",
            borderRadius: 6,
            background: "var(--panel-alt)",
            color: "var(--text-muted)",
          }}
        >
          <span><strong style={{ color: "#be185d" }}>↑ Ant</strong> (magenta) · <strong>↓ Post</strong> (black)</span>
          <span><strong style={{ color: "#2563eb" }}>← Sup</strong> (blue) · <strong style={{ color: "#15803d" }}>→ Inf</strong> (green)</span>
        </div>
      ) : null}

      <div className="cel-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={440}
          height={300}
          onMouseMove={(e) => {
            const geo = geoRef.current;
            if (!geo) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const c = Math.floor((e.clientX - rect.left - geo.ox) / geo.cell);
            const r = Math.floor((e.clientY - rect.top - geo.oy) / geo.cell);
            const key = `${c},${r}`;
            if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows && geo.fieldMap.has(key)) {
              const ca = geo.fieldMap.get(key) ?? 0;
              const inBed = grid.bed[r]?.[c] ? "inside tight bed" : "outside tight bed";
              setHover({
                block: selectedBlock,
                cell: [c, r],
                text: { left: `Field (${c + 1}, ${r + 1}) · ${inBed}`, right: `${ca.toFixed(2)}% keratin` },
              });
            }
          }}
          onMouseLeave={() => {
            setHover(null);
          }}
        />
      </div>

      <div className="cel-hover-readout cel-num">
        <span>{hoverText.left}</span>
        <strong>{hoverText.right}</strong>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        <CelCheckbox checked={showBed} onCheckedChange={setShowBed} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          Tight-bed outline
        </CelCheckbox>
        <CelCheckbox checked={showNums} onCheckedChange={setShowNums} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          Label ≥1% fields
        </CelCheckbox>
      </div>

      <div className="cel-stat-mini-grid cel-num">
        <div className="cel-stat-mini"><div className="lbl">Whole section (area / solid)</div><div className="val">{fmt(row.whole_area, 2)} / {fmt(row.whole_solid, 2)}</div></div>
        <div className="cel-stat-mini"><div className="lbl">Tight bed (area / solid)</div><div className="val">{fmt(row.tight_area, 1)} / {fmt(row.tight_solid, 1)}</div></div>
        <div className="cel-stat-mini"><div className="lbl">Hottest 1 mm / 2 mm field</div><div className="val">{row.max1.toFixed(1)}% / {row.max2.toFixed(1)}%</div></div>
        <div className="cel-stat-mini"><div className="lbl">Keratin+ / Tissue area</div><div className="val">{row.keratin_mm2.toFixed(2)} / {row.specimen_mm2.toFixed(0)} mm²</div></div>
      </div>

      <p style={{ fontSize: 13.2, color: "var(--text-muted)", margin: "8px 0 4px" }}>
        {slice ? slice.report_note : data.non_bed_notes[selectedBlock] ?? ""}
      </p>
      {grid.align_note ? (
        <p style={{ fontSize: 11.8, color: "var(--text-muted)", opacity: 0.85, margin: "0 0 6px" }}>{grid.align_note}</p>
      ) : null}
      {slice && slice.margins.length > 0 ? (
        <div className="cel-margin-tags">
          {slice.margins.map((m) => <span key={m} className="cel-margin-tag">{m}</span>)}
        </div>
      ) : null}
    </div>
  );
}
