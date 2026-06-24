import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight } from "lucide-react";

import { DiagnosticTimeline } from "@/components/timeline/diagnostic-timeline";
import type {
  DiagnosticTimelineData,
  DiagnosticTimelineLink,
} from "@/lib/diagnostic-timeline-data";

export const metadata = {
  title: "Diagnostics",
};

export default async function DiagnosticsPage() {
  const timeline = await fetchDiagnosticTimeline();
  const navLinks = diagnosticNavLinks(timeline.metadata.sourcePages);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal">Diagnostics</h1>
          </div>

          <nav className="flex flex-wrap gap-2">
            {navLinks.map((source) => (
              <Link
                key={source.href}
                href={source.href}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                {source.label}
                <ArrowUpRight className="size-4" />
              </Link>
            ))}
          </nav>
        </header>

        <DiagnosticTimeline data={timeline} />
      </main>
    </div>
  );
}

async function fetchDiagnosticTimeline(): Promise<DiagnosticTimelineData> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) {
    throw new Error("Cannot fetch diagnostic timeline without a request host");
  }

  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = new URL("/api/timeline", `${proto}://${host}`);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      cookie: h.get("cookie") ?? "",
      "x-site-slug": h.get("x-site-slug") ?? "diana",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch diagnostic timeline: ${response.status}`);
  }

  return (await response.json()) as DiagnosticTimelineData;
}

function diagnosticNavLinks(sourcePages: DiagnosticTimelineLink[]) {
  const summaryPage = sourcePages.find((source) =>
    /summary|test results/i.test(source.label),
  );
  const ctdnaPage = sourcePages.find((source) =>
    /ctdna/i.test(source.label),
  );

  return [
    { label: "Imaging", href: "/diagnostics/imaging" },
    {
      label: "Summary",
      href: summaryPage?.href ?? "/wiki/diagnostics/test-results-summary",
    },
    { label: "ctDNA", href: ctdnaPage?.href ?? "/wiki/diagnostics/ctdna-mrd" },
  ];
}
