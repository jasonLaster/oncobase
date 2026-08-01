import type { ReactNode } from "react";

/**
 * Mirrors the `fixPdfLinks` decoration in `server.ts` so the React renderer and
 * the server-rendered HTML produce the same chip for file-API PDF links.
 */
const PDF_CHIP_HREF_PATTERN = /\/api\/file\?path=[^"]*\.pdf(?:[?#&][^"]*)?$/i;

export function isPdfChipHref(href: string | undefined): href is string {
  return Boolean(href && PDF_CHIP_HREF_PATTERN.test(href));
}

export function pdfChipFileName(href: string, fallback: string) {
  const rawPath = href.match(/[?&]path=([^&#]*)/)?.[1] ?? "";
  if (!rawPath) return fallback;
  try {
    return decodeURIComponent(rawPath).split("/").pop() || fallback;
  } catch {
    return rawPath.split("/").pop() || fallback;
  }
}

function PdfDocIcon() {
  return (
    <svg
      width="11"
      height="13"
      viewBox="0 0 11 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M6.5 1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.5L6.5 1Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M6.5 1v3.5H10" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <line
        x1="2.5"
        y1="7.5"
        x2="8.5"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.7"
      />
      <line
        x1="2.5"
        y1="9.5"
        x2="6.5"
        y2="9.5"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function ExternalArrowIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.65 }}
    >
      <path
        d="M1.5 7.5 7.5 1.5M4.5 1.5H7.5V4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PdfChipLink({
  fallbackLabel,
  href,
}: {
  fallbackLabel: ReactNode;
  href: string;
}) {
  const fileName = pdfChipFileName(
    href,
    typeof fallbackLabel === "string" ? fallbackLabel : "",
  );

  return (
    <a className="pdf-chip" href={href} rel="noopener noreferrer" target="_blank">
      <PdfDocIcon />
      <span>{fileName || fallbackLabel}</span>
      <ExternalArrowIcon />
    </a>
  );
}
