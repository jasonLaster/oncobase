import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight, CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DiagnosticTimeline } from "@/components/timeline/diagnostic-timeline";
import {
  countDiagnosticTimelineEvents,
  type DiagnosticTimelineData,
} from "@/lib/diagnostic-timeline-data";

export const metadata = {
  title: "Diagnostic Timeline",
};

export default async function TimelinePage() {
  const timeline = await fetchDiagnosticTimeline();
  const eventCount = countDiagnosticTimelineEvents(timeline);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-normal">
                Diagnostic Timeline
              </h1>
              <Badge variant="outline" className="gap-1.5">
                <CalendarDays className="size-3.5" />
                As of {timeline.metadata.asOf}
              </Badge>
              <Badge variant="outline">{eventCount} events</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Diagnostic, imaging, molecular, and lab results from February 2026
              onward, with source records and diagnostics viewer links attached.
            </p>
          </div>

          <nav className="flex flex-wrap gap-2">
            {timeline.metadata.sourcePages.map((source) => (
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
