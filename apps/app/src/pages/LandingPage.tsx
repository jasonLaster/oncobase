import {
  useEffect,
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
    title: "Every report, paper, and conversation.",
    description:
      "Keep diagnostics, call transcripts, emails, papers, and clinical trials in one searchable wiki, with links back to the original sources.",
    tags: ["Linked sources", "Rich search", "Clinical trials"],
  },
  {
    id: "collaboration",
    label: "Collaboration",
    icon: Users,
    eyebrow: "02 / THE CARE VILLAGE",
    title: "Read the same page. Leave a note.",
    description:
      "Give the people helping with care a place to search, comment, and chat. Redact sensitive details inline, assign users roles, and choose which pages each role can view.",
    tags: ["Inline PII redaction", "User roles", "Page permissions"],
  },
  {
    id: "analysis",
    label: "Molecular analysis",
    icon: Dna,
    eyebrow: "03 / THE COMPUTATIONAL BIOLOGY",
    title: "Analyze sequencing and proteomics.",
    description:
      "Oncoomics is our companion pipeline for analyzing WES/WGS, proteomics, and single-cell RNA sequencing. It runs on Modal and S3 to identify drug candidates for further investigation.",
    tags: ["WES / WGS", "Proteomics", "scRNA-seq"],
  },
  {
    id: "education",
    label: "Education",
    icon: Sparkles,
    eyebrow: "04 / THE LEARNING PLATFORM",
    title: "Learn the science before the next call.",
    description:
      "Work through the guides and cartoons we’ve used to learn about immunotherapy, personalized mRNA vaccines, protein folding, and targeted chemotherapy. The curriculum is free to read.",
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
    <div className="lp-preview-wrap" id="knowledge-base">
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
                <span>Family, clinicians, and researchers</span>
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
                      ? "Reports, research, and the questions we’re working through."
                      : feature.id === "collaboration"
                        ? "Notes and conversations alongside the source."
                        : feature.id === "analysis"
                          ? "From sequencing data to candidates for review."
                          : "The guides and cartoons we learn from."}
                  </p>
                </div>
              </div>
              <FeatureVisual id={feature.id} />
              <div className="lp-preview-footer">
                <ShieldCheck size={13} /> Page permissions and inline PII
                redaction.<span>Powered by Oncobase.</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-preview-note">
        <span className="lp-note-line" /> Inside Diana’s knowledge base.
        <span className="lp-note-line" />
      </div>
    </div>
  );
}

function VillageTexture() {
  return (
    <div className="lp-village-texture" aria-hidden="true">
      {["left", "right"].map((side) => (
        <svg
          key={side}
          className={`lp-flutes lp-flutes-${side}`}
          viewBox="0 0 640 900"
          fill="none"
        >
          {Array.from({ length: 22 }, (_, index) => (
            <path
              key={index}
              d="M -180 880 C 350 1010 460 620 190 515 C -150 385 -40 160 220 110 C 450 65 490 -130 300 -220"
              transform={`translate(${index * 16 - 160} ${index * 6})`}
              stroke="currentColor"
              strokeWidth="1"
            />
          ))}
        </svg>
      ))}
    </div>
  );
}

