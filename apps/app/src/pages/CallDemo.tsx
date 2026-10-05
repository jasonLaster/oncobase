import { BookOpenIcon, FileCodeIcon, FileTextIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Part = "overview" | "formatted" | "raw";

const parts = [
  { id: "overview", label: "Overview", description: "Summary", Icon: BookOpenIcon },
  { id: "formatted", label: "Formatted", description: "Readable notes", Icon: FileTextIcon },
  { id: "raw", label: "Raw", description: "Original notes", Icon: FileCodeIcon },
] as const;

/** A fictional call, kept as three linked pages: overview, formatted notes, raw transcript. */
const slugBase = "wiki/calls/2026-09-30-oncology-follow-up";

const transcript: { time: string; speaker: string; text: string }[] = [
  { time: "00:42", speaker: "Oncologist", text: "So the scan last week shows the mass is smaller than in June, and nothing new anywhere else." },
  { time: "01:15", speaker: "Caregiver", text: "That's a relief. Does that change the plan for the next two cycles?" },
  { time: "01:31", speaker: "Oncologist", text: "Not yet. We stay on the schedule, but it makes the surgery conversation more hopeful." },
  { time: "04:08", speaker: "Caregiver", text: "On the immunotherapy question, what would decide it for you?" },
  { time: "04:26", speaker: "Oncologist", text: "The PD-L1 result. If it's positive I'd add it. If it isn't, I'd want to talk about trials first." },
  { time: "07:50", speaker: "Nurse", text: "I'll send the lab order for Monday and the infusion confirmation by email today." },
  { time: "08:12", speaker: "Caregiver", text: "Great. And we'll bring a list of questions about the radiation visit." },
];

function Wikilink({ children }: { children: ReactNode }) {
  return <span className="ft-wikilink">{children}</span>;
}

export function CallDemo() {
  const [part, setPart] = useState<Part>("overview");
  const [target, setTarget] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const slug = `${slugBase}-${part}`;

  const openMoment = (time: string) => {
    setTarget(time);
    setPart("raw");
  };

  // Landing on a moment scrolls the transcript to it, as a heading link would.
  useEffect(() => {
    if (part !== "raw" || !target) return;
    const heading = panel.current?.querySelector<HTMLElement>(`[data-moment="${target}"]`);
    if (heading && panel.current) {
      panel.current.scrollTo({ top: Math.max(0, heading.offsetTop - 12), behavior: "smooth" });
    }
  }, [part, target]);

  const moment = (time: string) => (
    <button className="ft-moment" onClick={() => openMoment(time)} type="button">
      {time}
    </button>
  );

  return (
    <div className="ft-call lp-browser">
      <div className="ft-call-bar">
        <span className="ft-call-slug">{slug}</span>
        <span>Sample call</span>
      </div>
      <nav aria-label="Note pages" className="note-bundle-nav ft-call-nav">
        {parts.map(({ id, label, description, Icon }) => (
          <button
            aria-current={part === id ? "page" : undefined}
            className="note-bundle-link"
            key={id}
            onClick={() => {
              setTarget(null);
              setPart(id);
            }}
            type="button"
          >
            <Icon aria-hidden="true" size={18} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="ft-call-panel wiki-markdown" ref={panel} tabIndex={0} aria-label={`${part} page`}>
        {part === "overview" ? (
          <>
            <h3>Oncology follow-up call</h3>
            <p>
              The scan shows the mass shrinking, and the plan stays on schedule. The one open decision is
              immunotherapy, which turns on the PD-L1 result. Related: <Wikilink>Treatment options</Wikilink>,{" "}
              <Wikilink>Lab results</Wikilink>.
            </p>
            <h4>Decided</h4>
            <ul>
              <li>
                Stay on the current schedule for the next two cycles {moment("01:31")}
              </li>
              <li>
                Revisit surgery timing after the next scan {moment("01:31")}
              </li>
            </ul>
            <h4>Open</h4>
            <ul>
              <li>
                Add immunotherapy? Depends on the PD-L1 result {moment("04:26")}
              </li>
            </ul>
            <h4>Next steps</h4>
            <ul>
              <li>
                Lab order for Monday and infusion confirmation by email {moment("07:50")}
              </li>
              <li>
                Bring questions to the <Wikilink>radiation visit</Wikilink> {moment("08:12")}
              </li>
            </ul>
            <p className="ft-call-links">
              Read the <button onClick={() => setPart("formatted")} type="button">formatted notes</button> or the{" "}
              <button onClick={() => { setTarget(null); setPart("raw"); }} type="button">raw transcript</button>.
            </p>
          </>
        ) : null}
        {part === "formatted" ? (
          <>
            <h3>Oncology follow-up call: notes</h3>
            <h4>Scan results</h4>
            <p>
              The mass is smaller than in June, with nothing new elsewhere. The oncologist expects this to make the
              surgery conversation more hopeful, but the schedule doesn’t change yet. {moment("00:42")}
            </p>
            <h4>Immunotherapy</h4>
            <p>
              The deciding factor is the PD-L1 result. If positive, add it to chemotherapy. If not, talk about trials
              first. See <Wikilink>Immunotherapy, in plain language</Wikilink>. {moment("04:26")}
            </p>
            <h4>Logistics</h4>
            <p>
              The nurse sends the Monday lab order and the infusion confirmation today. We bring questions to the
              radiation visit. {moment("07:50")}
            </p>
            <p className="ft-call-links">
              Back to the <button onClick={() => setPart("overview")} type="button">overview</button>, or the{" "}
              <button onClick={() => { setTarget(null); setPart("raw"); }} type="button">raw transcript</button>.
            </p>
          </>
        ) : null}
        {part === "raw" ? (
          <>
            <h3>Oncology follow-up call: transcript</h3>
            {transcript.map((line) => (
              <div
                className="ft-line"
                data-active={target === line.time || undefined}
                data-moment={line.time}
                key={line.time}
              >
                <h4 id={`t-${line.time.replace(":", "")}`}>{line.time}</h4>
                <p>
                  <strong>{line.speaker}:</strong> {line.text}
                </p>
              </div>
            ))}
            <p className="ft-call-links">
              Back to the <button onClick={() => setPart("overview")} type="button">overview</button> or the{" "}
              <button onClick={() => setPart("formatted")} type="button">formatted notes</button>.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
