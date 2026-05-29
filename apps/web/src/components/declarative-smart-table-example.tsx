"use client";

import {
  SmartTable,
  SmartTableBody,
  SmartTableCell,
  SmartTableHead,
  SmartTableHeader,
  SmartTableRow,
} from "@oncobase/smart-table";
import {
  featuredExampleTables,
  resizeAuditExampleTables,
  type ExampleTableDefinition,
} from "@oncobase/smart-table/examples";
import { webSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

const liveScenarioExamples = featuredExampleTables.filter((example) =>
  example.apiModes.includes("declarative")
);

const resizeAuditIds = new Set(resizeAuditExampleTables.map((example) => example.id));

function ScenarioTable({
  example,
  persistenceKey,
}: {
  example: ExampleTableDefinition;
  persistenceKey: string;
}) {
  return (
    <SmartTable
      layoutAdapter={webSmartTableLayoutAdapter}
      persistenceKey={persistenceKey}
    >
      <SmartTableHeader>
        <SmartTableRow>
          {example.headers.map((header) => (
            <SmartTableHead key={header}>{header}</SmartTableHead>
          ))}
        </SmartTableRow>
      </SmartTableHeader>
      <SmartTableBody>
        {example.rows.map((row, index) => (
          <SmartTableRow key={`${example.id}-${index}`}>
            {row.map((cell, cellIndex) => (
              <SmartTableCell key={`${index}-${cellIndex}`}>{cell}</SmartTableCell>
            ))}
          </SmartTableRow>
        ))}
      </SmartTableBody>
    </SmartTable>
  );
}

function ScenarioBadges({ labels }: { labels: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-[var(--sidebar-border)] bg-[var(--background)]/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function DeclarativeSmartTableExample() {
  return (
    <section data-smart-table-showcase className="mb-12 space-y-10">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/45 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Live Scenarios
          </p>
          <p className="mt-3 text-3xl font-semibold">{liveScenarioExamples.length}</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Declarative tables that exercise expansion, overflow, compact
            layouts, and long wrapped prose.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/45 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Resize Audit
          </p>
          <p className="mt-3 text-3xl font-semibold">{resizeAuditExampleTables.length}</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Fixtures we use to check resize smoothness, persistence, and
            scroll-lane behavior.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/45 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Markdown Parity
          </p>
          <p className="mt-3 text-3xl font-semibold">1 page</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            The markdown-rendered fixtures below keep the DOM enhancer and the
            React API aligned.
          </p>
        </div>
      </div>

      <section data-smart-table-performance-summary className="rounded-3xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/35 p-6">
        <div className="max-w-4xl">
          <h2 className="text-2xl font-semibold">Resize Performance Audit</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            These scenarios are the ones to drag when we care about 60fps.
            They cover long wrapped prose, compact numeric columns, and a table
            that is already overflowing before any manual resize happens.
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {resizeAuditExampleTables.map((example) => (
            <a
              key={example.id}
              href={`#scenario-${example.id}`}
              className="rounded-2xl border border-[var(--sidebar-border)] bg-[var(--background)]/60 p-4 no-underline transition-colors hover:bg-[var(--accent-light)]/20"
            >
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {example.title}
              </p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {example.recommendedChecks[0]}
              </p>
            </a>
          ))}
        </div>
      </section>

      <section data-smart-table-live-scenarios className="space-y-6">
        <div className="max-w-4xl">
          <h2 className="text-2xl font-semibold">Component API Scenarios</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            These are direct uses of the `SmartTable` React API. They make it
            easy to validate expansion, resizing, overflow treatment, and
            narrow-viewport fallback without needing a wiki page.
          </p>
        </div>

        <div className="space-y-6">
          {liveScenarioExamples.map((example) => (
            <article
              key={example.id}
              id={`scenario-${example.id}`}
              data-smart-table-scenario={example.id}
              data-resize-audit-example={
                resizeAuditIds.has(example.id) ? example.id : undefined
              }
              className="rounded-3xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/35 p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {example.category}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">{example.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                    {example.description}
                  </p>
                  <ScenarioBadges
                    labels={[
                      ...example.stressors,
                      ...example.apiModes.map((mode) => `${mode} API`),
                    ]}
                  />
                </div>

                <div className="min-w-[220px] rounded-2xl border border-[var(--sidebar-border)] bg-[var(--background)]/55 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    QA focus
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-muted)]">
                    {example.recommendedChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6" data-featured-example={example.id}>
                <ScenarioTable
                  example={example}
                  persistenceKey={`table-examples::scenario::${example.id}`}
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
