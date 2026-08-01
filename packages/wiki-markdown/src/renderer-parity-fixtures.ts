export type RendererSemantics = {
  headings: Array<{ level: number; id: string; text: string }>;
  images: Array<{ alt: string; src: string; theater: boolean }>;
  links: Array<{ href: string; pdf: boolean; target: string; text: string }>;
  redactions: Array<{ label: string; text: string }>;
  tables: Array<{ headers: string[]; rows: string[][]; smart: boolean }>;
};

export type RendererParityFixture = {
  currentSlug: string;
  expected: RendererSemantics;
  markdown: string;
  name: string;
};

export const rendererParityFixtures: RendererParityFixture[] = [
  {
    name: "headings, wiki links, assets, and PDF chips",
    currentSlug: "wiki/research/notes",
    markdown: [
      "# Renderer Parity",
      "",
      "See [[wiki/diagnostics/diagnosis|Diagnosis]] and [the paper](paper.pdf).",
      "",
      "![Scan](images/scan.png)",
    ].join("\n"),
    expected: {
      headings: [{ level: 1, id: "renderer-parity", text: "Renderer Parity" }],
      links: [
        {
          href: "/wiki/diagnostics/diagnosis",
          pdf: false,
          target: "",
          text: "Diagnosis",
        },
        {
          href: "/api/file?path=wiki%2Fresearch%2Fpaper.pdf",
          pdf: true,
          target: "_blank",
          text: "paper.pdf",
        },
      ],
      images: [
        {
          alt: "Scan",
          src: "/api/file?path=wiki%2Fresearch%2Fimages%2Fscan.png",
          theater: true,
        },
      ],
      redactions: [],
      tables: [],
    },
  },
  {
    name: "smart tables and explicit redaction labels",
    currentSlug: "wiki/research/notes",
    markdown: [
      "## Results",
      "",
      "<redact label=\"the patient\">Protected name</redact>",
      "",
      "| Test | Status |",
      "| --- | --- |",
      "| CBC | Ready |",
    ].join("\n"),
    expected: {
      headings: [{ level: 2, id: "results", text: "Results" }],
      links: [],
      images: [],
      redactions: [{ label: "the patient", text: "Protected name" }],
      tables: [
        {
          headers: ["Test", "Status"],
          rows: [["CBC", "Ready"]],
          smart: true,
        },
      ],
    },
  },
  {
    name: "safe protocol links reject executable URLs",
    currentSlug: "wiki/research/notes",
    markdown:
      "Contact [[redacted email]](mailto:diana@example.com), call [support](tel:+14155550123), and reject [unsafe](javascript:alert(1)).",
    expected: {
      headings: [],
      links: [
        {
          href: "mailto:diana@example.com",
          pdf: false,
          target: "",
          text: "[redacted email]",
        },
        {
          href: "tel:+14155550123",
          pdf: false,
          target: "",
          text: "support",
        },
        { href: "", pdf: false, target: "", text: "unsafe" },
      ],
      images: [],
      redactions: [],
      tables: [],
    },
  },
];
