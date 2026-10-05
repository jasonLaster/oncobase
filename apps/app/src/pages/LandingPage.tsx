import { PublicThemeControl } from "../PublicThemeControl";
import { LANDING_TITLE } from "../special-route-metadata";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, GitBranch, Heart, LockKeyhole } from "lucide-react";
import {
  GuideFigure,
  KnowledgeBaseContents,
  PrivateLink,
  ProductShots,
  RedactionDemo,
  RoleDemo,
  ThemedImage,
} from "./LandingShowcase";
import { DianaBrand, OncobaseBrand, VillageTexture } from "./LandingBrands";
import "./landing.css";

/** Green while the Oncobase band is under the header, plum elsewhere. */
function usePlatformTone(
  header: RefObject<HTMLElement | null>,
  platform: RefObject<HTMLElement | null>,
) {
  const [platformTone, setPlatformTone] = useState(false);
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
        ([entry]) => setPlatformTone(entry.isIntersecting),
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
  }, [header, platform]);
  return platformTone;
}

function Header({
  ref,
  platformTone,
}: {
  ref: RefObject<HTMLElement | null>;
  platformTone: boolean;
}) {
  return (
    <header
      ref={ref}
      className="lp-header-shell"
      data-tone={platformTone ? "oncobase" : "diana"}
    >
      <div className="lp-header lp-container">
        <a className="lp-brand" href="/" aria-label="Diana TNBC home">
          <DianaBrand />
        </a>
        <nav aria-label="Main navigation">
          <a href="#story">Our story</a>
          <a href="#platform">Oncobase</a>
          <a href="#inside">Features</a>
          <a href="#privacy">Privacy</a>
          <a href="#education">Education</a>
        </nav>
        <div className="lp-header-actions">
          <PublicThemeControl />
          <a className="lp-button lp-button-small" href="/sign-in">
            Sign in <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="landing-title">
      <VillageTexture />
      <div className="lp-container lp-hero-inner">
        <h1 id="landing-title">
          It takes <span>a village.</span>
        </h1>
        <p className="lp-hero-description">
          When Diana was diagnosed with triple‑negative breast cancer, we built
          a knowledge base for her records, scans, and research, so everyone
          helping her can work from the same page.
        </p>
        <div className="lp-hero-actions">
          <a className="lp-button" href="/sign-in">
            View Diana’s knowledge base <ArrowRight size={16} />
          </a>
          <a className="lp-text-link" href="/education">
            Browse educational content <ArrowRight size={16} />
          </a>
        </div>
        <ProductShots />
      </div>
    </section>
  );
}

function Story() {
  return (
    <section className="lp-story" id="story" aria-labelledby="story-title">
      <div className="lp-container lp-story-inner">
        <div>
          <span className="lp-story-icon">
            <Heart size={22} strokeWidth={1.6} />
          </span>
          <h2 id="story-title">
            My wife was diagnosed. I needed a place to start.
          </h2>
          <p className="lp-story-signature">Jason · Diana’s husband</p>
        </div>
        <div className="lp-story-copy">
          <p>
            In April, I went into founder mode for my wife’s cancer care. I
            wanted to follow every useful lead.
          </p>
          <p>
            Along the way, I joined a hundred phone calls, gathered thousands of
            published papers, and sequenced her tumor to look for treatments
            matched to it.
          </p>
          <p>
            I built this knowledge base to keep the reports, notes, and research
            in one place, and to let the people helping us read and discuss them
            together.
          </p>
          <p className="lp-story-hope">
            <span className="lp-status-dot" /> Today, we’re cautiously
            optimistic.
          </p>
        </div>
      </div>
    </section>
  );
}

function Screenshot({
  path,
  src,
  themed,
  alt,
}: {
  path: string;
  /** A fixed image, or the base of a `-light`/`-dark` pair when `themed`. */
  src: string;
  themed?: boolean;
  alt: string;
}) {
  const props = { width: "1192", height: "640", loading: "lazy", decoding: "async", alt } as const;
  return (
    <PrivateLink className="lp-screenshot" path={path}>
      {themed ? <ThemedImage {...props} base={src} extension="jpg" /> : <img {...props} src={`${src}.jpg`} />}
    </PrivateLink>
  );
}

function Inside() {
  return (
    <section
      className="lp-section lp-container"
      id="inside"
      aria-labelledby="inside-title"
    >
      <div className="lp-section-heading">
        <h2 id="inside-title">What’s inside the knowledge base.</h2>
        <p>
          The tools we use to keep track of Diana’s care, work through the
          research, and bring others into the conversation.
        </p>
      </div>

      <article className="lp-feature lp-feature-wide">
        <div className="lp-feature-copy">
          <h3>Every report, paper, and conversation.</h3>
          <p>
            Diagnostics, call transcripts, emails, papers, and clinical trials
            live in one searchable knowledge base, with links back to the
            original sources. Family, doctors, and researchers can comment and
            chat right beside the page.
          </p>
          <PrivateLink className="lp-text-link" path="/">
            <LockKeyhole size={15} /> Sign in to open the knowledge base
          </PrivateLink>
        </div>
        <KnowledgeBaseContents />
      </article>

      <div className="lp-card-pair">
        <article className="lp-card">
          <h3>Follow the results over time.</h3>
          <p>
            Compare dated measurements, check which assay and units were used,
            and open the report behind a result.
          </p>
          <Screenshot
            path="/diagnostics"
            src="/landing/diagnostics-timeline"
            themed
            alt="The diagnostics timeline, with imaging, pathology, ctDNA, and blood count tracks over five months"
          />
        </article>
        <article className="lp-card">
          <h3>Read the report. Open the scan.</h3>
          <p>
            Step through MRI and CT studies, compare scans side by side, and
            view pathology slides alongside the rest of the record.
          </p>
          <Screenshot
            path="/diagnostics/imaging"
            src="/landing/dicom-viewer"
            alt="The imaging viewer showing a breast MRI series, with the series list and viewer controls"
          />
        </article>
      </div>

      <article className="lp-feature lp-feature-reverse">
        <div className="lp-feature-copy">
          <h3>Look for leads in the tumor’s own data.</h3>
          <p>
            Oncoomics, our companion pipeline, analyzes tumor DNA, RNA, and
            protein data and flags drugs worth raising with the care team.
          </p>
          <a
            className="lp-text-link"
            href="https://github.com/jasonLaster/oncoomics"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitBranch size={15} /> Oncoomics on GitHub <ArrowRight size={15} />
          </a>
        </div>
        <figure className="lp-feature-image">
          <ThemedImage
            base="/landing/molecular-layers"
            extension="webp"
            width="1536"
            height="1024"
            loading="lazy"
            decoding="async"
            alt="Cartoon of one tumor seen through DNA, RNA, protein, and spatial layers, each answering a different question"
          />
        </figure>
      </article>
    </section>
  );
}

