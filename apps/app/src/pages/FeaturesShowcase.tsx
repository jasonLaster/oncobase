import { ArrowUp, BookOpen, FileSearch, Search, Sparkles } from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
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

/** One image in both themes, split by a draggable divider. */
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
  const id = useId();
  const [split, setSplit] = useState(50);
  return (
    <figure className="ft-compare">
      <div
        className="ft-compare-stage"
        style={{ "--split": `${split}%` } as CSSProperties}
      >
        <img
          alt={alt}
          decoding="async"
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
          height={height}
          loading="lazy"
          src={`${base}-dark.${extension}`}
          width={width}
        />
        <span aria-hidden="true" className="ft-compare-handle" />
        <span aria-hidden="true" className="ft-compare-tag ft-compare-tag-light">
          Light
        </span>
        <span aria-hidden="true" className="ft-compare-tag ft-compare-tag-dark">
          Dark
        </span>
      </div>
      <label className="ft-compare-control" htmlFor={id}>
        <span>Compare light and dark</span>
        <input
          id={id}
          max={100}
          min={0}
          onChange={(event) => setSplit(Number(event.target.value))}
          type="range"
          value={split}
        />
      </label>
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