export function LandingPage({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  const platform = useRef<HTMLDivElement>(null);
  const [platformTheme, setPlatformTheme] = useState(false);

  useEffect(() => {
    const headerElement = header.current;
    const platformElement = platform.current;
    if (!headerElement || !platformElement) return;
    let observer: IntersectionObserver;
    function observeBoundary() {
      observer?.disconnect();
      const headerHeight = headerElement!.getBoundingClientRect().height;
      headerElement!.parentElement?.style.setProperty(
        "--lp-header-height",
        `${headerHeight}px`,
      );
      // Follow the section below the same 24px clearance used by anchor links.
      const readingEdge = headerHeight + 25;
      observer = new IntersectionObserver(
        ([entry]) => setPlatformTheme(entry.isIntersecting),
        {
          rootMargin: `-${readingEdge}px 0px -${Math.max(0, window.innerHeight - readingEdge - 1)}px 0px`,
        },
      );
      observer.observe(platformElement!);
    }
    observeBoundary();
    const resize = new ResizeObserver(observeBoundary);
    resize.observe(headerElement);
    window.addEventListener("resize", observeBoundary);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", observeBoundary);
    };
  }, []);

  return (
    <div className="landing-page" data-test-id="login-page">
      <a className="lp-skip-link" href="#platform">
        Skip to platform features
      </a>
      <header
        ref={header}
        className="lp-header-shell"
        data-tone={platformTheme ? "oncobase" : "diana"}
      >
        <div className="lp-header lp-container">
          <a className="lp-brand" href="/login" aria-label="Diana TNBC home">
            <DianaBrand />
          </a>
          <nav aria-label="Main navigation">
            <a href="#knowledge-base">Knowledge base</a>
            <a href="#platform">Oncobase</a>
            <a href="#features">Features</a>
            <a href="#education">Education</a>
            <a href="#story">Our story</a>
          </nav>
          <a className="lp-button lp-button-small" href="#sign-in">
            Sign in <ArrowRight size={15} />
          </a>
        </div>
      </header>
      <main id="landing-main">
        <div className="lp-diana-intro lp-diana-theme">
          <VillageTexture />
          <section
            className="lp-hero lp-container"
            aria-labelledby="landing-title"
          >
            <p className="lp-eyebrow">
              <span className="lp-status-dot" /> DIANA TNBC · OUR SHARED
              KNOWLEDGE BASE
            </p>
            <h1 id="landing-title">
              It Takes <span>a Village.</span>
            </h1>
            <p className="lp-hero-description">
              The knowledge base helps us maintain Diana’s records, view her
              diagnostics, review the latest research, learn the fundamentals,
              perform molecular analysis, and collaborate with the larger care
              community.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-button" href="#sign-in">
                Enter Diana’s knowledge base <ArrowRight size={16} />
              </a>
              <a className="lp-text-link" href="/wiki/education/index">
                Browse Educational Content <ArrowRight size={16} />
              </a>
            </div>
            <PlatformPreview />
          </section>
        </div>
        <div ref={platform} className="lp-platform-world">
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
                We built Oncobase while organizing Diana’s care. It turns
                records and research into a wiki the care team can read, search,
                and discuss. The code is open source if you want to build your
                own.
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
              <BookOpen size={17} /> Records & research
            </span>
            <span>
              <Users size={17} /> Comments & conversations
            </span>
            <span>
              <Dna size={17} /> Molecular analysis
            </span>
            <span>
              <Sparkles size={17} /> Guides & cartoons
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
                  What we built
                  <br />
                  along the way.
                </h2>
              </div>
              <p>
                The tools we use to keep track of Diana’s care,
                <br className="lp-desktop-break" /> work through the research,
                and bring others into the conversation.
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
              <p className="lp-eyebrow">WHY WE BUILT THIS</p>
              <h2 id="story-title">
                My wife was diagnosed.
                <br />I needed a place to start.
              </h2>
              <span className="lp-story-signature">
                Jason · Diana’s husband
              </span>
            </div>
            <div className="lp-story-copy">
              <p>
                In April, I went into founder mode for my wife’s cancer care. I
                wanted to follow every useful lead.
              </p>
              <p>
                Along the way, I joined a hundred phone calls, gathered
                thousands of published papers, and used next-generation
                sequencing to explore personalized therapeutics.
              </p>
              <p>
                I built this wiki to keep the reports, notes, and research in
                one place, and to let the people helping us read and discuss
                them together.
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
              Open Diana’s
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
      <footer className="lp-footer-shell">
        <div className="lp-footer lp-container lp-diana-theme">
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
        </div>
      </footer>
    </div>
  );
}