function Privacy() {
  return (
    <section
      className="lp-section lp-section-end lp-container"
      id="privacy"
      aria-labelledby="privacy-title"
    >
      <div className="lp-section-heading">
        <h2 id="privacy-title">Choose what each person can see.</h2>
        <p>
          A research partner may need the papers. Family may want updates. Give
          each person a role and choose which pages they can open. Names and
          contact details can be hidden inside a page, so you can share the
          science without sharing the patient.
        </p>
      </div>
      <div className="lp-demo-pair">
        <RoleDemo />
        <RedactionDemo />
      </div>
      <p className="lp-footnote">
        Interactive examples with fictional people and details.
      </p>
    </section>
  );
}

function Platform({ ref }: { ref: RefObject<HTMLElement | null> }) {
  return (
    <section
      ref={ref}
      className="lp-platform lp-oncobase"
      id="platform"
      aria-labelledby="platform-title"
    >
      <div className="lp-container lp-platform-inner">
        <div>
          <OncobaseBrand />
          <h2 id="platform-title">
            Open source, so everyone can take control of their care.
          </h2>
        </div>
        <div className="lp-platform-copy">
          <p>
            Oncobase was inspired by{" "}
            <a
              href="https://osteosarc.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sid Sijbrandij’s osteosarc.com
            </a>
            , where he openly shares the data from his own cancer journey.
          </p>
          <p>
            Everything in the knowledge base, from the content management
            system to the diagnostics viewer and the agentic chatbot, is open
            source and free to build on.
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
            <a className="lp-text-link" href="/features">
              See everything it can do <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Education() {
  return (
    <section
      className="lp-section lp-section-end lp-container"
      id="education"
      aria-labelledby="education-title"
    >
      <div className="lp-section-heading">
        <h2 id="education-title">
          What does that term mean? <span>Start with a cartoon.</span>
        </h2>
        <p>
          These are the guides we’ve been learning from. Pick a topic or follow
          a course. Anyone can read them, no password needed.
        </p>
        <a className="lp-text-link" href="/education">
          Browse educational content <ArrowRight size={16} />
        </a>
      </div>
      <div className="lp-guide-pair">
        <GuideFigure
          base="/landing/immune-recognition"
          alt="Cartoon of protein fragments displayed on HLA and recognized by a T cell"
          title="How the immune system sees a cell"
          path="/education/oncology-101/index"
          description="From Oncology 101."
        />
        <GuideFigure
          base="/landing/cell-therapy-family"
          alt="Cartoon comparing peptide-HLA, surface-antigen, and innate-like cell therapy families"
          title="Cellular therapies"
          path="/education/cellular-therapies/index"
          description="Meet the families of immune cell therapy."
        />
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer-shell">
      <div className="lp-footer lp-container">
        <a className="lp-brand" href="/" aria-label="Diana TNBC home">
          <DianaBrand />
        </a>
        <div className="lp-footer-platform lp-oncobase">
          <span>Open source, powered by</span>
          <a
            href="https://github.com/jasonLaster/oncobase"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Oncobase on GitHub"
          >
            <OncobaseBrand />
          </a>
        </div>
        <div className="lp-footer-note">
          <p>Shared for education, not medical advice.</p>
          <a href="/terms-and-conditions">Terms & conditions</a>
        </div>
        <p className="lp-footer-credit">
          MRI image: Daniels et al. (2024), Advanced-MRI-Breast-Lesions, The
          Cancer Imaging Archive,{" "}
          <a
            href="https://doi.org/10.7937/C7X1-YN57"
            target="_blank"
            rel="noopener noreferrer"
          >
            doi:10.7937/C7X1-YN57
          </a>
          ,{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC BY 4.0
          </a>
          , adapted.
        </p>
      </div>
    </footer>
  );
}

export function LandingPage() {
  const header = useRef<HTMLElement>(null);
  const platform = useRef<HTMLElement>(null);
  const platformTone = usePlatformTone(header, platform);

  useEffect(() => {
    document.title = LANDING_TITLE;
  }, []);

  return (
    <div className="landing-page" data-test-id="login-page">
      <a className="lp-skip-link" href="#landing-main">
        Skip to content
      </a>
      <Header ref={header} platformTone={platformTone} />
      <main id="landing-main">
        <Hero />
        <Story />
        <Platform ref={platform} />
        <Inside />
        <Privacy />
        <Education />
      </main>
      <Footer />
    </div>
  );
}
