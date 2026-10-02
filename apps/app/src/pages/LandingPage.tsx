import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Dna,
  Folder,
  GitBranch,
  Heart,
  Microscope,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  CartoonVisual,
  PrivacyShowcase,
  RedactionVisual,
  SiteShowcase,
  WikiContentsVisual,
} from "./LandingShowcase";
import { DianaBrand, DianaMark, OncobaseBrand } from "./LandingBrands";
import "./landing.css";

const features = [
  {
    id: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    eyebrow: "01 / THE KNOWLEDGE BASE",
    title: "Everything you know. Connected.",
    description:
      "A Karpathy-inspired knowledge base that brings diagnostics, call transcripts, emails, published papers, and clinical trials into one searchable home.",
    tags: ["Linked sources", "Rich search", "Clinical trials"],
  },
  {
    id: "collaboration",
    label: "Collaboration",
    icon: Users,
    eyebrow: "02 / THE CARE VILLAGE",
    title: "A shared picture. A stronger village.",
    description:
      "A Notion-style viewer for the people thinking alongside you. Search, comment, and chat. Redact PII inline, assign users roles, and choose which pages each role can view.",
    tags: ["Inline PII redaction", "User roles", "Page permissions"],
  },
  {
    id: "analysis",
    label: "Molecular analysis",
    icon: Dna,
    eyebrow: "03 / THE COMPUTATIONAL BIOLOGY",
    title: "From molecular data to new questions.",
    description:
      "A co-developed computational biology pipeline for bulk WES/WGS, proteomics, and single-cell RNA sequencing. Built on Modal and S3 to surface drug candidates for further investigation.",
    tags: ["WES / WGS", "Proteomics", "scRNA-seq"],
  },
  {
    id: "education",
    label: "Education",
    icon: Sparkles,
    eyebrow: "04 / THE LEARNING PLATFORM",
    title: "Complex science. A clearer way in.",
    description:
      "Curriculum and cartoons that make the science approachable, from immunotherapy and personalized mRNA vaccines to protein folding and targeted chemotherapy.",
    tags: ["Guided curriculum", "Visual explanations", "Learn at your pace"],
  },
] as const;
type FeatureId = (typeof features)[number]["id"];

function AnalysisVisual() {
  return (
    <div className="lp-analysis-visual">
      <div className="lp-assays">
        <span>
          <Dna size={17} /> WES / WGS
        </span>
        <span>
          <Network size={17} /> Proteomics
        </span>
        <span>
          <Microscope size={17} /> scRNA-seq
        </span>
      </div>
      <div className="lp-pipeline-line" aria-hidden="true">
        <span />
        <ArrowDown size={18} />
        <span />
      </div>
      <div className="lp-pipeline-engine">
        <span className="lp-engine-icon">
          <Dna size={24} />
        </span>
        <div>
          <strong>Molecular analysis</strong>
          <span>Variants · pathways · expression</span>
        </div>
        <span className="lp-engine-dots" aria-hidden="true">
          •••
        </span>
      </div>
      <div className="lp-pipeline-line" aria-hidden="true">
        <span />
        <ArrowDown size={18} />
        <span />
      </div>
      <div className="lp-candidate-row">
        <span>
          <span className="lp-candidate-dot" /> Candidate A
        </span>
        <span>
          <span className="lp-candidate-dot" /> Candidate B
        </span>
        <span>
          <span className="lp-candidate-dot" /> Candidate C
        </span>
      </div>
      <div className="lp-visual-caption">
        Drug candidates for further investigation{" "}
        <span className="lp-infrastructure">Modal + S3</span>
      </div>
    </div>
  );
}

function FeatureVisual({
  id,
  compact = false,
}: {
  id: FeatureId;
  compact?: boolean;
}) {
  if (id === "knowledge")
    return (
      <WikiContentsVisual
        compact={compact}
        brand={compact ? "oncobase" : "diana"}
      />
    );
  if (id === "collaboration") return <RedactionVisual />;
  if (id === "analysis") return <AnalysisVisual />;
  return <CartoonVisual />;
}

