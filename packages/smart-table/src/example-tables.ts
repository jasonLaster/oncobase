export interface ExampleTableDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  stressors: string[];
  recommendedChecks: string[];
  apiModes: Array<"markdown" | "declarative">;
  headers: string[];
  rows: string[][];
  legacyDirective?: string;
  expectInitialScrollable?: boolean;
  featured?: boolean;
  resizeAudit?: boolean;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br/>").trim();
}

function renderMarkdownRow(cells: string[]) {
  return `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
}

export function renderMarkdownTable(example: ExampleTableDefinition) {
  const header = renderMarkdownRow(example.headers);
  const separator = renderMarkdownRow(example.headers.map(() => "---"));
  const rows = example.rows.map(renderMarkdownRow);

  return [header, separator, ...rows].join("\n");
}

export function renderExampleTableSection(example: ExampleTableDefinition) {
  const lines = [
    `<div data-table-example="${example.id}"></div>`,
    `## ${example.title}`,
    example.description,
    `- Category: ${example.category}`,
    `- Stressors: ${example.stressors.join(", ")}`,
    `- API modes: ${example.apiModes.join(", ")}`,
    `- Fixture id: \`${example.id}\``,
  ];

  if (example.expectInitialScrollable) {
    lines.push("- Expected behavior: should already overflow horizontally on desktop.");
  }

  lines.push(`- QA checks: ${example.recommendedChecks.join("; ")}`);

  if (example.legacyDirective) {
    lines.push(`<!-- table-cols: ${example.legacyDirective} -->`);
  }

  lines.push(renderMarkdownTable(example));

  return lines.join("\n\n");
}

export function buildExampleTablesDocument() {
  return [
    "A controlled set of table fixtures for layout QA, regression testing, and unit-level rendering checks.",
    ...exampleTables.map(renderExampleTableSection),
  ].join("\n\n");
}

export function getExampleTable(id: string) {
  return exampleTables.find((example) => example.id === id);
}

