import { LANDING_TITLE } from "../special-route-metadata";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  GitBranch,
  Heart,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import {
  GuideFigure,
  KnowledgeBaseContents,
  PrivateLink,
  ProductShots,
} from "./LandingShowcase";
import { DianaBrand, EducationTexture, OncobaseBrand, VillageTexture } from "./LandingBrands";
import { PublicHeader } from "./PublicChrome";
import { oncobaseUrl } from "../site-links";
import "./landing.css";

/** Tinted while the Oncobase band is under the header. */
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

const sections = [
  ["story", "Our story"],
  ["platform", "Oncobase"],
  ["inside", "What’s inside"],
  ["education", "Education"],
] as const;

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

      <div className="lp-tour">
        {(
          [
            [BookOpen, "Read", "A palette, an outline, smart tables, and a reader made for phones.", "read"],
            [MessageSquare, "Ask", "Chat with an agent and search by meaning, with sources.", "ask"],
            [ShieldCheck, "Protect", "Roles, sensitive pages, and inline redaction you can try.", "protect"],
            [Activity, "See the data", "Timelines, scans, and pathology slides beside the notes.", "data"],
          ] as const
        ).map(([Icon, title, text, anchor]) => (
          <a href={oncobaseUrl(`/features#${anchor}`)} key={title}>
            <Icon aria-hidden="true" size={20} />
            <strong>{title}</strong>
            <span>{text}</span>
            <em>
              See how <ArrowRight aria-hidden="true" size={14} />
            </em>
          </a>
        ))}
      </div>
      <p className="lp-tour-all">
        <a className="lp-text-link" href={oncobaseUrl("/features")}>
          See everything Oncobase can do <ArrowRight size={16} />
        </a>
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
            <a className="lp-text-link" href={oncobaseUrl("/")}>
              Learn about Oncobase <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Cartoons from the public guides. The first two lead; the rest follow. Each links to the page it comes from. */
const educationGuides = [
  {
    base: "/landing/immune-recognition",
    alt: "Cartoon of protein fragments displayed on HLA and recognized by a T cell",
    title: "How the immune system sees a cell",
    path: "/education/oncology-101/index",
    description: "Cells show T cells what they’re making. From Oncology 101.",
  },
  {
    base: "/landing/cell-therapy-family",
    alt: "Cartoon comparing peptide-HLA, surface-antigen, and innate-like cell therapy families",
    title: "Cellular therapies",
    path: "/education/cellular-therapies/index",
    description: "Meet the families of immune cell therapy.",
  },
  {
    base: "/landing/omics-layers",
    alt: "Cartoon comparing DNA to a blueprint, RNA to the pages being read, protein to the building, and metabolites to fuel and waste",
    title: "A tumor, read like a blueprint",
    path: "/education/reading-a-tumor/omics-and-multi-omics",
    description: "DNA is the plan, RNA the page being read, protein the building.",
  },
  {
    base: "/landing/ctdna-mailroom",
    alt: "Cartoon comparing a mailroom full of letters to a blood sample where tumor DNA is a tiny fraction of the DNA",
    title: "Finding tumor DNA in the blood",
    path: "/education/molecular-profiling/06-ctdna-and-mrd",
    description: "A mailroom analogy for a signal as small as one in 10,000.",
  },
  {
    base: "/landing/parp-synthetic-lethality",
    alt: "Cartoon in four panels showing how blocking PARP kills a cell only when its other DNA repair route is broken",
    title: "Synthetic lethality, in four steps",
    path: "/education/molecular-profiling/hrd-parp-and-dianas-biology",
    description: "Why a PARP inhibitor hits cells with broken DNA repair.",
  },
];

function Education() {
  return (
    <section
      className="lp-education"
      id="education"
      aria-labelledby="education-title"
    >
      <EducationTexture />
      <div className="lp-section lp-section-end lp-container">
        <div className="lp-section-heading">
          <h2 id="education-title">
            What does that term mean? <span>Start with a cartoon.</span>
          </h2>
          <p>
            A few of the cartoons we’ve been learning from. Open one to read the
            guide behind it, or browse the rest. Anyone can read them, no
            password needed.
          </p>
          <a className="lp-text-link" href="/education">
            Browse educational content <ArrowRight size={16} />
          </a>
        </div>
        <div
          className="lp-guides"
          role="group"
          aria-label="Educational cartoons"
        >
          {educationGuides.map((guide) => (
            <GuideFigure key={guide.base} {...guide} />
          ))}
        </div>
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
          <a href={oncobaseUrl("/features")}>Features</a>
          <a href={oncobaseUrl("/compare")}>Compare</a>
          <a href="/terms-and-conditions">Terms & conditions</a>
        </div>
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
      <PublicHeader
        action="sign-in"
        brand="diana"
        items={sections}
        navLabel="Page sections"
        ref={header}
        tone={platformTone ? "oncobase" : "diana"}
      />
      <main id="landing-main">
        <Hero />
        <Story />
        <Platform ref={platform} />
        <Inside />
        <Education />
      </main>
      <Footer />
    </div>
  );
}
