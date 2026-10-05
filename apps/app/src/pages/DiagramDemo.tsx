import { WikiMarkdown } from "@oncobase/wiki-markdown";
import { WikiMermaidRenderer } from "@oncobase/wiki-markdown/mermaid";
import { useState } from "react";

const samples = [
  {
    id: "flow",
    label: "Decision flow",
    source: `flowchart TD
  A[Scan result] --> B{PD-L1 positive?}
  B -- Yes --> C[Add immunotherapy]
  B -- No --> D[Discuss trials first]
  C --> E[Review in 3 weeks]
  D --> E`,
  },
  {
    id: "gantt",
    label: "Treatment timeline",
    source: `gantt
  title Treatment plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  section Chemotherapy
  Cycle 1 :done, 2026-08-04, 21d
  Cycle 2 :active, 2026-08-25, 21d
  Cycle 3 : 2026-09-15, 21d
  section Imaging
  Mid-treatment scan :milestone, 2026-09-01, 1d`,
  },
] as const;

/** The real renderer: a fenced mermaid block in markdown, drawn in place. */
export default function DiagramDemo() {
  const [id, setId] = useState<(typeof samples)[number]["id"]>("flow");
  const sample = samples.find((item) => item.id === id)!;
  return (
    <div className="ft-demo">
      <div className="ft-demo-controls">
        <div className="ft-demo-group" role="group" aria-label="Sample diagram">
          <span className="ft-demo-label">Sample</span>
          {samples.map((item) => (
            <button aria-pressed={item.id === id} key={item.id} onClick={() => setId(item.id)} type="button">
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ft-diagram">
        <pre className="ft-diagram-source" tabIndex={0}>
          <code>{"```mermaid\n" + sample.source + "\n```"}</code>
        </pre>
        <div className="ft-diagram-result" key={id}>
          <WikiMarkdown content={"```mermaid\n" + sample.source + "\n```"} currentSlug="oncobase-diagram-demo" />
          <WikiMermaidRenderer ganttAxisReferenceYear={2026} />
        </div>
      </div>
    </div>
  );
}