export const exampleTables: ExampleTableDefinition[] = [
  {
    id: "dense-comparison",
    title: "Dense Comparison Matrix",
    description:
      "A realistic comparison table with mixed prose, numbers, and source columns similar to the research overview pages.",
    category: "Research comparison",
    stressors: ["mixed column widths", "dense prose", "source citations"],
    recommendedChecks: [
      "Verify resize handles stay aligned with dense headers",
      "Confirm expansion gives wider prose columns without dropping styles",
      "Check that mixed text and numeric cells preserve readable balance",
    ],
    apiModes: ["markdown", "declarative"],
    featured: true,
    headers: ["Model", "What It Does", "Key Numbers", "Source", "Relevance"],
    rows: [
      [
        "dnaHNet",
        "Tokenizer-free DNA language model that learns segmentation and codon-level context directly from nucleotides.",
        "3.89x fewer FLOPs than Evo 2; 1B params",
        "Shah 2026",
        "Useful baseline for genomic reasoning discussions.",
      ],
      [
        "Geneformer",
        "Single-cell foundation model that predicts therapeutic targets from transcriptional state.",
        "103M transcriptomes; 14M cancer cells",
        "Theodoris 2025",
        "High relevance for cell-state interpretation.",
      ],
      [
        "ESM-3",
        "Protein language model with open-ended generation and structure-aware reasoning for antibody design.",
        "450M public variant scores",
        "Meta FAIR",
        "Good stand-in for dense scientific prose plus numeric data.",
      ],
      [
        "scGPT",
        "General-purpose single-cell transformer for annotation, perturbation, and multimodal representation learning.",
        "33M cells pretraining corpus",
        "Bian 2024",
        "Useful to exercise long wrapped cells and compact labels together.",
      ],
    ],
  },
  {
    id: "long-prose-notes",
    title: "Long Prose Treatment Notes",
    description:
      "Every body cell is intentionally verbose so we can catch wrapping, row-height estimation, and expansion styling regressions.",
    category: "Wrapped prose",
    stressors: ["long wrapped prose", "tall rows", "line-height estimation"],
    recommendedChecks: [
      "Watch for clipped copy or row-height underestimation",
      "Resize the first column and confirm the layout stays stable",
      "Compare collapsed and expanded styling after a resize",
    ],
    apiModes: ["markdown", "declarative"],
    featured: true,
    resizeAudit: true,
    headers: ["Topic", "Clinical Note", "Potential Risk", "Follow-up"],
    rows: [
      [
        "Chemo timing",
        "If treatment is delayed to accommodate additional biopsy work, the team wants a clearly documented reason, the new date, and a note describing which downstream planning decisions depend on the updated pathology.",
        "The row should become tall enough that clipped or under-measured text is obvious.",
        "Verify expanded and collapsed heights still match the full content.",
      ],
      [
        "Radiology review",
        "Outside imaging summaries often compress uncertainty into a single sentence, so this row uses a long narrative with several commas and clauses to mimic what a dense source note looks like in practice.",
        "Wrapped prose can expose bad candidate widths or incorrect line counting.",
        "Compare before and after expansion for stable styling and cell padding.",
      ],
      [
        "Trial screening",
        "Eligibility notes frequently combine biomarker requirements, washout windows, and contact logistics in one cell, which is exactly the kind of content that tends to break when width heuristics are too aggressive.",
        "Aggressive compression can turn one readable row into several uncomfortable ones.",
        "Confirm that expansion meaningfully improves readability without dropping styles.",
      ],
    ],
  },
  {
    id: "numeric-monitoring",
    title: "Numeric Monitoring Snapshot",
    description:
      "A mostly numeric table for exercising the numeric column classification path and compact width allocation.",
    category: "Numeric summary",
    stressors: ["numeric columns", "percentages", "dates", "compact cells"],
    recommendedChecks: [
      "Confirm numeric columns remain compact after resize",
      "Check that dragged widths persist through expansion",
      "Verify the table does not over-expand when numbers are short",
    ],
    apiModes: ["markdown", "declarative"],
    featured: true,
    resizeAudit: true,
    headers: ["Week", "ANC", "Hemoglobin", "Platelets", "Dose Change", "Status"],
    rows: [
      ["Week 1", "4.2", "12.8", "274", "0%", "On track"],
      ["Week 2", "3.8", "12.1", "241", "-5%", "Monitor"],
      ["Week 3", "2.7", "11.4", "219", "-10%", "Adjust"],
      ["Week 4", "1.9", "10.9", "203", "-15%", "Hold if symptomatic"],
      ["Week 5", "2.5", "11.2", "228", "0%", "Recovered"],
    ],
  },
  {
    id: "compact-regimen-codes",
    title: "Compact Regimen Codes",
    description:
      "Short labels and slash-separated tokens help exercise the compact-column logic without relying on long prose.",
    category: "Compact tokens",
    stressors: ["short tokens", "slash-separated values", "compact headers"],
    recommendedChecks: [
      "Confirm compact headers do not get excessive width",
      "Check that hover-only resize affordances stay subtle but discoverable",
      "Verify short tokens still align cleanly after drag",
    ],
    apiModes: ["markdown", "declarative"],
    headers: ["Regimen", "Setting", "Window", "Owner", "Status"],
    rows: [
      ["TC", "Neo/adjuvant", "Wk 1-12", "Med onc", "Active"],
      ["AC", "Adj", "Wk 13-20", "Med onc", "Queued"],
      ["RT/LN", "Local", "Post-op", "Rad onc", "Planned"],
      ["IO/obs", "Maint", "Q3W", "Team", "Watch"],
    ],
  },
  {
    id: "overflow-landscape",
    title: "Overflow Landscape Grid",
    description:
      "This one is deliberately wide on desktop so horizontal scrolling and the right-edge fade can be tested without manual resize first.",
    category: "Overflow stress",
    stressors: ["many columns", "default overflow", "expanded horizontal scroll"],
    recommendedChecks: [
      "Verify the right-edge fade stays pinned to the scroll lane",
      "Resize a leading column and keep the table scrollable",
      "Confirm the expanded overlay widens the available lane",
    ],
    apiModes: ["markdown", "declarative"],
    expectInitialScrollable: true,
    featured: true,
    resizeAudit: true,
    headers: [
      "Program",
      "Target",
      "Phase",
      "Site",
      "Biomarker",
      "Sequencing Vendor",
      "Sample Need",
      "Eligibility Window",
      "Insurance Workflow",
      "Primary Contact",
      "Operational Note",
      "Enrollment Tracker",
    ],
    rows: [
      [
        "Vaccine A",
        "TNBC residual disease",
        "Phase 1",
        "UCSF",
        "ctDNA positive",
        "UltraDeepSeq-LabWest",
        "Fresh biopsy",
        "Day 0 to Day 21",
        "Prior authorization plus external pathology upload",
        "Dr. Li",
        "Requires rapid pathology turnaround before slot confirmation.",
        "SlotHold-2026-04-West",
      ],
      [
        "ADC B",
        "HER2-low escape",
        "Phase 2",
        "Stanford",
        "IHC 1+ or 2+",
        "PrecisionOncoReferenceCore",
        "Archived tissue",
        "Rolling weekly review",
        "Benefits verification before courier release",
        "Trial desk",
        "Screening packet includes a long checklist that makes this row useful for width testing.",
        "AwaitingInsuranceCallback",
      ],
      [
        "Cell Tx C",
        "Claudin-high subset",
        "Phase 1/2",
        "City of Hope",
        "RNA panel",
        "LongReadDiscoveryAlliance",
        "Fresh + blood",
        "Fourteen business days",
        "Single-case agreement with tertiary appeal",
        "Research RN",
        "Operational notes intentionally stay long so the final column never feels artificially narrow.",
        "ManualEnrollmentReview",
      ],
    ],
  },
  {
    id: "legacy-directive-cleanup",
    title: "Legacy Directive Cleanup",
    description:
      "This fixture keeps a legacy table directive comment in the markdown source so unit tests can confirm the renderer strips it cleanly.",
    category: "Legacy migration",
    stressors: ["legacy directive stripping", "simple sanity fixture"],
    recommendedChecks: [
      "Ensure directive comments do not leak into rendered HTML",
      "Verify server-rendered markup is already styled before hydration",
      "Confirm enhancement still adds expand and resize controls",
    ],
    apiModes: ["markdown"],
    legacyDirective: "18, 34, 48",
    headers: ["Directive", "Expectation", "Observed"],
    rows: [
      ["table-cols", "Removed before HTML output", "Should not leak into the page"],
      ["Wrapper", "Added during markdown render", "Provides pre-hydration scroll"],
      ["Enhancement", "Attached on hydrate", "Expand and resize controls appear"],
    ],
  },
];

export const featuredExampleTables = exampleTables.filter(
  (example) => example.featured
);

export const resizeAuditExampleTables = exampleTables.filter(
  (example) => example.resizeAudit
);
