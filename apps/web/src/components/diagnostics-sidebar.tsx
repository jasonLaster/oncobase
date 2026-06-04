"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  DIAGNOSTIC_BIOPSIES,
  getDicomViewerHref,
} from "@/lib/diagnostic-biopsies";

const ROW_HEIGHT = 42;

export function DiagnosticsSidebar() {
  return (
    <Suspense fallback={<DiagnosticsSidebarFrame activeBiopsyId={null} />}>
      <DiagnosticsSidebarContent />
    </Suspense>
  );
}

function DiagnosticsSidebarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeBiopsyId =
    pathname.startsWith("/tools/dicom-viewer")
      ? searchParams.get("id") ?? searchParams.get("biopsyId")
      : null;

  return <DiagnosticsSidebarFrame activeBiopsyId={activeBiopsyId} />;
}

function DiagnosticsSidebarFrame({ activeBiopsyId }: { activeBiopsyId: string | null }) {
  return (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="diagnostics-sidebar"
    >
      <nav
        className="min-h-0 flex-1 select-none overflow-y-auto p-2"
        data-test-id="sidebar-tree"
      >
        <div className="space-y-1">
          {DIAGNOSTIC_BIOPSIES.map((biopsy) => (
            <Link
              key={biopsy.id}
              href={getDicomViewerHref(biopsy.id)}
              data-selected-file-tree-item={
                activeBiopsyId === biopsy.id ? "true" : undefined
              }
              className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                activeBiopsyId === biopsy.id
                  ? "bg-[var(--accent-light)] font-medium text-[var(--foreground)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
              }`}
              style={{ minHeight: ROW_HEIGHT }}
              title={biopsy.title}
            >
              <span className="block truncate">{biopsy.title}</span>
              <span className="block truncate text-[11px] font-normal text-[var(--text-muted)]">
                {biopsy.focus}
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </aside>
  );
}
