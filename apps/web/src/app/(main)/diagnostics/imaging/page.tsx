import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Download,
  FileText,
  ImageIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DIAGNOSTIC_BIOPSIES,
  getDicomViewerHref,
  type DiagnosticBiopsy,
  type DiagnosticReportLink,
} from "@/lib/diagnostic-biopsies";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Diagnostic Imaging",
};

export default function DiagnosticImagingPage() {
  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Imaging</h1>
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
                <col />
                <col className="w-20 sm:w-24" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-32" />
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
                    Reports
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    View images
                  </th>
                  <th scope="col" className="px-3 py-3 text-right sm:px-4">
                    Download
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
                        <DiagnosticsReportsMenu links={reportLinks} />
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <DiagnosticsActionLink
                          href={getDicomViewerHref(biopsy.id)}
                          icon={<ImageIcon className="size-4" />}
                          label="View images"
                        />
                      </td>
                      <td className="px-3 py-3 text-right sm:px-4">
                        <DiagnosticsDownloadLink href={biopsy.downloadHref} />
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
                      icon={<ImageIcon className="size-4" />}
                      label="View images"
                      compact
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <DiagnosticsReportsMenu links={reportLinks} compact />
                    <DiagnosticsDownloadLink href={biopsy.downloadHref} compact />
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

function DiagnosticsReportsMenu({
  links,
  compact = false,
}: {
  links: DiagnosticReportLink[];
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className={cn("w-full justify-between", compact && "text-xs")}
          />
        }
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <FileText className="size-4 shrink-0" />
          <span className="truncate">Reports</span>
        </span>
        <ChevronDown className="size-4 shrink-0" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {links.length === 1 ? "Report" : "Reports"}
          </DropdownMenuLabel>
          {links.map((link) => (
            <DropdownMenuItem
              key={link.href}
              render={<Link href={link.href} />}
              className="gap-2"
            >
              <FileText className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiagnosticsActionLink({
  href,
  icon,
  label,
  compact = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-sm font-medium whitespace-nowrap text-neutral-950 transition-colors hover:border-primary/40 hover:bg-white/90 hover:text-neutral-950 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        compact && "px-2 text-xs",
      )}
    >
      {icon}
      {label}
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

function DiagnosticsDownloadLink({
  href,
  compact = false,
}: {
  href?: string;
  compact?: boolean;
}) {
  if (!href) {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-fit shrink-0 items-center justify-center rounded-lg border border-dashed border-border px-2.5 text-sm text-muted-foreground",
          compact && "px-2 text-xs",
        )}
      >
        No bundle
      </span>
    );
  }

  return (
    <a
      href={href}
      download
      className={cn(
        "inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        compact && "px-2 text-xs",
      )}
    >
      <Download className="size-4" />
      Download
    </a>
  );
}
