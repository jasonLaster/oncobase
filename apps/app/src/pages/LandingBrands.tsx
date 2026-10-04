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
