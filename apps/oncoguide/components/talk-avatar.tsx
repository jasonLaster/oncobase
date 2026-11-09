import { forwardRef } from "react";

/** A small round companion. CSS animates it from `data-state`, and the live
 * audio level arrives through the --talk-level custom property. */
export const TalkAvatar = forwardRef<HTMLSpanElement, { state: string }>(function TalkAvatar({ state }, ref) {
  return <span ref={ref} className="edu-talk-avatar" data-state={state} aria-hidden="true">
    <span className="edu-talk-avatar-halo" />
    <svg viewBox="0 0 64 64" width="100%" height="100%">
      <circle className="edu-talk-avatar-body" cx="32" cy="32" r="26" />
      <path className="edu-talk-avatar-shine" d="M17 24c3-6 8-9 14-10" />
      <g className="edu-talk-avatar-eyes">
        <ellipse cx="24" cy="29" rx="3.2" ry="4.2" />
        <ellipse cx="40" cy="29" rx="3.2" ry="4.2" />
      </g>
      <ellipse className="edu-talk-avatar-mouth" cx="32" cy="42" rx="6" ry="4" />
    </svg>
  </span>;
});