function PlatformPreview() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % features.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + features.length) % features.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = features.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }
  return (
    <div className="lp-preview-wrap">
      <div className="lp-preview" data-test-id="platform-preview">
        <div className="lp-window-bar">
          <div className="lp-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>
            <DianaMark /> Diana TNBC
          </span>
          <span className="lp-preview-label">PREVIEW</span>
        </div>
        <div className="lp-preview-body">
          <aside
            className="lp-preview-sidebar"
            aria-label="Platform preview sections"
          >
            <div className="lp-preview-brand">
              <DianaMark /> <span>Diana TNBC</span>
            </div>
            <div className="lp-sidebar-label">ONE CONNECTED WORKSPACE</div>
            <div
              className="lp-preview-tabs"
              role="tablist"
              aria-label="Explore platform features"
            >
              {features.map((feature, index) => (
                <button
                  key={feature.id}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${index}`}
                  aria-selected={index === selected}
                  aria-controls={`${id}-panel-${index}`}
                  tabIndex={index === selected ? 0 : -1}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  <feature.icon size={17} />
                  <span>{feature.label}</span>
                  {index === selected && <ChevronRight size={14} />}
                </button>
              ))}
            </div>
            <div className="lp-sidebar-bottom">
              <span className="lp-avatar">Y</span>
              <div>
                <strong>Your care village</strong>
                <span>Connected by a common purpose</span>
              </div>
              <Heart size={15} />
            </div>
          </aside>
          {features.map((feature, index) => (
            <div
              key={feature.id}
              className="lp-preview-main"
              role="tabpanel"
              id={`${id}-panel-${index}`}
              aria-labelledby={`${id}-tab-${index}`}
              tabIndex={0}
              hidden={selected !== index}
            >
              <div className="lp-preview-breadcrumb">
                <Folder size={13} /> Workspace <ChevronRight size={12} />{" "}
                {feature.label}
                <span>
                  {feature.id === "knowledge" || feature.id === "education"
                    ? "Real wiki content"
                    : "Illustrative example"}
                </span>
              </div>
              <div className="lp-preview-heading">
                <span
                  className={`lp-preview-feature-icon lp-tone-${feature.id}`}
                >
                  <feature.icon size={23} />
                </span>
                <div>
                  <h2>{feature.label}</h2>
                  <p>
                    {feature.id === "knowledge"
                      ? "A real table of contents. A connected body of knowledge."
                      : feature.id === "collaboration"
                        ? "Think together, with the full context."
                        : feature.id === "analysis"
                          ? "Explore the molecular picture."
                          : "Build understanding, one idea at a time."}
                  </p>
                </div>
              </div>
              <FeatureVisual id={feature.id} />
              <div className="lp-preview-footer">
                <ShieldCheck size={13} /> Thoughtful access. Shared
                understanding.<span>Built around the person.</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-preview-note">
        <span className="lp-note-line" /> Diana’s care village. One shared home.
        <span className="lp-note-line" />
      </div>
    </div>
  );
}

export function LandingPage({ children }: { children: ReactNode }) {
  return (
    <div className="landing-page" data-test-id="login-page">
      <a className="lp-skip-link" href="#platform">
        Skip to platform features
      </a>
      <header className="lp-header lp-container lp-diana-theme">
        <a className="lp-brand" href="/login" aria-label="Diana TNBC home">
          <DianaBrand />
        </a>
        <nav aria-label="Main navigation">
          <a href="#platform">Oncobase</a>
          <a href="#inside">See it in action</a>
          <a href="/wiki/education/index">Learn</a>
          <a href="#story">Our story</a>
        </nav>
        <a className="lp-button lp-button-small" href="#sign-in">
          Sign in <ArrowRight size={15} />
        </a>
      </header>
      <main id="landing-main">
        <div className="lp-diana-intro lp-diana-theme">
          <section
            className="lp-hero lp-container"
            aria-labelledby="landing-title"
          >
            <p className="lp-eyebrow">
              <span className="lp-status-dot" /> DIANA TNBC · OUR SHARED
              KNOWLEDGE BASE
            </p>
            <h1 id="landing-title">
              For Diana.
              <br />
              <span>With all of us.</span>
            </h1>
            <p className="lp-hero-description">
              A home for Diana’s care village. Bringing the research, the
              science, and the people who care together, one question at a time.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-button" href="#sign-in">
                Enter Diana’s knowledge base <ArrowRight size={16} />
              </a>
              <a className="lp-text-link" href="/wiki/education/index">
                Browse the free curriculum <ArrowRight size={16} />
              </a>
            </div>
            <PlatformPreview />
          </section>
        </div>
        <div className="lp-platform-world">
          <section
            className="lp-platform-intro lp-container"
            id="platform"
            aria-labelledby="platform-title"
          >
            <div>
              <p className="lp-eyebrow">THE PLATFORM BEHIND DIANA TNBC</p>
              <OncobaseBrand />
              <h2 id="platform-title">
                More knowledge.
                <br />
                <span>More possibility.</span>
              </h2>
            </div>
            <div className="lp-platform-intro-copy">
              <p>
                Diana’s knowledge base runs on Oncobase, an open-source platform
                for bringing research, records, and people together. Built here,
                shared so others can build their own.
              </p>
              <div className="lp-platform-actions">
                <a
                  className="lp-button"
                  href="https://github.com/jasonLaster/oncobase"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitBranch size={17} /> View Oncobase on GitHub{" "}
                  <ArrowRight size={15} />
                </a>
                <a className="lp-text-link" href="#features">
                  Explore the platform <ArrowDown size={15} />
                </a>
              </div>
            </div>
          </section>
          <section
            className="lp-principles lp-container"
            aria-label="Platform principles"
          >
            <span>
              <BookOpen size={17} /> Knowledge, connected
            </span>
            <span>
              <Users size={17} /> People, brought together
            </span>
            <span>
              <Dna size={17} /> Biology, explored
            </span>
            <span>
              <Sparkles size={17} /> Science, made approachable
            </span>
          </section>
          <section
            className="lp-features lp-container"
            id="features"
            aria-labelledby="features-title"
          >
            <div className="lp-section-heading">
              <div>
                <p className="lp-eyebrow">BUILT WITH ONCOBASE</p>
                <h2 id="features-title">
                  Four ways to move
                  <br />
                  from information to understanding.
                </h2>
              </div>
              <p>
                A place to organize what you know,
                <br className="lp-desktop-break" /> explore what you don’t, and
                think together.
              </p>
            </div>
            <div className="lp-feature-grid">
              {features.map((feature) => (
                <article
                  key={feature.id}
                  className={`lp-feature-card lp-tone-${feature.id}`}
                >
                  <div className="lp-feature-card-copy">
                    <p className="lp-feature-eyebrow">
                      <feature.icon size={16} /> {feature.eyebrow}
                    </p>
                    <h3>{feature.title}</h3>
                    <p className="lp-feature-description">
                      {feature.description}
                    </p>
                    {feature.id === "analysis" && (
                      <a
                        className="lp-source-link lp-repo-link"
                        href="https://github.com/jasonLaster/oncoomics"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <GitBranch size={14} /> Explore Oncoomics on GitHub{" "}
                        <ArrowRight size={14} />
                      </a>
                    )}
                  </div>
                  <div
                    className="lp-feature-art"
                    aria-label={`${feature.label} illustration`}
                  >
                    <FeatureVisual id={feature.id} compact />
                  </div>
                  <ul
                    className="lp-feature-tags"
                    aria-label={`${feature.label} capabilities`}
                  >
                    {feature.tags.map((tag) => (
                      <li key={tag}>
                        <Check size={12} /> {tag}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
          <SiteShowcase />
          <PrivacyShowcase />
        </div>
        <section
          className="lp-story lp-diana-theme"
          id="story"
          aria-labelledby="story-title"
        >
          <div className="lp-container lp-story-inner">
            <div className="lp-story-heading">
              <span className="lp-story-icon">
                <Heart size={25} strokeWidth={1.5} />
              </span>
              <p className="lp-eyebrow">DIANA’S STORY · A PERSONAL BEGINNING</p>
              <h2 id="story-title">
                Built out of love.
                <br />
                And a refusal to stop asking.
              </h2>
              <span className="lp-story-signature">
                Jason · Founder, husband, researcher
              </span>
            </div>
            <div className="lp-story-copy">
              <p>
                In April, I entered founder mode to pursue a Sid-inspired
                maximalist approach to my wife’s cancer diagnosis.
              </p>
              <p>
                Along the way, I participated in a hundred phone calls, ingested
                thousands of published papers, and used next-generation
                sequencing to explore personalized therapeutics.
              </p>
              <p>
                What began as a way to make sense of it all became a platform
                for the larger care village.
              </p>
              <p className="lp-story-hope">
                <span className="lp-status-dot" /> Today, we’re cautiously
                optimistic.
              </p>
            </div>
          </div>
        </section>
        <section
          className="lp-access lp-container lp-diana-theme"
          id="sign-in"
          aria-labelledby="access-title"
        >
          <div>
            <p className="lp-eyebrow">DIANA TNBC</p>
            <h2 id="access-title">
              Come into Diana’s
              <br />
              knowledge base.
            </h2>
            <p>
              Already part of the care village?
              <br />
              Enter your shared password to open the knowledge base.
            </p>
          </div>
          {children}
        </section>
      </main>
      <footer className="lp-footer lp-container lp-diana-theme">
        <a className="lp-brand" href="/login" aria-label="Diana TNBC home">
          <DianaBrand />
        </a>
        <div className="lp-footer-platform">
          <span>Powered by</span>
          <a
            href="https://github.com/jasonLaster/oncobase"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Oncobase on GitHub"
          >
            <OncobaseBrand />
          </a>
        </div>
        <a href="/terms-and-conditions">
          Terms & conditions <ArrowRight size={13} />
        </a>
      </footer>
    </div>
  );
}
