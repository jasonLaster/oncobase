import { useEffect } from "react";
import { Activity, ArrowRight, BookOpen, Bot, GitBranch, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { updateClientRouteMetadata } from "../document-title";
import { dianaUrl } from "../site-links";
import { oncobaseHomeRouteMetadata } from "../special-route-metadata";
import { OncobaseBrand, VillageTexture } from "./LandingBrands";
import { PinnedScreenshot } from "./FeaturesShowcase";
import { PublicHeader } from "./PublicChrome";
import { REPO_URL } from "./site";
import "./landing.css";
import "./features.css";
import "./oncobase-home.css";

const nav = [
  ["what", "What it does"],
  ["paths", "Which path"],
  ["agents", "For agents"],
  ["story", "Why it exists"],
] as const;

const external = { rel: "noopener noreferrer", target: "_blank" } as const;

const tour = [
  [BookOpen, "Read", "A palette, an outline, smart tables, and a reader made for phones.", "read"],
  [MessageSquare, "Ask", "Chat with an agent and search by meaning, with sources.", "ask"],
  [ShieldCheck, "Protect", "Roles, sensitive pages, and inline redaction you can try.", "protect"],
  [Activity, "See the data", "Timelines, scans, and pathology slides beside the notes.", "data"],
] as const;

function Hero() {
  return (
    <section className="ft-hero-band" aria-labelledby="oncobase-title">
      <VillageTexture />
      <div className="ft-hero lp-container">
        <p className="ft-kicker">
          <Sparkles size={15} aria-hidden="true" /> Open source. MIT licensed.
        </p>
        <h1 id="oncobase-title">
          Take control <span>of your care.</span>
        </h1>
        <p className="ft-hero-lede">
          Oncobase turns the notes, papers, scans, and results around a diagnosis into a private, searchable site that
          your family and care team can read, ask questions of, and trust. It’s free, open source, and made to be run
          by you or your agent.
        </p>
        <div className="ft-hero-actions">
          <a className="lp-button" href="/features">
            See what it can do <ArrowRight size={16} />
          </a>
          <a className="lp-text-link" href="/compare">
            How it compares <ArrowRight size={15} />
          </a>
        </div>
        <div className="ft-hero-shot">
          <PinnedScreenshot
            alt="Oncobase open to a treatment comparison page: the page tree on the left, a comparison table in the middle, and the outline on the right"
            base="/feature-shots/reader"
            height={1125}
            width={1800}
            pins={[
              { x: 11, y: 46, title: "Page tree", text: "Every page, folders first. It remembers what you had open." },
              { x: 47, y: 55, title: "Smart tables", text: "Columns sized to their content. Drag to resize, expand to fill the screen." },
              { x: 93, y: 12, title: "Outline", text: "Jump between sections. The current one stays highlighted." },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function What() {
  return (
    <section className="ft-group lp-container" id="what" aria-labelledby="what-title">
      <div className="lp-section-heading">
        <h2 id="what-title">Read it, ask it, protect it, see it.</h2>
        <p>
          Everything a family needs around a diagnosis in one place that only the right people can open: the notes and
          papers, the questions, the privacy, and the scans.
        </p>
      </div>
      <div className="lp-tour">
        {tour.map(([Icon, title, text, anchor]) => (
          <a href={`/features#${anchor}`} key={title}>
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
        <a className="lp-text-link" href="/features">
          See everything Oncobase can do <ArrowRight size={16} />
        </a>
      </p>
    </section>
  );
}

function Paths() {
  return (
    <section className="ft-group lp-container" id="paths" aria-labelledby="paths-title">
      <div className="lp-section-heading">
        <h2 id="paths-title">Pick the simplest thing that works.</h2>
        <p>Most people don’t need Oncobase, and we’ll say so. Here is how to tell which kind of person you are.</p>
      </div>
      <div className="oh-paths">
        <article>
          <h3>You just need notes.</h3>
          <p>
            Start with Notion to share with family today, or Obsidian to keep everything private on your own computer.
            Both are good enough for most people.
          </p>
          <a className="lp-text-link" href="/compare#choose">
            Compare the options <ArrowRight size={15} />
          </a>
        </article>
        <article data-us>
          <h3>You want a private knowledge base.</h3>
          <p>
            For a family or care team that needs roles, sensitive pages, hidden names, search that understands the
            question, and scan and slide viewers. You host it, or have your agent set it up.
          </p>
          <a className="lp-text-link" href="/features">
            See what you get <ArrowRight size={15} />
          </a>
        </article>
        <article>
          <h3>You’re building your own.</h3>
          <p>
            For your family or as a company. It’s MIT licensed: take the reader, tables, chat, comments, and viewers, or
            the whole thing.
          </p>
          <a className="lp-text-link" href="/compare#build">
            What you can reuse <ArrowRight size={15} />
          </a>
        </article>
      </div>
    </section>
  );
}

function Agents() {
  return (
    <section className="ft-group lp-container" id="agents" aria-labelledby="agents-title">
      <div className="lp-section-heading">
        <h2 id="agents-title">
          <Bot aria-hidden="true" className="oh-heading-icon" size={30} /> Made for you and your agent.
        </h2>
        <p>
          Have your agent build your own knowledge base with the Oncobase CLI, or have it borrow from the code while it
          builds yours. Point it at these plain-text pages and it can see everything Oncobase does.
        </p>
      </div>
      <pre className="ft-code" tabIndex={0}>
        {`/features.md    every feature, where it lives, and how to call it
/compare.md     how Oncobase compares, and what to reuse
/llms.txt       the short index`}
      </pre>
      <p className="oh-links">
        <a className="lp-text-link" href="/features.md">
          Read features.md <ArrowRight size={15} />
        </a>
        <a className="lp-text-link" href="/compare.md">
          Read compare.md <ArrowRight size={15} />
        </a>
      </p>
    </section>
  );
}

function Story() {
  return (
    <section className="ft-group lp-container" id="story" aria-labelledby="story-title">
      <div className="lp-section-heading">
        <h2 id="story-title">Built by a family going through it.</h2>
        <p>
          When Diana was diagnosed with triple-negative breast cancer, we built a knowledge base for her records, scans,
          and research so everyone helping her could work from the same page. Oncobase is that site, made open source so
          anyone can take control of their care. It was inspired by{" "}
          <a href="https://osteosarc.com/" {...external}>
            Sid Sijbrandij’s osteosarc.com
          </a>
          , where he openly shares the data from his own cancer journey.
        </p>
        <a className="lp-text-link" href={dianaUrl("/")}>
          See Diana’s knowledge base <ArrowRight size={16} />
        </a>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="ft-cta" aria-labelledby="cta-title">
      <div className="lp-container">
        <h2 id="cta-title">Free, open source, and yours.</h2>
        <p>Read the code, run it yourself, or hand this page to your agent and ask it to get started.</p>
        <div className="ft-hero-actions">
          <a className="lp-button" href={REPO_URL} {...external}>
            <GitBranch size={16} /> View Oncobase on GitHub <ArrowRight size={15} />
          </a>
          <a className="lp-text-link" href="/features">
            Everything it can do <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer-shell">
      <div className="ft-footer lp-container">
        <div className="ft-footer-row">
          <a className="lp-brand" href="/" aria-label="Oncobase home">
            <OncobaseBrand />
          </a>
          <nav aria-label="Footer">
            <a href={REPO_URL} {...external}>
              GitHub
            </a>
            <a href="/features">Features</a>
            <a href="/compare">Compare</a>
            <a href={dianaUrl("/")}>Diana’s knowledge base</a>
            <a href="/features.md">For agents</a>
          </nav>
        </div>
        <p className="ft-footer-credit">
          Sample content, not medical advice. Inspired by{" "}
          <a href="https://osteosarc.com/" {...external}>
            osteosarc.com
          </a>
          .
        </p>
      </div>
    </footer>
  );
}

export function OncobaseHomePage() {
  useEffect(() => {
    updateClientRouteMetadata(oncobaseHomeRouteMetadata());
  }, []);

  return (
    <div className="landing-page ft-page" data-test-id="oncobase-home-page">
      <div className="ft-root">
        <a className="lp-skip-link" href="#oncobase-main">
          Skip to content
        </a>
        <PublicHeader brand="oncobase" items={nav} navLabel="Page sections" />
        <main id="oncobase-main">
          <Hero />
          <What />
          <Paths />
          <Agents />
          <Story />
          <Cta />
        </main>
        <Footer />
      </div>
    </div>
  );
}
