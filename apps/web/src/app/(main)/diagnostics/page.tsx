import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  FileText,
  ScanSearch,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DIAGNOSTIC_BIOPSIES,
  getDicomViewerHref,
  type DiagnosticBiopsy,
} from "@/lib/diagnostic-biopsies";

export const metadata = {
  title: "Diagnostics",
};

export default function DiagnosticsPage() {
  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Diagnostics</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Imaging shortcuts with linked reports and source files.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {DIAGNOSTIC_BIOPSIES.length} studies
          </Badge>
        </header>

        <section className="grid gap-3">
          {DIAGNOSTIC_BIOPSIES.map((biopsy) => {
            const reportLinks = getReportLinks(biopsy);
            return (
              <article key={biopsy.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground">
                      {biopsy.shortLabel}
                    </Badge>
                    <Badge variant="outline">{biopsy.modality}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {biopsy.id}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold tracking-normal">
                    {biopsy.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-4" />
                      {biopsy.dateLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <ScanSearch className="size-4" />
                      {biopsy.focus}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <DiagnosticsActionLink
                    href={getDicomViewerHref(biopsy.id)}
                    icon={<ScanSearch className="size-4" />}
                    label="Open viewer"
                    primary
                  />
                  {reportLinks.map((link) => (
                    <DiagnosticsActionLink
                      key={`${biopsy.id}-${link.href}`}
                      href={link.href}
                      icon={<FileText className="size-4" />}
                      label={link.label}
                    />
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function getReportLinks(biopsy: DiagnosticBiopsy) {
  return biopsy.reportLinks ?? [{ label: "Pathology report", href: biopsy.pathologyReportHref }];
}

function DiagnosticsActionLink({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    : "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

  return (
    <Link href={href} className={className}>
      {icon}
      {label}
      <ArrowUpRight className="size-4" />
    </Link>
  );
}
