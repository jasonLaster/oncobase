import type { CellularityData } from "./types";

type Props = {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
};

export function AnatomicalContextDiagram({
  data,
  selectedBlock,
  onSelectBlock,
}: Props) {
  const { anatomy, specimen } = data.report;
  const bedLen = specimen.bed_length_mm;
  const mmX = (mm: number) => 255 + (mm / bedLen) * 459.2;
  const mastX0 = mmX(anatomy.outer_bed.x0_mm);
  const mastX1 = mmX(anatomy.outer_bed.x1_mm);
  const bX0 = mmX(0);
  const bX1 = mmX(bedLen);
  const bY0 = 56;
  const bY1 = 148;
  const bH = bY1 - bY0;
  const latId = anatomy.lateral_shave.block_id;

  return (
    <div className="cel-card" style={{ marginBottom: 16, padding: "15px 18px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <strong style={{ fontSize: 14 }}>{anatomy.title}</strong>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", marginLeft: 8 }}>
            {anatomy.subtitle}
          </span>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          {anatomy.scale_note}
        </span>
      </div>

      <div className="cel-canvas-wrap" style={{ padding: "6px 10px" }}>
        <svg viewBox="0 0 1080 206" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            <pattern id="celPerpHatch" width="6" height="6" patternUnits="userSpaceOnUse">
              <line x1="0" y1="3" x2="6" y2="3" stroke="#9e998c" strokeWidth="1" />
            </pattern>
          </defs>

          <rect
            x={mastX0}
            y={10}
            width={mastX1 - mastX0}
            height={186}
            rx={12}
            fill="#f7f4ee"
            stroke="#c8c2b2"
            strokeWidth={1.3}
            strokeDasharray="6,4"
          />
          <text x={mastX0 + 12} y={27} fontSize={11} fontWeight={600} fill="#6c6960">
            {anatomy.outer_bed.label}
          </text>
          <text x={mastX0 + 14} y={102} fontSize={10} fill="#848179">{anatomy.outer_bed.left_tag}</text>
          <text x={mastX0 + 14} y={115} fontSize={10} fill="#848179">residual</text>
          <text x={mastX1 - 64} y={102} fontSize={10} fill="#848179">{anatomy.outer_bed.right_tag}</text>
          <text x={mastX1 - 64} y={115} fontSize={10} fill="#848179">residual</text>

          {/* Superior Shave */}
          <rect
            x={mmX(anatomy.superior_shave.x0_mm)}
            y={38}
            width={mmX(anatomy.superior_shave.x1_mm) - mmX(anatomy.superior_shave.x0_mm)}
            height={14}
            rx={4}
            fill="#e7f6ec"
            stroke="#15803d"
            strokeWidth={1}
          />
          <text
            x={mmX((anatomy.superior_shave.x0_mm + anatomy.superior_shave.x1_mm) / 2)}
            y={48.5}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={600}
            fill="#15803d"
          >
            {anatomy.superior_shave.label}
          </text>

          {/* Medial Shave */}
          <rect
            x={bX1 + 10}
            y={bY0 + 12}
            width={112}
            height={bH - 24}
            rx={6}
            fill="#e7f6ec"
            stroke="#15803d"
            strokeWidth={1}
          />
          {anatomy.medial_shave.lines.map((line, i) => (
            <text
              key={line}
              x={bX1 + 66}
              y={bY0 + 42 + i * 13}
              textAnchor="middle"
              fontSize={i === 0 ? 10 : 9.5}
              fontWeight={i === 0 ? 600 : 400}
              fill="#15803d"
            >
              {line}
            </text>
          ))}

          {/* Lateral Shave */}
          <g onClick={() => onSelectBlock(latId)} style={{ cursor: "pointer" }}>
            <rect
              x={bX0 - 94}
              y={bY0 + 10}
              width={84}
              height={bH - 20}
              rx={6}
              fill={selectedBlock === latId ? "#fde2d8" : "#fff5f0"}
              stroke={selectedBlock === latId ? "#161614" : "#d9481f"}
              strokeWidth={selectedBlock === latId ? 2.2 : 1.2}
            />
            {anatomy.lateral_shave.lines.map((line, i) => (
              <text
                key={line}
                x={bX0 - 52}
                y={bY0 + 36 + i * 13}
                textAnchor="middle"
                fontSize={i === 0 ? 10.5 : 9.2}
                fontWeight={i === 0 ? 700 : 400}
                fill={i === 2 ? "#5b5953" : "#8f1d14"}
              >
                {line}
              </text>
            ))}
          </g>

          {/* Primary Bed Box */}
          <rect
            x={bX0}
            y={bY0}
            width={bX1 - bX0}
            height={bH}
            rx={4}
            fill="#ffffff"
            stroke="#161614"
            strokeWidth={1.5}
          />

          {data.slices
            .filter((s) => s.in_bed)
            .map((s) => {
              const x0 = mmX(s.x0_mm);
              const x1 = mmX(s.x1_mm);
              const w = x1 - x0;
              const isSel = s.id === selectedBlock;
              const isVirt = s.kind === "virtual";
              const isFocus = s.id === specimen.focus_block;

              if (!s.scanned) {
                return (
                  <g key={s.id} onClick={() => onSelectBlock(s.id)} style={{ cursor: "pointer" }}>
                    <rect
                      x={x0}
                      y={bY0}
                      width={w}
                      height={bH}
                      fill="url(#celPerpHatch)"
                      stroke={isSel ? "#161614" : "#9c988d"}
                      strokeWidth={isSel ? 2.2 : 1}
                    />
                    <text x={x0 + w / 2} y={bY0 + 38} textAnchor="middle" fontSize={10} fontWeight={700} fill="#5b5953">
                      {s.label}
                    </text>
                    <text x={x0 + w / 2} y={bY0 + 51} textAnchor="middle" fontSize={8.5} fill="#78756e">
                      perp. cap
                    </text>
                    <text x={x0 + w / 2} y={bY0 + 63} textAnchor="middle" fontSize={8.5} fill="#78756e">
                      unscanned
                    </text>
                  </g>
                );
              }

              const st = s.stats;
              const fill = isFocus
                ? isSel
                  ? "#fbd5c8"
                  : "#fde8e0"
                : isSel
                  ? isVirt
                    ? "#dbeafe"
                    : "#f5ede8"
                  : isVirt
                    ? "#f3f7ff"
                    : "#faf9f5";
              const stroke = isSel ? "#161614" : isVirt ? "#60a5fa" : "#b8b4a8";

              return (
                <g key={s.id} onClick={() => onSelectBlock(s.id)} style={{ cursor: "pointer" }}>
                  <rect
                    x={x0 + 1}
                    y={bY0 + 1}
                    width={w - 2}
                    height={bH - 2}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSel ? 2.2 : 1}
                    strokeDasharray={isVirt && !isSel ? "3,2" : undefined}
                  />
                  <line
                    x1={x0 + w / 2}
                    y1={bY0 + 6}
                    x2={x0 + w / 2}
                    y2={bY1 - 6}
                    stroke={isVirt ? "rgba(37,99,235,0.35)" : "rgba(217,72,31,0.4)"}
                    strokeWidth={1.4}
                  />
                  {isFocus ? (
                    <ellipse cx={x0 + w / 2} cy={bY0 + 25} rx={8} ry={12} fill="#c92a2a" opacity={0.82} />
                  ) : null}
                  <text
                    x={x0 + w / 2}
                    y={bY0 + 50}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={isVirt ? "#1d4ed8" : "#161614"}
                  >
                    {s.label}
                  </text>
                  <text x={x0 + w / 2} y={bY0 + 64} textAnchor="middle" fontSize={9.5} fill="#5b5953">
                    {st ? `${st.whole_area.toFixed(2)}%` : "—"}
                  </text>
                  <text
                    x={x0 + w / 2}
                    y={bY0 + 78}
                    textAnchor="middle"
                    fontSize={8.5}
                    fill={isVirt ? "#2563eb" : "#8f1d14"}
                  >
                    {isVirt ? "virtual" : "real"}
                  </text>
                </g>
              );
            })}

          {/* Bottom ruler */}
          <line x1={bX0} y1={bY1 + 10} x2={bX1} y2={bY1 + 10} stroke="#161614" strokeWidth={1.2} />
          <line x1={bX0} y1={bY1 + 6} x2={bX0} y2={bY1 + 14} stroke="#161614" strokeWidth={1.2} />
          <line x1={bX1} y1={bY1 + 6} x2={bX1} y2={bY1 + 14} stroke="#161614" strokeWidth={1.2} />
          <text x={(bX0 + bX1) / 2} y={bY1 + 25} textAnchor="middle" fontSize={10.2} fontWeight={600} fill="#161614">
            {anatomy.ruler_label}
          </text>
          <text x={bX0 - 10} y={bY1 + 14} textAnchor="end" fontSize={9.5} fontWeight={600} fill="#d9481f">
            {anatomy.left_ink_label}
          </text>
          <text x={bX1 + 10} y={bY1 + 14} textAnchor="start" fontSize={9.5} fontWeight={600} fill="#9a7400">
            {anatomy.right_ink_label}
          </text>

          {/* Separate Nodes box */}
          <g transform="translate(918, 42)">
            <rect x={0} y={0} width={148} height={106} rx={8} fill="#ffffff" stroke="#e2dfd5" />
            <text x={10} y={18} fontSize={10} fontWeight={700} fill="#5b5953">{anatomy.nodes_box.title}</text>
            <text x={10} y={34} fontSize={10} fill="#161614">{anatomy.nodes_box.subtitle}</text>
            {anatomy.nodes_box.items.map((item, idx) =>
              item.block_id ? (
                <text
                  key={item.text}
                  x={10}
                  y={52 + idx * 16}
                  fontSize={9.5}
                  fill="#2563eb"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => onSelectBlock(item.block_id!)}
                >
                  {item.text}
                </text>
              ) : (
                <text key={item.text} x={10} y={52 + idx * 16} fontSize={9.5} fill="#5b5953">
                  {item.text}
                </text>
              ),
            )}
            <text x={10} y={98} fontSize={9} fill="#848179">{anatomy.nodes_box.footer}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
