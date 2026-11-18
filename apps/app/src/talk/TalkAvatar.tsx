import { forwardRef } from "react";

const MOSS = "#7d9a6a";
const INK = "#1d2224";

/** Sprig, a round moss sprite with a two-leaf sprout. CSS animates it from
 * `data-state`, and the live audio level arrives through the --talk-level
 * custom property, so a moving mouth never re-renders React. Static colors
 * live on the SVG to keep the reader's eager stylesheet small. */
export const TalkAvatar = forwardRef<HTMLSpanElement, { state: string }>(function TalkAvatar({ state }, ref) {
  return (
    <span ref={ref} className="wiki-vite-talk-avatar" data-state={state} aria-hidden="true">
      <span className="wiki-vite-talk-avatar-halo" />
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <g className="wiki-vite-talk-avatar-ears">
          <path fill="none" stroke="#56703f" strokeWidth="2" strokeLinecap="round" d="M32 16V8" />
          <path fill="#9cc47c" d="M32 9C27 3 20 4 19 8c4 4 9 4 13 1Z" />
          <path fill="#b6d68f" d="M32 9c5-6 12-5 13-1-4 4-9 4-13 1Z" />
        </g>
        <ellipse fill={MOSS} cx="32" cy="38" rx="23" ry="22" />
        <ellipse fill="#a9c093" cx="32" cy="44" rx="13" ry="11" />
        <circle fill="#e89a8b" opacity="0.55" cx="17.5" cy="38" r="3.4" />
        <circle fill="#e89a8b" opacity="0.55" cx="46.5" cy="38" r="3.4" />
        <g className="wiki-vite-talk-avatar-eyes" fill={INK}>
          <ellipse fill="#fbfaf5" cx="24" cy="30" rx="4.6" ry="5.2" />
          <ellipse fill="#fbfaf5" cx="40" cy="30" rx="4.6" ry="5.2" />
          <circle cx="24.6" cy="31" r="2.3" />
          <circle cx="40.6" cy="31" r="2.3" />
        </g>
        <ellipse className="wiki-vite-talk-avatar-mouth" fill="#3a2a28" cx="32" cy="39.5" rx="4.5" ry="2.6" />
      </svg>
    </span>
  );
});
