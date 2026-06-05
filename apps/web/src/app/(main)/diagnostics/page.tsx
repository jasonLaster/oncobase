import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, FileText, ScanSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DIAGNOSTIC_BIOPSIES,
  getDicomViewerHref,
  type DiagnosticBiopsy,
} from "@/lib/diagnostic-biopsies";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Diagnostics",
};

export default function DiagnosticsPage() {
  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
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

        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="hidden md:block" data-test-id="diagnostics-desktop-table">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-28 sm:w-32" />
                <col className="w-32 sm:w-48" />
                <col className="w-20 sm:w-24" />
                <col />
              </colgroup>
              <thead className="border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Study
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {DIAGNOSTIC_BIOPSIES.map((biopsy) => {
                  const reportLinks = getReportLinks(biopsy);
                  return (
                    <tr key={biopsy.id} className="align-top transition-colors hover:bg-muted/30">
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-3 font-medium text-foreground sm:px-4"
                      >
                        {biopsy.dateLabel}
                      </th>
                      <td className="px-3 py-3 sm:px-4">
                        <div className="font-medium text-foreground">
                          {getStudyLabel(biopsy)}
                        </div>
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <Badge variant="outline">{biopsy.modality}</Badge>
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <div className="flex flex-wrap gap-2">
                          <DiagnosticsActionLink
                            href={getDicomViewerHref(biopsy.id)}
                            icon={<ScanSearch className="size-4" />}
                            label="DICOM viewer"
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border md:hidden" data-test-id="diagnostics-mobile-list">
            {DIAGNOSTIC_BIOPSIES.map((biopsy) => {
              const reportLinks = getReportLinks(biopsy);
              return (
                <article key={biopsy.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {biopsy.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{biopsy.dateLabel}</span>
                        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                          {biopsy.modality}
                        </Badge>
                      </div>
                    </div>
                    <DiagnosticsActionLink
                      href={getDicomViewerHref(biopsy.id)}
                      icon={<ScanSearch className="size-4" />}
                      label="DICOM viewer"
                      primary
                      compact
                    />
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {reportLinks.map((link) => (
                      <DiagnosticsActionLink
                        key={`${biopsy.id}-${link.href}`}
                        href={link.href}
                        icon={<FileText className="size-4" />}
                        label={link.label}
                        compact
                      />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function getStudyLabel(biopsy: DiagnosticBiopsy) {
  const withoutDate = biopsy.title.replace(
    /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2} /,
    "",
  );

  return withoutDate.charAt(0).toUpperCase() + withoutDate.slice(1);
}

function getReportLinks(biopsy: DiagnosticBiopsy) {
  return biopsy.reportLinks ?? [{ label: "Pathology report", href: biopsy.pathologyReportHref }];
}

function DiagnosticsActionLink({
  href,
  icon,
  label,
  primary = false,
  compact = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
  compact?: boolean;
}) {
  const className = primary
    ? "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-sm font-medium whitespace-nowrap text-neutral-950 transition-colors hover:border-primary/40 hover:bg-white/90 hover:text-neutral-950 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    : "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

  return (
    <Link href={href} className={cn(className, compact && "px-2 text-xs")}>
      {icon}
      {label}
      <ArrowUpRight className="size-4" />
    </Link>
  );
}
