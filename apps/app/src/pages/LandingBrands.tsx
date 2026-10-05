import { Network } from "lucide-react";

export function DianaMark() {
  return (
    <svg className="lp-diana-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="currentColor" />
      <text
        x="16"
        y="23"
        fill="white"
        fontFamily="system-ui, sans-serif"
        fontSize="22"
        fontWeight="700"
        textAnchor="middle"
      >
        D
      </text>
    </svg>
  );
}

export function DianaBrand() {
  return (
    <>
      <DianaMark />
      <span className="lp-diana-wordmark">
        Diana <span>TNBC</span>
      </span>
    </>
  );
}

export function OncobaseBrand() {
  return (
    <span className="lp-brand lp-oncobase-brand">
      <span className="lp-brand-mark" aria-hidden="true">
        <Network size={22} strokeWidth={1.8} />
      </span>
      <span>
        oncobase<span className="lp-brand-period">.</span>
      </span>
    </span>
  );
}

/** Curved lines behind Diana's hero and sign-in art. */
export function VillageTexture() {
  return (
    <div className="lp-village-texture" aria-hidden="true">
      {["left", "right"].map((side) => (
        <svg
          key={side}
          className={`lp-flutes lp-flutes-${side}`}
          viewBox="0 0 640 900"
          fill="none"
        >
          {Array.from({ length: 22 }, (_, index) => (
            <path
              key={index}
              d="M -180 880 C 350 1010 460 620 190 515 C -150 385 -40 160 220 110 C 450 65 490 -130 300 -220"
              transform={`translate(${index * 16 - 160} ${index * 6})`}
              stroke="currentColor"
              strokeWidth="1"
            />
          ))}
        </svg>
      ))}
    </div>
  );
}

/** A lab-notebook dot grid, with a few friendly science doodles beside the education heading. */
export function EducationTexture() {
  const line = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
  return (
    <div className="lp-edu-texture" aria-hidden="true">
      <div className="lp-edu-dots" />
      <div className="lp-edu-doodles">
        {/* A cell with a face and a nucleus */}
        <svg className="lp-doodle" viewBox="0 0 96 96" style={{ left: 148, top: 6, width: 92, transform: "rotate(-8deg)" }}>
          <path d="M48 10c20 0 36 14 36 36 0 22-15 40-37 40C25 86 12 70 12 48 12 26 28 10 48 10z" {...line} fill="var(--lp-soft)" />
          <circle cx="38" cy="34" r="12" {...line} />
          <circle cx="42" cy="58" r="2.2" fill="currentColor" />
          <circle cx="60" cy="58" r="2.2" fill="currentColor" />
          <path d="M44 67q8 6 16 0" {...line} />
        </svg>
        {/* DNA */}
        <svg className="lp-doodle" viewBox="0 0 48 120" style={{ left: 292, top: 52, width: 40, transform: "rotate(14deg)" }}>
          <path d="M10 4C42 20 42 40 10 60s0 40 28 56" {...line} />
          <path d="M38 4C6 20 6 40 38 60S38 100 10 116" {...line} />
          <path d="M17 14h14M13 30h22M13 46h22M17 78h14M13 92h22M17 108h14" {...line} strokeWidth={1.4} />
        </svg>
        {/* A molecule */}
        <svg className="lp-doodle" viewBox="0 0 96 96" style={{ left: 8, top: 74, width: 78, transform: "rotate(10deg)" }}>
          <path d="M48 14l22 13v26L48 66 26 53V27z" {...line} />
          <path d="M70 27l16-9M26 53L12 61M48 66v16" {...line} />
          <circle cx="86" cy="18" r="5" {...line} fill="var(--lp-soft)" />
          <circle cx="10" cy="62" r="5" {...line} fill="var(--lp-soft)" />
          <circle cx="48" cy="86" r="5" {...line} fill="var(--lp-soft)" />
        </svg>
        {/* An antibody */}
        <svg className="lp-doodle" viewBox="0 0 80 80" style={{ left: 196, top: 124, width: 60, transform: "rotate(-12deg)" }}>
          <path d="M40 76V44M40 44 16 16M40 44l24-28" {...line} strokeWidth={3} />
          <ellipse cx="14" cy="13" rx="6" ry="5" {...line} fill="var(--lp-soft)" />
          <ellipse cx="66" cy="13" rx="6" ry="5" {...line} fill="var(--lp-soft)" />
        </svg>
        {/* Sparkles */}
        {[
          { left: 118, top: 128, width: 22 },
          { left: 270, top: 6, width: 16 },
          { left: 98, top: 24, width: 12 },
          { left: 338, top: 170, width: 18 },
        ].map((spark) => (
          <svg className="lp-doodle lp-doodle-spark" key={`${spark.left}-${spark.top}`} viewBox="0 0 24 24" style={spark}>
            <path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10z" fill="currentColor" />
          </svg>
        ))}
      </div>
    </div>
  );
}
