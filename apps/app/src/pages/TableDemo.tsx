import { defaultSmartTableLayoutAdapter } from "@oncobase/smart-table";
import { renderMarkdownTable, type ExampleTableDefinition } from "@oncobase/smart-table/examples";
import { WikiMarkdown } from "@oncobase/wiki-markdown";
import { useMemo, useState } from "react";

type Sample = { id: string; label: string; note: string; headers: string[]; rows: string[][] };

/** Fictional, generic data. It stands in for any wiki table. */
const samples: Sample[] = [
  {
    id: "options",
    label: "Treatment options",
    note: "Long sentences: each column gets the room its words need.",
    headers: ["Option", "How it works", "What the evidence says", "Trade-offs", "Next step"],
    rows: [
      ["Chemotherapy before surgery", "Shrinks the tumor first and shows how it responds", "A standard first step for many triple-negative cases", "Fatigue, low blood counts, hair loss", "Confirm the schedule with oncology"],
      ["Add a checkpoint inhibitor", "Helps the immune system recognize the tumor", "Added to chemotherapy in several large trials", "Immune side effects need close monitoring", "Ask about eligibility and the PD-L1 result"],
      ["Targeted therapy trial", "Matches a drug to a mutation found in the tumor", "Depends on what the sequencing report shows", "Few open trials, and travel may be needed", "Review the sequencing report together"],
      ["Radiation after surgery", "Treats remaining cells in the breast and lymph nodes", "Commonly used, depending on the surgery", "Skin changes and fatigue", "Book the radiation oncology visit"],
    ],
  },
  {
    id: "labs",
    label: "Lab results",
    note: "Numbers stay compact; the notes column takes the slack.",
    headers: ["Test", "Result", "Reference range", "Change", "What it suggests"],
    rows: [
      ["Absolute neutrophils", "1.8 ×10³/µL", "1.5–7.7", "−0.4", "Recovering after the last infusion, so fine to proceed"],
      ["Hemoglobin", "11.2 g/dL", "12.0–15.5", "−0.3", "Mildly low; recheck before the next cycle"],
      ["Platelets", "214 ×10³/µL", "150–450", "+12", "Normal"],
      ["ALT", "28 U/L", "7–35", "−2", "Liver values steady"],
      ["Creatinine", "0.8 mg/dL", "0.5–1.1", "0.0", "Kidney function normal for contrast imaging"],
    ],
  },
  {
    id: "trials",
    label: "Clinical trials",
    note: "Mixed IDs, places, and prose side by side.",
    headers: ["Trial", "Phase", "Where", "Status", "Why it matters"],
    rows: [
      ["SAMPLE-101", "2", "Boston, MA", "Recruiting", "Pairs a checkpoint inhibitor with chemotherapy before surgery"],
      ["SAMPLE-204", "1/2", "San Francisco, CA; remote visits", "Recruiting", "Targets a mutation found in about one in ten triple-negative tumors"],
      ["SAMPLE-317", "3", "Several sites in the US and Europe", "Active, not recruiting", "The larger confirmation study for the same approach"],
    ],
  },
  {
    id: "facts",
    label: "Quick facts",
    note: "A small two-column table keeps its natural layout.",
    headers: ["Item", "Detail"],
    rows: [
      ["Next infusion", "Tuesday, 9:30 am"],
      ["Nurse line", "Open 24 hours"],
      ["Pharmacy", "Delivers on infusion days"],
    ],
  },
  {
    id: "wide",
    label: "Wide table",
    note: "Too wide to fit: it scrolls, with a soft edge cue.",
    headers: ["Date", "Study", "Modality", "Site", "Result", "Compared with", "Report", "Read by"],
    rows: [
      ["Apr 1", "Breast MRI", "MRI", "Left breast", "Mass about 2.4 cm, irregular margins", "None (baseline)", "Radiology report", "Dr. A"],
      ["Jun 26", "Breast MRI", "MRI", "Left breast", "Mass smaller, about 1.1 cm", "Apr 1", "Radiology report", "Dr. A"],
      ["Jul 17", "Breast MRI", "MRI", "Left breast", "No suspicious enhancement", "Jun 26", "Radiology report", "Dr. B"],
    ],
  },
];

const widths = [
  { id: "phone", label: "Phone", css: "360px" },
  { id: "tablet", label: "Tablet", css: "640px" },
  { id: "desktop", label: "Desktop", css: "100%" },
] as const;

function toMarkdown(sample: Sample) {
  return renderMarkdownTable({ headers: sample.headers, rows: sample.rows } as ExampleTableDefinition);
}

export default function TableDemo() {
  const [sampleId, setSampleId] = useState(samples[0]!.id);
  const [widthId, setWidthId] = useState<(typeof widths)[number]["id"]>("desktop");
  const sample = samples.find((item) => item.id === sampleId)!;
  const width = widths.find((item) => item.id === widthId)!;
  const content = useMemo(() => toMarkdown(sample), [sample]);

  return (
    <div className="ft-demo">
      <div className="ft-demo-controls">
        <div className="ft-demo-group" role="group" aria-label="Sample data">
          <span className="ft-demo-label">Sample data</span>
          {samples.map((item) => (
            <button
              aria-pressed={item.id === sampleId}
              key={item.id}
              onClick={() => setSampleId(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ft-demo-group" role="group" aria-label="Container width">
          <span className="ft-demo-label">Width</span>
          {widths.map((item) => (
            <button
              aria-pressed={item.id === widthId}
              key={item.id}
              onClick={() => setWidthId(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ft-demo-stage" data-test-id="table-demo-stage" style={{ maxWidth: width.css }}>
        <WikiMarkdown
          content={content}
          currentSlug="oncobase-table-demo"
          key={`${sampleId}-${widthId}`}
          tableLayoutAdapter={defaultSmartTableLayoutAdapter}
        />
      </div>
      <p className="ft-demo-hint">
        {sample.note} Drag a header edge to resize a column
        <span className="ft-demo-desktop-only">, or hover the table and use Expand to fill the screen</span>.
      </p>
    </div>
  );
}
