import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import {
  WikiEmptyState,
  WikiMarkdownBodySkeleton,
} from "@oncobase/wiki-shell/page-states";
import {
  DiagnosticTimeline,
  type DiagnosticTimelineData,
  type DiagnosticTimelineLink,
} from "@oncobase/diagnostics/timeline";

type TimelineState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: DiagnosticTimelineData; error: null }
  | { status: "error"; data: null; error: string };

export function TimelinePage() {
  const [state, setState] = useState<TimelineState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    const abortController = new AbortController();

    async function loadTimeline() {
      setState({ status: "loading", data: null, error: null });
      try {
        const response = await fetch("/api/timeline", {
          cache: "no-store",
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Timeline request failed with ${response.status}`);
        }
        setState({
          status: "ready",
          data: (await response.json()) as DiagnosticTimelineData,
          error: null,
        });
      } catch (error) {
        if (abortController.signal.aborted) return;
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "Timeline request failed",
        });
      }
    }

    void loadTimeline();
    return () => abortController.abort();
  }, []);

  const navLinks = useMemo(
    () => diagnosticNavLinks(state.data?.metadata.sourcePages ?? []),
    [state.data?.metadata.sourcePages],
  );

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
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                key={source.href}
                to={source.href}
              >
                {source.label}
                <ArrowUpRight className="size-4" />
              </Link>
            ))}
          </nav>
        </header>

        {state.status === "loading" ? (
          <WikiMarkdownBodySkeleton data-test-id="timeline-loading" />
        ) : null}
        {state.status === "error" ? (
          <WikiEmptyState
            data-test-id="timeline-error"
            title="Timeline unavailable"
            description={state.error}
          />
        ) : null}
        {state.data ? <DiagnosticTimeline data={state.data} /> : null}
      </main>
    </div>
  );
}

function diagnosticNavLinks(sourcePages: DiagnosticTimelineLink[]) {
  const summaryPage = sourcePages.find((source) =>
    /summary|test results/i.test(source.label),
  );
  const ctdnaPage = sourcePages.find((source) => /ctdna/i.test(source.label));

  return [
    { label: "Imaging", href: "/diagnostics/imaging" },
    {
      label: "Summary",
      href: summaryPage?.href ?? "/wiki/diagnostics/test-results-summary",
    },
    { label: "ctDNA", href: ctdnaPage?.href ?? "/wiki/diagnostics/ctdna-mrd" },
  ];
}
