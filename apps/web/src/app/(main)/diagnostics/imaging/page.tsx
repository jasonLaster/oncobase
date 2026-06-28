import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Columns2,
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
  getDicomViewerHref,
  type DiagnosticReportLink,
  type DiagnosticStudy,
} from "@/lib/diagnostic-studies";
import { getDicomCompareHref, type DiagnosticComparisonManifest } from "@/lib/dicom-comparisons";
import { getDiagnosticComparisonsForCurrentSite } from "@/lib/dicom-comparisons-server";
import { getDiagnosticStudiesForCurrentSite } from "@/lib/diagnostic-studies-server";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Diagnostic Imaging",
};

interface DiagnosticImagingPageProps {
  searchParams: Promise<{
    studySet?: string;
  }>;
}

export default async function DiagnosticImagingPage({
  searchParams,
}: DiagnosticImagingPageProps) {
  const params = await searchParams;
  const [studies, comparisons] = await Promise.all([
    getDiagnosticStudiesForCurrentSite(params.studySet),
    getDiagnosticComparisonsForCurrentSite(params.studySet),
  ]);

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
            {studies.length} studies
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
                <col className="w-20" />
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
                    Images
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Comparisons
                  </th>
                  <th scope="col" className="px-3 py-3 text-right sm:px-4">
                    Download
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {studies.map((study) => {
                  const reportLinks = getReportLinks(study);
                  const studyComparisons = getComparisonsForStudy(study, comparisons);
                  return (
                    <tr key={study.id} className="align-top transition-colors hover:bg-muted/30">
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-3 font-medium text-foreground sm:px-4"
                      >
                        {study.dateLabel}
                      </th>
                      <td className="px-3 py-3 sm:px-4">
                        <div className="font-medium text-foreground">
                          {getStudyLabel(study)}
                        </div>
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <Badge variant="outline">{study.modality}</Badge>
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <DiagnosticsReportsMenu links={reportLinks} />
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <DiagnosticsActionLink
                          href={getDicomViewerHref(study.id, params.studySet)}
                          icon={<ImageIcon className="size-4" />}
                          label="Images"
                        />
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        {studyComparisons.length ? (
                          <DiagnosticsComparisonsMenu
                            comparisons={studyComparisons}
                            studySet={params.studySet}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right sm:px-4">
                        <DiagnosticsDownloadLink href={study.downloadHref} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border md:hidden" data-test-id="diagnostics-mobile-list">
            {studies.map((study) => {
              const reportLinks = getReportLinks(study);
              const studyComparisons = getComparisonsForStudy(study, comparisons);
              return (
                <article key={study.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {study.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{study.dateLabel}</span>
                        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                          {study.modality}
                        </Badge>
                      </div>
                    </div>
                    <DiagnosticsActionLink
                      href={getDicomViewerHref(study.id, params.studySet)}
                      icon={<ImageIcon className="size-4" />}
                      label="Images"
                      compact
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <DiagnosticsReportsMenu links={reportLinks} compact />
                    <div className="flex gap-2">
                      {studyComparisons.length ? (
                        <DiagnosticsComparisonsMenu
                          comparisons={studyComparisons}
                          studySet={params.studySet}
                          compact
                        />
                      ) : null}
                      <DiagnosticsDownloadLink href={study.downloadHref} compact />
                    </div>
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

function getStudyLabel(study: DiagnosticStudy) {
  const withoutDate = study.title.replace(
    /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2} /,
    "",
  );

  return withoutDate.charAt(0).toUpperCase() + withoutDate.slice(1);
}

function getReportLinks(study: DiagnosticStudy) {
  return study.reportLinks ?? [{ label: "Pathology report", href: study.pathologyReportHref }];
}

function getComparisonsForStudy(
  study: DiagnosticStudy,
  comparisons: DiagnosticComparisonManifest[],
) {
  if (!isMriStudy(study)) return [];
  return comparisons.filter(
    (comparison) =>
      comparison.leftStudyId === study.id || comparison.rightStudyId === study.id,
  );
}

function isMriStudy(study: DiagnosticStudy) {
  return study.modality.toUpperCase().includes("MR");
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
          <DropdownMenuLabel>Reports</DropdownMenuLabel>
          {links.map((link) => (
            <DropdownMenuItem
              key={link.href}
              render={<Link href={link.href} />}
              className="gap-2"
            >
              <FileText className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {getReportMenuLabel(link.label)}
              </span>
              <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getReportMenuLabel(label: string) {
  const withoutSuffix = label.replace(/\s+report$/i, "").trim();
  return withoutSuffix || label;
}

function DiagnosticsComparisonsMenu({
  comparisons,
  studySet,
  compact = false,
}: {
  comparisons: DiagnosticComparisonManifest[];
  studySet?: string | null;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className="h-8 w-8 justify-center px-0"
            aria-label="Comparisons"
            title="Comparisons"
          />
        }
      >
        <Columns2 className="size-4 shrink-0" />
        <ChevronDown className="size-4 shrink-0" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {comparisons.length === 1 ? "Comparison" : "Comparisons"}
          </DropdownMenuLabel>
          {comparisons.map((comparison) => (
            <DropdownMenuItem
              key={comparison.id}
              render={<Link href={getDicomCompareHref(comparison.id, studySet)} />}
              className="gap-2"
            >
              <Columns2 className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{comparison.label}</span>
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
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-neutral-950 transition-colors hover:border-primary/40 hover:bg-white/90 hover:text-neutral-950 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        compact && "text-xs",
      )}
    >
      {icon}
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
      aria-label="Download source bundle"
      title="Download source bundle"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
      )}
    >
      <Download className="size-4" />
    </a>
  );
}
