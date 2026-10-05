import { useEffect } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  BookOpen,
  Check,
  Download,
  Eye,
  FileText,
  GitBranch,
  Keyboard,
  Layers,
  Link2,
  ListTree,
  LockKeyhole,
  MessageSquare,
  Microscope,
  Palette,
  Scan,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Table2,
  Terminal,
  Users,
  WifiOff,
} from "lucide-react";
import { PublicThemeControl } from "../PublicThemeControl";
import { featuresRouteMetadata } from "../special-route-metadata";
import { updateClientRouteMetadata } from "../document-title";
import { OncobaseBrand } from "./LandingBrands";
import { RedactionDemo, RoleDemo, ThemedImage } from "./LandingShowcase";
import {
  ChatDemo,
  FeatureCard,
  FeatureGrid,
  PinnedScreenshot,
  ThemeCompare,
} from "./FeaturesShowcase";
import {
  REPO_URL,
  detailItems,
  features,
  groups,
  interfaces,
} from "./features-data";
import "./landing.css";
import "./features.css";

const nav = [
  ["read", "Read"],
  ["ask", "Ask"],
  ["protect", "Protect"],
  ["data", "See the data"],
  ["build", "Build"],
] as const;

function Header() {
  return (
    <header className="lp-header-shell" data-tone="oncobase">
      <div className="lp-header lp-container">
        <a className="lp-brand" href="/features" aria-label="Oncobase features">
          <OncobaseBrand />
        </a>
        <nav aria-label="Feature groups">
          {nav.map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
          <a href="#details">Details</a>
        </nav>
        <div className="lp-header-actions">
          <PublicThemeControl />
          <a
            className="lp-button lp-button-small"
            href={REPO_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitBranch size={15} /> GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="ft-hero lp-container" aria-labelledby="features-title">
      <p className="ft-kicker">
        <Sparkles size={15} aria-hidden="true" /> Open source. MIT licensed.
      </p>
      <h1 id="features-title">
        Everything <span>Oncobase</span> can do.
      </h1>
      <p className="ft-hero-lede">
        A knowledge base for taking control of your care, built with attention
        to detail: the way a table fits your screen, where a link lands, what a
        stranger can and can’t see.
      </p>
      <div className="ft-hero-actions">
        <a className="lp-button" href="#read">
          Tour the features <ArrowRight size={16} />
        </a>
        <a
          className="lp-text-link"
          href={REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <GitBranch size={15} /> View the code <ArrowRight size={15} />
        </a>
      </div>
      <div className="ft-hero-shot">
        <PinnedScreenshot
          alt="Oncobase open to a treatment comparison page: the page tree on the left, a comparison table in the middle, and the outline on the right"
          base="/feature-shots/reader"
          height={1125}
          width={1800}
          pins={[
            {
              x: 11,
              y: 46,
              title: "Page tree",
              text: "Every page, folders first. It remembers what you had open.",
            },
            {
              x: 47,
              y: 55,
              title: "Smart tables",
              text: "Columns sized to their content. Drag to resize, expand to fill the screen.",
            },
            {
              x: 93,
              y: 12,
              title: "Outline",
              text: "Jump between sections. The current one stays highlighted.",
            },
          ]}
        />
        <p className="ft-caption">Sample content, not medical advice.</p>
      </div>
      <nav className="ft-map" aria-label="Feature groups">
        {[
          ["read", BookOpen, "Read", "Tree, outline, palette, tables, phones, themes."],
          ["ask", MessageSquare, "Ask", "Chat with an agent and search by meaning."],
          ["protect", ShieldCheck, "Protect", "Roles, sensitive pages, inline redaction."],
          ["data", Activity, "See the data", "Timelines, DICOM scans, pathology slides."],
          ["details", Check, "The details", "The small things that make it trustworthy."],
          ["build", Terminal, "Build", "Publish from files. Built for people and agents."],
        ].map(([id, Icon, title, text]) => {
          const IconComponent = Icon as typeof BookOpen;
          return (
            <a href={`#${id as string}`} key={id as string}>
              <strong>
                <IconComponent size={18} aria-hidden="true" /> {title as string}
              </strong>
              <span>{text as string}</span>
            </a>
          );
        })}
      </nav>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="ft-list">
      {items.map((item) => (
        <li key={item}>
          <Check size={16} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Read() {
  return (
    <section className="ft-group lp-container" id="read" aria-labelledby="read-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <BookOpen size={15} aria-hidden="true" /> Read
        </p>
        <h2 id="read-title">Find your way, then read in peace.</h2>
        <p>
          Hundreds of pages should feel as easy as one. Everything below works
          on a laptop, a tablet, and a phone.
        </p>
      </div>

      <div className="ft-block">
        <div>
          <h3>A file palette that keeps up.</h3>
          <p>
            Press ⌘K from anywhere. It matches page names as you type, shows
            what you opened recently, and works offline because it searches the
            list already on your device.
          </p>
          <Bullets
            items={[
              "Fuzzy matching on name, title, and path",
              "⌘⇧O finds a heading; ⌘⇧K runs an action",
              "Modes for source PDFs, tags, and related files",
              "Announces results to screen readers",
            ]}
          />
        </div>
        <div className="ft-visual">
          <div className="ft-block-shot">
            <ThemedImage
              alt="The file palette open over a page, showing recent pages and all pages"
              base="/feature-shots/palette"
              decoding="async"
              extension="jpg"
              height={830}
              loading="lazy"
              width={1280}
            />
          </div>
        </div>
      </div>

      <div className="ft-block ft-block-wide">
        <div>
          <h3>Tables that fit their content.</h3>
          <p>
            Column widths come from measuring the real text, so a long
            paragraph and a short label each get the room they need. Narrow the
            window and the table scrolls with a soft edge instead of
            squeezing.
          </p>
          <Bullets
            items={[
              "Drag any header edge to resize; widths last for the session",
              "Expand a table to fill the workspace on a desktop",
              "On phones: a sticky first column and edge shadows",
              "Scroll regions work from the keyboard",
            ]}
          />
        </div>
        <div className="ft-tables">
          <figure>
            <div className="ft-block-shot">
              <ThemedImage
                alt="A comparison table at a wide width, with every column fully visible"
                base="/feature-shots/table-wide"
                decoding="async"
                extension="jpg"
                height={732}
                loading="lazy"
                width={1400}
              />
            </div>
            <figcaption>Wide: every column fits.</figcaption>
          </figure>
          <figure>
            <div className="ft-block-shot">
              <ThemedImage
                alt="The same table at a narrow width, scrolling sideways with a faded right edge"
                base="/feature-shots/table-narrow"
                decoding="async"
                extension="jpg"
                height={731}
                loading="lazy"
                width={800}
              />
            </div>
            <figcaption>Narrow: columns keep their size and it scrolls.</figcaption>
          </figure>
        </div>
      </div>

      <div className="ft-block ft-block-reverse">
        <div>
          <h3>Made for the phone in your hand.</h3>
          <p>
            Caregivers read at the bedside and in waiting rooms. The phone
            reader has its own header, a bottom sheet for pages and outline,
            and an Ask button that gets out of the way when you scroll.
          </p>
          <Bullets
            items={[
              "Page nav and Outline tabs in one sheet",
              "Focus is trapped while it’s open and restored when it closes",
              "Heading links clear the fixed header",
              "Pinch and two-finger pan in the scan viewer",
            ]}
          />
        </div>
        <div className="ft-phones ft-visual">
          {(
            [
              ["mobile-page", "The page"],
              ["mobile-nav", "Page nav"],
              ["mobile-outline", "Outline"],
            ] as const
          ).map(([base, label]) => (
            <figure key={base}>
              <div className="ft-phone-frame">
                <ThemedImage
                  alt={`The phone reader showing ${label.toLowerCase()}`}
                  base={`/feature-shots/${base}`}
                  decoding="async"
                  extension="jpg"
                  height={1125}
                  loading="lazy"
                  width={520}
                />
              </div>
              <figcaption>{label}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className="ft-block">
        <div>
          <h3>Illustrations in light and dark.</h3>
          <p>
            We draw our explanatory cartoons in matching light and dark
            versions, and pages like this one show the version that fits your
            theme. Drag the divider to compare. Open any image on a page full
            screen, download it, or step through a slide set with the arrow
            keys.
          </p>
          <Bullets
            items={[
              "Each cartoon is drawn in a light and a dark version",
              "Native full-screen lightbox with download",
              "Slide sets with a stepper and keyboard control",
              "Three theme modes: light, dark, or follow the system",
            ]}
          />
        </div>
        <div className="ft-visual">
          <ThemeCompare
            alt="One illustration of how the immune system recognizes a cell, shown in its light and dark versions"
            base="/landing/immune-recognition"
            extension="webp"
            height={1024}
            width={1536}
          />
        </div>
      </div>

      <FeatureGrid>
        <FeatureCard icon={<ListTree size={18} />} title="A tree that remembers">
          Folders first, resizable, collapsible to a rail, and virtualized for
          large vaults. Open folders and width persist.
        </FeatureCard>
        <FeatureCard icon={<Palette size={18} />} title="Theme before first paint">
          Your light or dark choice is applied before anything draws, so dark
          mode never flashes white. Mermaid diagrams follow along.
        </FeatureCard>
        <FeatureCard icon={<FileText size={18} />} title="Rich markdown">
          Wikilinks, footnotes, task lists, KaTeX math, Mermaid diagrams, and
          citation numbers that jump to the reference.
        </FeatureCard>
        <FeatureCard icon={<Link2 size={18} />} title="Links that land right">
          Every heading has a link. Hover for a # that copies it, and deep
          links scroll to the right spot, even on very long pages.
        </FeatureCard>
        <FeatureCard icon={<WifiOff size={18} />} title="Saved pages, offline">
          Pages are stored on your device and say so: “Saved page · offline”.
          Slow connections show bytes arriving and offer a Retry.
        </FeatureCard>
        <FeatureCard icon={<Download size={18} />} title="Copy and download">
          Copy a page as markdown in one click, or download the whole wiki as
          a zip. What you copy is already redacted.
        </FeatureCard>
      </FeatureGrid>
    </section>
  );
}

const searchTools = [
  ["File palette", "Jumping to a page you know", "Fuzzy match on page names, offline", "⌘K"],
  ["Text search", "Finding an exact phrase or number", "Literal text, with line numbers and highlights", "/search"],
  ["AI search", "“Where did we talk about…?”", "Meaning, ranked out of 10 with a reason", "/search"],
  ["Chat", "Questions that span several pages", "An agent that reads, links, and cites", "Ask wiki"],
] as const;

function Ask() {
  return (
    <section className="ft-group lp-container" id="ask" aria-labelledby="ask-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <Sparkles size={15} aria-hidden="true" /> Ask
        </p>
        <h2 id="ask-title">Talk to the knowledge base.</h2>
        <p>
          Three ways to find things: exact words, meaning, and a conversation.
          Each one only ever sees what you’re allowed to see.
        </p>
      </div>

      <div className="ft-block">
        <div>
          <h3>A chat agent that finds its own context.</h3>
          <p>
            Ask in plain language. Behind the scenes an agent searches the
            pages, reads the best matches, follows the links between them, and
            answers with citations you can click.
          </p>
          <Bullets
            items={[
              "Searches several phrasings and by meaning, then merges the results",
              "Reads the most relevant pages and follows their links",
              "Cites its sources inline, with a list of the pages it read",
              "Saves conversations; stop, queue a follow-up, or resume",
              "Respects roles: restricted pages are reported as unavailable",
            ]}
          />
        </div>
        <div className="ft-visual">
          <ChatDemo />
        </div>
      </div>

      <ol className="ft-flow" style={{ ["--steps" as string]: 4 }}>
        <li>
          <b>1 · UNDERSTAND</b>
          <strong>Your question</strong>
          <span>Plain language is fine, abbreviations included.</span>
        </li>
        <li>
          <b>2 · SEARCH</b>
          <strong>Words and meaning</strong>
          <span>Several phrasings plus semantic search, merged and de-duplicated.</span>
        </li>
        <li>
          <b>3 · READ</b>
          <strong>The best pages</strong>
          <span>It opens the top matches and follows their links for context.</span>
        </li>
        <li>
          <b>4 · ANSWER</b>
          <strong>With sources</strong>
          <span>Inline citations that link to the page and heading.</span>
        </li>
      </ol>

      <div className="ft-block ft-block-wide">
        <div className="ft-block-intro">
          <h3>Search by meaning, not just words.</h3>
          <p>
            AI search understands what you’re asking, then ranks the pages that
            answer it. Each result is scored out of 10 and comes with a short
            note on why it matched.
          </p>
          <Bullets
            items={[
              "Semantic search over embeddings made when you publish",
              "Every result scored for relevance, with a one-line reason",
              "Low-relevance pages are dropped",
              "Text Search is one tab away for exact words, with line hits",
            ]}
          />
        </div>
        <div className="ft-visual">
          <div className="ft-block-shot">
            <ThemedImage
              alt="AI search results for a question about treatment options, each with a relevance score out of 10 and a summary"
              base="/feature-shots/ai-search"
              decoding="async"
              extension="jpg"
              height={672}
              loading="lazy"
              width={1600}
            />
          </div>
        </div>
      </div>

      <div className="ft-table-wrap" style={{ marginTop: 72 }}>
        <table className="ft-table">
          <caption>Which one to reach for</caption>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Best for</th>
              <th>How it matches</th>
              <th>Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {searchTools.map(([tool, bestFor, matches, shortcut]) => (
              <tr key={tool}>
                <td>{tool}</td>
                <td>{bestFor}</td>
                <td>{matches}</td>
                <td>
                  <code>{shortcut}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Protect() {
  return (
    <section className="ft-group lp-container" id="protect" aria-labelledby="protect-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <ShieldCheck size={15} aria-hidden="true" /> Protect
        </p>
        <h2 id="protect-title">Share the science without sharing the patient.</h2>
        <p>
          Privacy is built in layers, so a mistake in one doesn’t expose
          everything. Try the two controls below; the people and details are
          fictional.
        </p>
      </div>

      <ol className="ft-flow" style={{ ["--steps" as string]: 5 }}>
        <li>
          <b>1 · ENTRY</b>
          <strong>Password gate</strong>
          <span>A shared password in front of the site.</span>
        </li>
        <li>
          <b>2 · IDENTITY</b>
          <strong>Accounts</strong>
          <span>Each person signs in as themselves.</span>
        </li>
        <li>
          <b>3 · ACCESS</b>
          <strong>Roles</strong>
          <span>Folders and tags each role can open.</span>
        </li>
        <li>
          <b>4 · PAGES</b>
          <strong>Sensitive flag</strong>
          <span>Marked pages disappear from everything else.</span>
        </li>
        <li>
          <b>5 · SPANS</b>
          <strong>Inline redaction</strong>
          <span>Hide a name inside an otherwise open page.</span>
        </li>
      </ol>

      <div className="lp-demo-pair" style={{ marginTop: 56 }}>
        <RoleDemo />
        <RedactionDemo />
      </div>
      <p className="lp-footnote">
        Interactive examples with fictional people and details.
      </p>

      <FeatureGrid>
        <FeatureCard icon={<Users size={18} />} title="Roles that fail closed">
          A sensitive page is visible only to a role whose rules match it. If no
          role matches, nobody sees it.
        </FeatureCard>
        <FeatureCard icon={<Eye size={18} />} title="Sensitive means everywhere">
          A sensitive page is left out of guest manifests, search, AI search,
          chat, tags, downloads, link previews, and comments.
        </FeatureCard>
        <FeatureCard icon={<ShieldCheck size={18} />} title="Redaction where text leaves">
          Redaction applies on page reads, search, AI search, chat, copy, and
          downloads, and again when you publish.
        </FeatureCard>
        <FeatureCard icon={<Layers size={18} />} title="Admin you can preview">
          Filter pages by who can see them, assign roles in bulk, and preview
          what a role includes before saving.
        </FeatureCard>
        <FeatureCard icon={<LockKeyhole size={18} />} title="Private by default">
          Signed-in responses are never cached, sensitive pages are never
          indexed, and crawlers are told to stay out.
        </FeatureCard>
        <FeatureCard icon={<Bot size={18} />} title="Agents follow the rules too">
          Chat and AI search see only what the viewer may see, and redact
          before the model reads a word.
        </FeatureCard>
      </FeatureGrid>

      <div className="ft-block" style={{ marginTop: 96 }}>
        <div>
          <h3>Skills that know what to redact.</h3>
          <p>
            Redaction is a judgment call, so we wrote the judgment down. In
            Diana’s vault, agent skills spell out what to hide, what to leave
            readable, and when a page is truly sensitive, and a linter flags
            anything that slipped through. Because they’re plain files, any
            agent can follow them.
          </p>
          <Bullets
            items={[
              "Wrap the smallest span, usually just a surname",
              "Keep first names readable so notes still sound human",
              "Never mark public papers or lecture notes sensitive",
              "Mark a page sensitive only when it can’t be redacted",
            ]}
          />
        </div>
        <div className="ft-table-wrap">
          <table className="ft-table" style={{ minWidth: 0 }}>
            <caption>Rules the agent follows</caption>
            <thead>
              <tr>
                <th>Redact</th>
                <th>Leave readable</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ whiteSpace: "normal" }}>Last names and full-name combinations</td>
                <td>First names in prose</td>
              </tr>
              <tr>
                <td style={{ whiteSpace: "normal" }}>Birth dates, record numbers</td>
                <td>Diagnoses, drugs, and biomarkers</td>
              </tr>
              <tr>
                <td style={{ whiteSpace: "normal" }}>Emails, phones, home addresses</td>
                <td>Published papers and trials</td>
              </tr>
              <tr>
                <td style={{ whiteSpace: "normal" }}>Contract and intake contact details</td>
                <td>Treatment strategy and decisions</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Data() {
  return (
    <section className="ft-group lp-container" id="data" aria-labelledby="data-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <Activity size={15} aria-hidden="true" /> See the data
        </p>
        <h2 id="data-title">Results and scans, right beside the notes.</h2>
        <p>
          Clinical data is easier to understand next to the conversation about
          it. These viewers run in the browser, with nothing to install.
        </p>
      </div>

      <div className="lp-card-pair">
        <article className="lp-card">
          <h3>Follow results over time.</h3>
          <p>
            Swim-lanes for imaging, pathology, ctDNA, and blood counts. Drag the
            overview, zoom, filter, and open the report behind any result.
          </p>
          <div className="lp-screenshot">
            <ThemedImage
              alt="The diagnostics timeline with imaging, pathology, ctDNA, and blood count tracks"
              base="/landing/diagnostics-timeline"
              decoding="async"
              extension="jpg"
              height="640"
              loading="lazy"
              width="1192"
            />
          </div>
        </article>
        <article className="lp-card">
          <h3>Open the scan in the browser.</h3>
          <p>
            Scroll through MRI and CT series, adjust window and level, play cine,
            and draw arrows, boxes, and a calibrated ruler that are saved with the study.
          </p>
          <div className="lp-screenshot">
            <img
              alt="The imaging viewer showing a breast MRI series with the series list and tools"
              decoding="async"
              height="640"
              loading="lazy"
              src="/landing/dicom-viewer.jpg"
              width="1192"
            />
          </div>
        </article>
      </div>

      <FeatureGrid>
        <FeatureCard icon={<Scan size={18} />} title="Compare scans side by side">
          Two synced viewports with presets such as subtraction, z-matched, and
          projection, and a clear note on how well the slices match.
        </FeatureCard>
        <FeatureCard icon={<Microscope size={18} />} title="Whole-slide pathology">
          Zoom a full H&E slide with a navigator, magnification, scale bar, and
          rulers. Compare two slides and save notes on a region.
        </FeatureCard>
        <FeatureCard icon={<Smartphone size={18} />} title="Touch ready">
          One finger draws, two fingers pinch and pan. Deep links open a
          specific image or annotation.
        </FeatureCard>
        <FeatureCard icon={<Activity size={18} />} title="Lab results flow in">
          An hourly import of lab results from Epic MyChart, stored with
          encrypted tokens.
        </FeatureCard>
        <FeatureCard icon={<MessageSquare size={18} />} title="Comments in context">
          Threads on a page or on selected text, with replies, reactions, and
          links that jump straight to the thread.
        </FeatureCard>
        <FeatureCard icon={<Search size={18} />} title="Previews that behave">
          Each page gets a preview card in chats and social apps. Sensitive
          pages fall back to a generic one.
        </FeatureCard>
      </FeatureGrid>
    </section>
  );
}

function Details() {
  return (
    <section className="ft-group lp-container" id="details" aria-labelledby="details-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <Check size={15} aria-hidden="true" /> The details
        </p>
        <h2 id="details-title">Built with attention to detail.</h2>
        <p>
          Caring for someone is full of small moments where software either
          helps or gets in the way. These are the small things we sweated, and
          most are covered by automated tests.
        </p>
      </div>
      <div className="ft-grid">
        {detailItems.map((item) => (
          <article className="ft-card" key={item.title}>
            <h4 style={{ marginTop: 0 }}>{item.title}</h4>
            <p>{item.text}</p>
            {item.proof ? (
              <p style={{ marginTop: 12 }}>
                <span className="ft-tag">{item.proof}</span>
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function Build() {
  return (
    <section className="ft-group lp-container" id="build" aria-labelledby="build-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <Terminal size={15} aria-hidden="true" /> Build
        </p>
        <h2 id="build-title">Publish from plain files. Built for people and agents.</h2>
        <p>
          Write in a folder of markdown, the way you would in Obsidian. One
          command publishes it. Everything is open source, and every feature
          has an interface a script or an agent can use.
        </p>
      </div>

      <ol className="ft-flow" style={{ ["--steps" as string]: 4 }}>
        <li>
          <b>1 · WRITE</b>
          <strong>A vault of markdown</strong>
          <span>Notes, papers, transcripts, and PDFs in plain folders.</span>
        </li>
        <li>
          <b>2 · CHECK</b>
          <strong>
            <code>oncobase check</code>
          </strong>
          <span>A dry run shows what changed and what would be removed.</span>
        </li>
        <li>
          <b>3 · PUBLISH</b>
          <strong>
            <code>oncobase publish</code>
          </strong>
          <span>Only changed files upload; embeddings are made for search.</span>
        </li>
        <li>
          <b>4 · READ</b>
          <strong>Your knowledge base</strong>
          <span>Live on Vercel and Convex, or the standalone Bun server.</span>
        </li>
      </ol>

      <div className="ft-block" style={{ marginTop: 72 }}>
        <div>
          <h3>Start in a few commands.</h3>
          <p>
            The CLI sets up a vault, shows you a dry run, and publishes. Skills
            for first-time setup and safe checks ship with it, so an agent can
            do the whole thing with you.
          </p>
          <Bullets
            items={[
              "Dry runs first; deletions need an explicit flag",
              "Dirty working trees are refused unless you say so",
              "Uploads are verified by reading them back",
              "A local stack runs everything on your machine",
            ]}
          />
        </div>
        <pre className="ft-code" tabIndex={0}>
          {`oncobase init --site my-site --vault ./vault \\
  --publish-url https://my-site.example
oncobase skills            # copy the agent skills
oncobase check             # dry run: what would change
oncobase publish --embeddings auto

bun run local:stack        # a full local backend`}
        </pre>
      </div>

      <div className="lp-section-heading" style={{ marginTop: 96, marginBottom: 32 }}>
        <h2 style={{ fontSize: "clamp(26px, 3.4vw, 36px)" }}>
          For agents and scripts.
        </h2>
        <p>
          If you’re building on Oncobase, or you are an agent trying to use it,
          this is the surface. The same lists are published as plain text at{" "}
          <a href="/llms.txt">/llms.txt</a> and{" "}
          <a href="/llms-full.txt">/llms-full.txt</a>.
        </p>
      </div>
      <div className="ft-table-wrap">
        <table className="ft-table">
          <caption>Interfaces. Gate means the site’s shared-password cookie.</caption>
          <thead>
            <tr>
              <th>Interface</th>
              <th>Kind</th>
              <th>What it does</th>
              <th>Auth</th>
            </tr>
          </thead>
          <tbody>
            {interfaces.map((item) => (
              <tr key={item.name}>
                <td>
                  <code>{item.name}</code>
                </td>
                <td>
                  <span className="ft-tag">{item.kind}</span>
                </td>
                <td>{item.does}</td>
                <td>{item.auth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AllFeatures() {
  return (
    <section className="ft-group lp-container" id="all" aria-labelledby="all-title">
      <div className="lp-section-heading">
        <p className="ft-kicker">
          <Keyboard size={15} aria-hidden="true" /> The full list
        </p>
        <h2 id="all-title">Every feature, in one place.</h2>
        <p>
          {features.length} features across {groups.length} areas. Tables are
          sized to their content, so scroll sideways on a phone.
        </p>
      </div>
      <div className="ft-table-wrap">
        <table className="ft-table">
          <caption>All features, by area</caption>
          <thead>
            <tr>
              <th>Feature</th>
              <th>What it does</th>
              <th>Where</th>
              <th>Interface</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) => [
              <tr key={`g-${group.id}`}>
                <td colSpan={4} style={{ background: "var(--lp-panel)", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {group.title}
                </td>
              </tr>,
              ...features
                .filter((feature) => feature.group === group.id)
                .map((feature) => (
                  <tr key={feature.name}>
                    <td>{feature.name}</td>
                    <td>{feature.summary}</td>
                    <td>{feature.where}</td>
                    <td>{feature.surface ? <code>{feature.surface}</code> : "—"}</td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="ft-cta" aria-labelledby="cta-title">
      <div className="lp-container">
        <h2 id="cta-title">Take control of your care.</h2>
        <p>
          It’s free, it’s open source, and it was built by a family going
          through it. See it in use, or take the code.
        </p>
        <div className="ft-hero-actions">
          <a
            className="lp-button"
            href={REPO_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitBranch size={16} /> View Oncobase on GitHub <ArrowRight size={15} />
          </a>
          <a className="lp-text-link" href="/">
            See Diana’s knowledge base <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer-shell">
      <div className="lp-footer lp-container">
        <a className="lp-brand" href="/features" aria-label="Oncobase features">
          <OncobaseBrand />
        </a>
        <div className="lp-footer-note">
          <p>Sample content, not medical advice.</p>
          <a href="/">Diana’s knowledge base</a>
          <a href="/terms-and-conditions">Terms & conditions</a>
          <a href="/llms.txt">For agents</a>
        </div>
        <p className="lp-footer-credit">
          Oncobase was inspired by{" "}
          <a href="https://osteosarc.com/" rel="noopener noreferrer" target="_blank">
            Sid Sijbrandij’s osteosarc.com
          </a>
          . MRI image: Daniels et al. (2024), Advanced-MRI-Breast-Lesions, The
          Cancer Imaging Archive,{" "}
          <a href="https://doi.org/10.7937/C7X1-YN57" rel="noopener noreferrer" target="_blank">
            doi:10.7937/C7X1-YN57
          </a>
          ,{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            rel="noopener noreferrer"
            target="_blank"
          >
            CC BY 4.0
          </a>
          , adapted.
        </p>
      </div>
    </footer>
  );
}

export function FeaturesPage() {
  useEffect(() => {
    updateClientRouteMetadata(featuresRouteMetadata());
  }, []);

  return (
    <div className="landing-page ft-page" data-test-id="features-page">
      <div className="lp-oncobase ft-root">
        <a className="lp-skip-link" href="#features-main">
          Skip to content
        </a>
        <Header />
        <main id="features-main">
          <Hero />
          <Read />
          <Ask />
          <Protect />
          <Data />
          <Details />
          <Build />
          <AllFeatures />
          <Cta />
        </main>
        <Footer />
      </div>
    </div>
  );
}

