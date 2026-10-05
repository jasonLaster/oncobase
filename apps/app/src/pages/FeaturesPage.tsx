import { lazy, Suspense, useEffect, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  BookOpen,
  Check,
  Download,
  Eye,
  FileText,
  Gauge,
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
import { featuresRouteMetadata } from "../special-route-metadata";
import { updateClientRouteMetadata } from "../document-title";
import { OncobaseBrand } from "./LandingBrands";
import { PublicHeader } from "./PublicChrome";
import { RedactionDemo, RoleDemo, ThemedImage } from "./LandingShowcase";
import { CallDemo } from "./CallDemo";
import { CommentsDemo } from "./CommentsDemo";
import {
  AccordionGroup,
  ChatDemo,
  FeatureCard,
  FeatureGrid,
  PinnedScreenshot,
  ThemeCompare,
} from "./FeaturesShowcase";
import {
  REPO_URL,
  detailGroups,
  detailItems,
  features,
  groups,
  heroLede,
  interfaceCategories,
  interfaces,
  sectionCopy,
  type SectionId,
} from "./features-data";
import "./landing.css";
import "./features.css";

/** The first few names, then a count of the rest. */
function previewOf(names: string[]) {
  const shown = names.slice(0, 3).join(" · ");
  return names.length > 3 ? `${shown} · +${names.length - 3} more` : shown;
}

const TableDemo = lazy(() => import("./TableDemo"));
const DiagramDemo = lazy(() => import("./DiagramDemo"));

const nav = [
  ["read", "Read"],
  ["ask", "Ask"],
  ["protect", "Protect"],
  ["data", "See the data"],
  ["collaborate", "Collaborate"],
  ["speed", "Speed"],
  ["details", "Details"],
  ["build", "Build"],
] as const;

function SectionHeading({ id, icon, note }: { id: SectionId; icon: ReactNode; note?: string }) {
  const copy = sectionCopy[id];
  return (
    <div className="lp-section-heading">
      <p className="ft-kicker">
        {icon} {copy.kicker}
      </p>
      <h2 id={`${id}-title`}>{copy.heading}</h2>
      <p>
        {copy.intro}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}

function Header() {
  return <PublicHeader brandHref="/features" brandLabel="Oncobase features" items={nav} navLabel="Feature groups" />;
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
      <p className="ft-hero-lede">{heroLede}</p>
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
      <SectionHeading icon={<BookOpen size={15} aria-hidden="true" />} id="read" />

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

      <div className="ft-block ft-block-wide" id="read-tables">
        <div className="ft-block-intro">
          <h3>Tables that fit their content.</h3>
          <p>
            Column widths come from measuring the real text, so a long
            paragraph and a short label each get the room they need. Try it:
            this is the real table, with sample data. Drag a header edge, pick
            different data, and change the width.
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
        <Suspense fallback={<div aria-busy="true" className="ft-demo ft-demo-loading" />}>
          <TableDemo />
        </Suspense>
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

      <div className="ft-block ft-block-wide" id="read-diagrams">
        <div className="ft-block-intro">
          <h3>Diagrams from plain text.</h3>
          <p>
            Write a flowchart, a decision tree, or a Gantt timeline as text in
            your notes and it draws itself right on the page. Switch themes and
            the diagram follows. Pages without a diagram never download the
            drawing code.
          </p>
          <Bullets
            items={[
              "Flowcharts, timelines, and Gantt charts from a few lines of text",
              "Light and dark versions, tuned to match the reader",
              "Loaded only on pages that contain one",
              "A readable outline and the source if a diagram can’t draw",
            ]}
          />
        </div>
        <div className="ft-visual">
          <Suspense fallback={<div aria-busy="true" className="ft-demo ft-demo-loading" />}>
            <DiagramDemo />
          </Suspense>
        </div>
      </div>

      <div className="ft-block" id="read-calls">
        <div>
          <h3>Calls, three ways, linked.</h3>
          <p>
            A call becomes three pages: the raw speaker transcript, formatted
            notes you can read, and a short overview. Name them
            <code> -raw</code>, <code>-formatted</code>, and
            <code> -overview</code> and the reader adds a switcher. Notes link
            to the exact moment in the transcript, so every claim is one click
            from its source.
          </p>
          <Bullets
            items={[
              "Raw transcript with speakers and timestamps, kept as recorded",
              "Formatted notes organized by topic",
              "An overview with decisions, open questions, and next steps",
              "The file palette collapses a complete set into one entry",
              "Redact once; the same rules apply to all three pages",
            ]}
          />
          <p className="ft-sample">
            Record a call or transcribe a file with
            <code> oncobase transcription</code> and it drafts the note.
          </p>
        </div>
        <div className="ft-visual">
          <CallDemo />
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
      <SectionHeading icon={<Sparkles size={15} aria-hidden="true" />} id="ask" />

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
      <SectionHeading
        icon={<ShieldCheck size={15} aria-hidden="true" />}
        id="protect"
        note="Try the two controls below; the people and details are fictional."
      />

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
      <SectionHeading icon={<Activity size={15} aria-hidden="true" />} id="data" />

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
            and annotate right on the image with arrows, boxes, and a calibrated ruler.
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
        <FeatureCard icon={<Layers size={18} />} title="Annotate right on the image">
          Draw arrows, boxes, and a calibrated ruler on a scan, or save a note
          on a region of a slide. Annotations are saved with the study.
        </FeatureCard>
        <FeatureCard icon={<Search size={18} />} title="Leads from the tumor’s own data">
          Our companion pipeline, Oncoomics, analyzes DNA, RNA, and protein data
          and flags drugs worth raising with the care team.{" "}
          <a href="https://github.com/jasonLaster/oncoomics" rel="noopener noreferrer" target="_blank">
            Oncoomics on GitHub
          </a>
        </FeatureCard>
      </FeatureGrid>
    </section>
  );
}

function Collaborate() {
  return (
    <section className="ft-group lp-container" id="collaborate" aria-labelledby="collaborate-title">
      <SectionHeading icon={<MessageSquare size={15} aria-hidden="true" />} id="collaborate" />

      <div className="ft-block" id="collaborate-comments">
        <div>
          <h3>Comment right where you’re reading.</h3>
          <p>
            Select any passage and start a thread on exactly that text, or
            comment on the page as a whole. Threads appear in a pane beside the
            page, so a question is never far from the sentence that prompted
            it. Try the sample.
          </p>
          <Bullets
            items={[
              "Highlight text to comment on that exact passage",
              "Replies, reactions, edit, and resolve, with an unresolved count",
              "A link to any thread, so you can point someone straight to it",
              "Guests get a steady name; sensitive pages stay locked to people with access",
              "Every thread in one timeline at /comments",
            ]}
          />
        </div>
        <div className="ft-visual">
          <CommentsDemo />
        </div>
      </div>

      <FeatureGrid>
        <FeatureCard icon={<Link2 size={18} />} title="Previews that behave">
          Each page gets its own preview card in chats and social apps.
          Sensitive pages fall back to a generic one.
        </FeatureCard>
        <FeatureCard icon={<BookOpen size={18} />} title="A public guide library">
          Share the explainers you choose, with their own search and no
          password, while everything else stays private.
        </FeatureCard>
        <FeatureCard icon={<Layers size={18} />} title="Several sites, one install">
          Each site gets its own domain, password, roles, and data, from one
          deployment.
        </FeatureCard>
      </FeatureGrid>
    </section>
  );
}

function Speed() {
  const rows = features.filter((feature) => feature.group === "speed");
  return (
    <section className="ft-group lp-container" id="speed" aria-labelledby="speed-title">
      <SectionHeading icon={<Gauge size={15} aria-hidden="true" />} id="speed" />

      <ol className="ft-flow" style={{ ["--steps" as string]: 3 }}>
        <li>
          <b>1 · PAGES YOU’VE OPENED</b>
          <strong>No network at all</strong>
          <span>
            They live in a local database on your device. Reopen one, or go back, and it
            appears from there. They open offline too.
          </span>
        </li>
        <li>
          <b>2 · PAGES YOU HAVEN’T</b>
          <strong>One small request</strong>
          <span>
            The page tree and palette are already local, so the title and its place in the
            tree show at once while the text arrives. Popular pages are fetched ahead of time.
          </span>
        </li>
        <li>
          <b>3 · THE FIRST VISIT</b>
          <strong>A paint in about a quarter second</strong>
          <span>
            A compressed snapshot of your last page paints before the database opens, and
            code loads only when a page needs it.
          </span>
        </li>
      </ol>

      <dl className="ft-stats">
        <div>
          <dt>~230 ms</dt>
          <dd>to first paint on a cold start</dd>
        </div>
        <div>
          <dt>0 requests</dt>
          <dd>to reopen a page you have read</dd>
        </div>
        <div>
          <dt>20 ms</dt>
          <dd>to open a folder of 500 pages</dd>
        </div>
      </dl>
      <p className="ft-caption">
        Measured in September 2026 in a controlled test: 6,000 pages and a throttled laptop CPU.
      </p>

      <div className="ft-table-wrap" style={{ marginTop: 56 }}>
        <table className="ft-table ft-checks">
          <caption className="ft-sr-only">How Oncobase stays fast</caption>
          <thead className="ft-sr-only">
            <tr>
              <th>Technique</th>
              <th>What it does for you</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((feature) => (
              <tr key={feature.name}>
                <td>
                  <Check aria-hidden="true" size={16} />
                  {feature.name}
                </td>
                <td>{feature.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Details() {
  return (
    <section className="ft-group lp-container" id="details" aria-labelledby="details-title">
      <SectionHeading icon={<Check size={15} aria-hidden="true" />} id="details" />
      <div className="ft-acc-list">
        {detailGroups.map((group) => {
          const items = detailItems.filter((item) => item.group === group.id);
          return (
            <AccordionGroup
              count={items.length}
              key={group.id}
              preview={previewOf(items.map((item) => item.title))}
              summary={group.summary}
              title={group.title}
            >
              <table className="ft-table ft-checks">
                <caption className="ft-sr-only">{group.title}</caption>
                <thead className="ft-sr-only">
                  <tr>
                    <th>Detail</th>
                    <th>What it means for you</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.title}>
                      <td>
                        <Check aria-hidden="true" size={16} />
                        {item.title}
                      </td>
                      <td>{item.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AccordionGroup>
          );
        })}
      </div>
    </section>
  );
}

function Build() {
  return (
    <section className="ft-group lp-container" id="build" aria-labelledby="build-title">
      <SectionHeading icon={<Terminal size={15} aria-hidden="true" />} id="build" />

      <div className="ft-grid ft-grid-two" style={{ marginBottom: 56, marginTop: 0 }}>
        <article className="ft-card">
          <span aria-hidden="true" className="ft-card-icon">
            <Terminal size={18} />
          </span>
          <h4>Have your agent build with Oncobase</h4>
          <p>
            Point your agent at the CLI. Guided by the bundled skills, it sets
            up a vault, shows you a dry run, and publishes your own knowledge
            base.
          </p>
        </article>
        <article className="ft-card">
          <span aria-hidden="true" className="ft-card-icon">
            <GitBranch size={18} />
          </span>
          <h4>Or have it borrow from Oncobase</h4>
          <p>
            The code is MIT licensed. While it builds yours, your agent can read
            any part of Oncobase, such as the table viewer, redaction, search, or
            the scan viewers, and use it any way you like.{" "}
            <a href={REPO_URL} rel="noopener noreferrer" target="_blank">
              Browse the code
            </a>
          </p>
        </article>
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
          <a href="/features.md">/features.md</a>.
        </p>
      </div>
      <div className="ft-acc-list">
        {interfaceCategories.map((category) => {
          const items = interfaces.filter((item) => item.category === category.id);
          return (
            <AccordionGroup
              count={items.length}
              key={category.id}
              preview={previewOf(items.map((item) => item.name.replace(/^(GET|POST) /, "")))}
              summary={category.summary}
              title={category.title}
            >
              <table className="ft-table">
                <caption>{category.title}. Gate means the site’s shared-password cookie.</caption>
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>Kind</th>
                    <th>What it does</th>
                    <th>Auth</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
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
            </AccordionGroup>
          );
        })}
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
          <a className="lp-text-link" href="/compare">
            How it compares <ArrowRight size={15} />
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
          <a className="lp-brand" href="/features" aria-label="Oncobase features">
            <OncobaseBrand />
          </a>
          <nav aria-label="Footer">
            <a href={REPO_URL} rel="noopener noreferrer" target="_blank">
              GitHub
            </a>
            <a href="/">Diana’s knowledge base</a>
            <a href="/compare">Compare</a>
            <a href="/features.md">For agents</a>
            <a href="/terms-and-conditions">Terms</a>
          </nav>
        </div>
        <p className="ft-footer-credit">
          Sample content, not medical advice. Inspired by{" "}
          <a href="https://osteosarc.com/" rel="noopener noreferrer" target="_blank">
            osteosarc.com
          </a>
          . MRI image: Daniels et al. (2024), The Cancer Imaging Archive,{" "}
          <a href="https://doi.org/10.7937/C7X1-YN57" rel="noopener noreferrer" target="_blank">
            doi:10.7937/C7X1-YN57
          </a>
          ,{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer" target="_blank">
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
      <div className="ft-root">
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
          <Collaborate />
          <Speed />
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

