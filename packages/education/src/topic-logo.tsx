import type { ReactNode } from "react";

const face = <><circle cx="27" cy="32" r="1.4" fill="currentColor" stroke="none" /><circle cx="37" cy="32" r="1.4" fill="currentColor" stroke="none" /><path d="M29 38q3 3 6 0" /></>;
const soft = "var(--edu-soft)";

// Small, two-tone drawings shared by both education readers.
const drawings: Record<string, ReactNode> = {
  overview: <><path fill={soft} d="M10 16q11-4 22 2 11-6 22-2v33q-11-4-22 2-11-6-22-2Z" /><path d="M32 18v33M17 24h7m-7 6h7m16-6h7m-7 6h7" /><path d="M22 38q3 4 6 0m8 0q3 4 6 0" /></>,
  "oncology-101": <><path fill={soft} d="M49 17c8 9 7 24-2 32s-24 7-32-2-7-24 2-32 24-7 32 2Z" /><circle cx="32" cy="33" r="13" fill={soft} />{face}<path d="M17 25h2m25 17h2m-5-24h2" /></>,
  "cellular-therapies": <><path fill={soft} d="m32 9 20 8v16c0 11-9 18-20 23-11-5-20-12-20-23V17Z" /><path fill={soft} d="M22 26q-3-8 5-7 4-7 10-2 8-2 9 6 6 5 1 11 1 8-7 9-5 6-11 1-8 1-9-7-5-6 2-11Z" />{face}</>,
  tools: <><rect x="11" y="14" width="42" height="38" rx="7" fill={soft} /><path d="M11 25h42m-29-11v-4h16v4M23 34v10m-5-5h10m13-4h.1m5 6h.1" /></>,
  concepts: <><path fill={soft} d="M21 40a18 18 0 1 1 22 0l-3 6H24Z" />{face}<path d="M25 51h14m-12 5h10M32 4v3M9 13l3 3m40-3-3 3M5 31h4m46 0h4" /></>,
  images: <><rect x="9" y="12" width="46" height="40" rx="7" fill={soft} /><circle cx="42" cy="24" r="5" fill={soft} /><path fill={soft} d="m13 45 13-15 9 10 6-6 10 11" /><circle cx="23" cy="39" r="1.2" fill="currentColor" stroke="none" /><circle cx="29" cy="39" r="1.2" fill="currentColor" stroke="none" /><path d="M24 43q2 2 4 0" /></>,
  guides: <><circle cx="32" cy="33" r="23" fill={soft} /><path fill={soft} d="m39 20-3 17-13 9 3-17Z" /><circle cx="32" cy="33" r="3" fill="currentColor" stroke="none" /><path d="M32 14v3m0 32v3M13 33h3m32 0h3" /></>,
  "modeling-tumor-response": <><rect x="9" y="13" width="46" height="36" rx="7" fill={soft} /><path d="M17 37h7l6-12 8 16 5-8h5M26 56h12m-6-7v7" /><circle cx="18" cy="22" r="1.3" fill="currentColor" stroke="none" /><circle cx="24" cy="22" r="1.3" fill="currentColor" stroke="none" /></>,
  "molecular-profiling": <><path d="M21 9c0 15 22 16 22 31 0 6-3 10-6 15M43 9c0 15-22 16-22 31 0 6 3 10 6 15" /><path stroke={soft} strokeWidth="7" d="M24 14h16M24 49h16M24 36h16" /><path d="M24 14h16m-13 9h10m-10 0h10M24 36h16m-16 13h16" /><circle cx="29" cy="36" r="1.3" fill="currentColor" stroke="none" /><circle cx="35" cy="36" r="1.3" fill="currentColor" stroke="none" /></>,
  "multi-omics-foundations": <><path fill={soft} d="m32 7 24 13-24 13L8 20Z" /><path fill={soft} d="m8 31 24 13 24-13M8 42l24 13 24-13" /><circle cx="27" cy="19" r="1.3" fill="currentColor" stroke="none" /><circle cx="37" cy="19" r="1.3" fill="currentColor" stroke="none" /><path d="M29 24q3 3 6 0" /></>,
  "reading-a-tumor": <><path fill={soft} d="M17 9h23l9 9v32a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V14a5 5 0 0 1 5-5Z" /><path d="M39 9v11h10M21 25h11m-11 7h7m-7 7h5" /><circle cx="40" cy="39" r="10" fill={soft} /><path d="m47 47 8 8M36 37h.1m8 0h.1m-6 5q2 2 4 0" /></>,
  "targeted-therapy-modalities": <><circle cx="30" cy="34" r="22" fill={soft} /><circle cx="30" cy="34" r="13" /><circle cx="30" cy="34" r="4" fill="currentColor" stroke="none" /><path d="m33 31 20-20m-9 0h9v9" /><path d="M23 44q7 5 14 0" /></>,
  "local-treatment-modalities": <><path fill={soft} d="M46 24c9 13 1 31-14 31S9 37 18 24c-1 8 5 9 7 3 2-5 0-11 7-19 0 12 11 11 10 24 4-1 5-5 4-8Z" />{face}</>,
  "designing-a-vaccine": <><rect x="22" y="8" width="20" height="8" rx="3" fill={soft} /><path fill={soft} d="M25 16v6l-8 8v20a5 5 0 0 0 5 5h20a5 5 0 0 0 5-5V30l-8-8v-6Z" /><path d="M17 29h30m-30 17h30" />{face}<path d="M51 11v8m-4-4h8" /></>,
};

export function TopicLogo({ topic, size = 33.6, className = "" }: { topic: string; size?: number; className?: string }) {
  return <svg className={`edu-topic-logo ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {drawings[topic] ?? drawings.overview}
  </svg>;
}
