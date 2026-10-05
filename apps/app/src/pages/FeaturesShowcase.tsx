import { ArrowUp, BookOpen, ChevronsLeftRight, FileSearch, Search, Sparkles } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ThemedImage } from "./LandingShowcase";

/** A screenshot with numbered pins at percentage positions, plus a key. */
export function PinnedScreenshot({
  base,
  alt,
  width,
  height,
  pins,
}: {
  base: string;
  alt: string;
  width: number;
  height: number;
  pins: { x: number; y: number; title: string; text: string }[];
}) {
  return (
    <figure className="ft-pinned">
      <div className="lp-browser ft-pinned-frame">
        <div className="ft-pinned-image">
          <ThemedImage
            base={base}
            extension="jpg"
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            alt={alt}
          />
          {pins.map((pin, index) => (
            <span
              aria-hidden="true"
              className="ft-pin"
              key={pin.title}
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            >
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      <ol className="ft-pin-key">
        {pins.map((pin) => (
          <li key={pin.title}>
            <strong>{pin.title}</strong>
            <span>{pin.text}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** One image in both themes, split by a divider you drag on the image itself. */
export function ThemeCompare({
  base,
  extension,
  alt,
  width,
  height,
}: {
  base: string;
  extension: "jpg" | "webp";
  alt: string;
  width: number;
  height: number;
}) {
  const [split, setSplit] = useState(50);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))));
  };

  return (
    <figure className="ft-compare">
      <div
        className="ft-compare-stage"
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveTo(event.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        ref={stage}
        style={{ "--split": `${split}%` } as CSSProperties}
      >
        <img
          alt={alt}
          decoding="async"
          draggable={false}
          height={height}
          loading="lazy"
          src={`${base}-light.${extension}`}
          width={width}
        />
        <img
          alt=""
          aria-hidden="true"
          className="ft-compare-dark"
          decoding="async"
          draggable={false}
          height={height}
          loading="lazy"
          src={`${base}-dark.${extension}`}
          width={width}
        />
        <span aria-hidden="true" className="ft-compare-tag ft-compare-tag-light">
          Light
        </span>
        <span aria-hidden="true" className="ft-compare-tag ft-compare-tag-dark">
          Dark
        </span>
        <div
          aria-label="Compare light and dark"
          aria-orientation="horizontal"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={split}
          aria-valuetext={`${split}% light`}
          className="ft-compare-handle"
          onKeyDown={(event) => {
            const step = event.shiftKey ? 20 : 5;
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") setSplit((value) => Math.max(0, value - step));
            else if (event.key === "ArrowRight" || event.key === "ArrowUp") setSplit((value) => Math.min(100, value + step));
            else if (event.key === "Home") setSplit(0);
            else if (event.key === "End") setSplit(100);
            else return;
            event.preventDefault();
          }}
          role="slider"
          tabIndex={0}
        >
          <span className="ft-compare-grip">
            <ChevronsLeftRight size={20} aria-hidden="true" />
          </span>
        </div>
      </div>
      <figcaption className="ft-caption">Drag the handle to compare light and dark.</figcaption>
    </figure>
  );
}

/** A conversation with the knowledge base, shown the way the agent works. */
export function ChatDemo() {
  return (
    <div
      className="ft-chat"
      role="img"
      aria-label="Example chat. A person asks which treatment options were discussed. The assistant searches, reads two pages, and answers with links to its sources."
    >
      <div className="ft-chat-bar">
        <Sparkles size={15} aria-hidden="true" />
        <strong>Ask wiki</strong>
        <span>Sample conversation</span>
      </div>
      <div className="ft-chat-body" aria-hidden="true">
        <p className="ft-chat-user">
          What options did we discuss after the first scans, and what’s the
          open question on immunotherapy?
        </p>
        <ul className="ft-chat-steps">
          <li>
            <Search size={14} />
            <span>
              Searched <em>treatment options, immunotherapy</em>
            </span>
          </li>
          <li>
            <BookOpen size={14} />
            <span>
              Read <em>Treatment options</em> and{" "}
              <em>Immunotherapy, in plain language</em>
            </span>
          </li>
          <li>
            <FileSearch size={14} />
            <span>
              Checked <em>Lab results</em> for recent counts
            </span>
          </li>
        </ul>
        <div className="ft-chat-answer">
          <p>
            Four options are on the table: chemotherapy before surgery, adding a
            checkpoint inhibitor, a targeted therapy trial, and radiation after
            surgery <sup>1</sup>. The open question is whether the PD-L1 result
            makes the checkpoint inhibitor worth adding <sup>2</sup>.
          </p>
          <div className="ft-chat-sources">
            <span>
              <b>1</b> Treatment options
            </span>
            <span>
              <b>2</b> Immunotherapy, in plain language
            </span>
          </div>
        </div>
      </div>
      <div className="ft-chat-composer" aria-hidden="true">
        <span>Ask about the plan, the research, or the results…</span>
        <i>
          <ArrowUp size={15} />
        </i>
      </div>
    </div>
  );
}

/** A labelled group of small feature cards. */
export function FeatureGrid({ children }: { children: ReactNode }) {
  return <div className="ft-grid">{children}</div>;
}

export function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="ft-card">
      <span className="ft-card-icon" aria-hidden="true">
        {icon}
      </span>
      <h4>{title}</h4>
      <p>{children}</p>
    </article>
  );
}

/** A section header that is always visible and opens to show its rows. */
export function AccordionGroup({
  title,
  summary,
  preview,
  count,
  children,
}: {
  title: string;
  summary: string;
  preview: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="ft-acc">
      <summary>
        <span className="ft-acc-title">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span className="ft-acc-preview">{preview}</span>
        <span className="ft-acc-count">{count}</span>
      </summary>
      <div className="ft-acc-body">{children}</div>
    </details>
  );
}
