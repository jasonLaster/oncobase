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
