import { useState, type ReactNode } from "react";
import { isEducationPathname } from "../education-access";
import {
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";

const diana = "https://diana-tnbc.com";

function SourceLink({ path, children }: { path: string; children: ReactNode }) {
  return (
    <a
      className="lp-source-link"
      href={isEducationPathname(path) ? path : `${diana}${path}`}
      target={isEducationPathname(path) ? undefined : "_blank"}
      rel="noopener noreferrer"
    >
      {children}
      <ArrowRight size={14} />
    </a>
  );
}

const wikiContents = [
  {
    title: "Care and decisions",
    entries: [
      ["Current care", "/wiki/care/index"],
      ["Decisions", "/wiki/questions/index"],
      ["Prognosis", "/wiki/prognosis/index"],
      ["Projects and next steps", "/project-management/index"],
    ],
  },
  {
    title: "Understand the science",
    entries: [
      ["Learning guides", "/wiki/education/index"],
      ["Diagnostic tests", "/wiki/diagnostics/index"],
      ["Treatments", "/wiki/treatment/index"],
      ["Research reviews", "/wiki/research/index"],
      ["Omics", "/wiki/omics/index"],
    ],
  },
  {
    title: "People, support, and records",
    entries: [
      ["Care team and referrals", "/wiki/people/medical-team"],
      ["Companies and research partners", "/wiki/companies/index"],
      ["Practical guides and support", "/wiki/logistics/index"],
      ["Papers, trials, and providers", "/catalogs/index"],
      ["Original reports and sources", "/sources/index"],
    ],
  },
];

export function WikiContentsVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className="lp-wiki-snapshot">
      <div className="lp-snapshot-title">
        <span className="lp-diana-mark">D</span>
        <div>
          <strong>Diana’s wiki</strong>
          <span>A snapshot of the real table of contents</span>
        </div>
      </div>
      <div className="lp-toc-groups">
        {wikiContents.map((group) => (
          <div className="lp-toc-group" key={group.title}>
            <strong>{group.title}</strong>
            <ul>
              {(compact ? group.entries.slice(0, 2) : group.entries).map(
                ([label, path]) => (
                  <li key={path}>
                    <a
                      href={isEducationPathname(path) ? path : `${diana}${path}`}
                      target={isEducationPathname(path) ? undefined : "_blank"}
                      rel="noopener noreferrer"
                    >
                      <FileText size={12} />
                      <span>{label}</span>
                      <ArrowRight size={11} />
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="lp-snapshot-foot">
        <BookOpen size={12} />
        <span>Care, science, and original sources. Connected.</span>
        <SourceLink path="/wiki/index">Open wiki</SourceLink>
      </div>
    </div>
  );
}

export function RedactionVisual() {
  const [redacted, setRedacted] = useState(true);
  return (
    <div className="lp-redaction-demo">
      <div className="lp-demo-toolbar">
        <span>
          <ShieldCheck size={14} />
          Inline PII redaction
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={redacted}
          aria-label="Redact example personal information"
          onClick={() => setRedacted(!redacted)}
        >
          <span className="lp-toggle-track">
            <i />
          </span>
          {redacted ? "Redacted" : "Source example"}
        </button>
      </div>
      <div className="lp-redaction-document">
        <p className="lp-demo-label">CONSULTATION NOTES</p>
        <p>
          Patient:{" "}
          <span className={redacted ? "lp-redacted" : "lp-example-value"}>
            {redacted ? "[patient name]" : "Alex Example"}
          </span>
        </p>
        <p>
          Contact:{" "}
          <span className={redacted ? "lp-redacted" : "lp-example-value"}>
            {redacted ? "[redacted email]" : "alex@example.com"}
          </span>
        </p>
        <div className="lp-redaction-divider" />
        <p>
          The next conversation will focus on the report’s evidence,
          limitations, and open questions.
        </p>
      </div>
      <p className="lp-demo-explanation">
        <LockKeyhole size={13} />
        Hide sensitive details inline. Keep the surrounding context readable.
      </p>
      <span className="lp-demo-disclaimer">
        Interactive example · fictional personal information
      </span>
    </div>
  );
}

export function CartoonVisual() {
  return (
    <figure className="lp-real-cartoon">
      <img
        src="/landing/immune-recognition.webp"
        width="1536"
        height="1024"
        alt="Diana wiki cartoon showing protein fragments displayed on HLA and recognized by a T cell"
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        <div>
          <strong>How the immune system sees a cell</strong>
          <span>From the real Oncology 101 learning guide</span>
        </div>
        <SourceLink path="/wiki/education/oncology-101/index">
          Read guide
        </SourceLink>
      </figcaption>
    </figure>
  );
}

const exampleRoles = [
  {
    name: "Care team",
    initials: "CT",
    access: [true, true, true, true],
    description:
      "Clinical records, research, learning guides, and shared updates.",
  },
  {
    name: "Research partner",
    initials: "RP",
    access: [false, true, true, false],
    description:
      "Research and learning guides, with clinical records outside this example role’s scope.",
  },
  {
    name: "Friends & family",
    initials: "FF",
    access: [false, false, true, true],
    description:
      "Learning guides and shared updates, with detailed records kept private.",
  },
];

export function PrivacyShowcase() {
  const [selected, setSelected] = useState(0);
  const role = exampleRoles[selected];
  return (
    <section
      className="lp-privacy lp-container"
      id="privacy"
      aria-labelledby="privacy-title"
    >
      <div className="lp-section-heading">
        <div>
          <p className="lp-eyebrow">SHARE WITH INTENTION</p>
          <h2 id="privacy-title">
            One village.
            <br />
            Different windows into the wiki.
          </h2>
        </div>
        <p>
          Choose which pages each role can view. Redact personal information
          within a page, so sharing useful context doesn’t require sharing every
          detail.
        </p>
      </div>
      <div className="lp-privacy-grid">
        <article className="lp-privacy-copy">
          <span className="lp-privacy-icon">
            <ShieldCheck size={24} />
          </span>
          <h3>
            Privacy at the page.
            <br />
            And within the sentence.
          </h3>
          <p>
            Assign users roles, then include or exclude pages by path or tag.
            Inline redaction and site PII patterns replace sensitive names,
            emails, or identifiers with readable fallbacks.
          </p>
          <ul>
            <li>
              <Check size={15} />
              User roles determine page visibility
            </li>
            <li>
              <Check size={15} />
              Include and exclude pages by path or tag
            </li>
            <li>
              <Check size={15} />
              Redact a detail without hiding the whole page
            </li>
            <li>
              <Check size={15} />
              Grant sensitive content access where appropriate
            </li>
          </ul>
          <span className="lp-privacy-note">
            Page permissions and PII redaction work together.
          </span>
        </article>
        <div className="lp-role-demo">
          <div className="lp-role-demo-heading">
            <Users size={18} />
            <strong>Who can see which pages?</strong>
            <span>EXAMPLE ROLES</span>
          </div>
          <div
            className="lp-role-picker"
            role="group"
            aria-label="Preview an example user role"
          >
            {exampleRoles.map((item, index) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="lp-role-person">
            <span className="lp-role-avatar">{role.initials}</span>
            <div>
              <strong>Viewing as {role.name}</strong>
              <span>Example permission configuration</span>
            </div>
          </div>
          <ul
            className="lp-permission-pages"
            aria-label={`Page visibility for ${role.name}`}
          >
            {[
              "Clinical records",
              "Research reviews",
              "Learning guides",
              "Shared updates",
            ].map((page, index) => (
              <li key={page}>
                <FileText size={16} />
                <span>{page}</span>
                <span
                  className={
                    role.access[index]
                      ? "lp-access-allowed"
                      : "lp-access-hidden"
                  }
                >
                  {role.access[index] ? (
                    <Check size={13} />
                  ) : (
                    <LockKeyhole size={12} />
                  )}{" "}
                  {role.access[index] ? "Viewable" : "Hidden"}
                </span>
              </li>
            ))}
          </ul>
          <p className="lp-role-description" aria-live="polite">
            {role.description}
          </p>
          <p className="lp-role-caption">
            Illustrative roles; each wiki defines its own access rules.
          </p>
        </div>
      </div>
    </section>
  );
}

export function SiteShowcase() {
  return (
    <section
      className="lp-site-showcase lp-container"
      id="inside"
      aria-labelledby="inside-title"
    >
      <div className="lp-section-heading">
        <div>
          <p className="lp-eyebrow">INSIDE DIANA’S WIKI</p>
          <h2 id="inside-title">
            Real pages.
            <br />A richer picture.
          </h2>
        </div>
        <p>
          These are actual views from Diana’s wiki: illustrated content, a
          diagnostics timeline, and imaging tools. The same knowledge, at your
          desk or in your pocket.
        </p>
      </div>
      <article className="lp-reader-showcase">
        <div className="lp-showcase-copy">
          <p className="lp-feature-eyebrow">THE WEB VIEWER</p>
          <h3>
            Deep reading.
            <br />
            Everywhere.
          </h3>
          <p>
            Linked pages, rich tables, cartoons, an outline, search, comments,
            and chat. Built for a care team on a laptop and a family member on a
            phone.
          </p>
          <SourceLink path="/wiki/education/reading-a-tumor/index">
            Reading a tumor report
          </SourceLink>
          <span className="lp-capture-label">
            Actual desktop and mobile screenshots
          </span>
        </div>
        <div className="lp-device-stage">
          <div className="lp-desktop-device">
            <div className="lp-device-bar">
              <i />
              <i />
              <i />
              <span>diana-tnbc.com</span>
            </div>
            <img
              src="/landing/reader-desktop.jpg"
              width="1272"
              height="846"
              loading="lazy"
              decoding="async"
              alt="Actual desktop Diana wiki reader showing the Reading a tumor report page, navigation sidebar, and illustrated biological layers"
            />
          </div>
          <div className="lp-phone-device">
            <span className="lp-phone-speaker" />
            <img
              src="/landing/reader-mobile.jpg"
              width="393"
              height="852"
              loading="lazy"
              decoding="async"
              alt="Actual mobile Diana wiki reader with the same illustrated tumor-report guide and mobile navigation"
            />
          </div>
        </div>
      </article>
      <div className="lp-diagnostics-gallery">
        <article className="lp-site-card">
          <div className="lp-site-card-copy">
            <p className="lp-feature-eyebrow">DIAGNOSTICS OVER TIME</p>
            <h3>A timeline you can return to.</h3>
            <p>
              See measurements across dates, keep assays and units in context,
              and trace a result back to its source.
            </p>
            <SourceLink path="/diagnostics">
              Open diagnostics timeline
            </SourceLink>
          </div>
          <a
            className="lp-screenshot-link"
            href={`${diana}/diagnostics`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the actual Diana diagnostics timeline"
          >
            <img
              src="/landing/diagnostics-timeline.jpg"
              width="1272"
              height="846"
              loading="lazy"
              decoding="async"
              alt="Actual Diana diagnostics timeline displaying dated measurements and diagnostic tracks"
            />
          </a>
          <span className="lp-capture-label">Actual diagnostics view</span>
        </article>
        <article className="lp-site-card">
          <div className="lp-site-card-copy">
            <p className="lp-feature-eyebrow">RADIOLOGY & PATHOLOGY</p>
            <h3>Go beyond the written report.</h3>
            <p>
              Open DICOM studies, navigate imaging series, and compare scans.
              Dedicated pathology viewers bring tissue images into the same
              workspace.
            </p>
            <SourceLink path="/diagnostics/imaging">
              Explore imaging studies
            </SourceLink>
          </div>
          <a
            className="lp-screenshot-link"
            href={`${diana}/diagnostics/imaging`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open Diana imaging studies"
          >
            <img
              src="/landing/dicom-viewer.jpg"
              width="1272"
              height="846"
              loading="lazy"
              decoding="async"
              alt="Actual Diana DICOM viewer displaying a breast MRI, series navigator, and imaging controls"
            />
          </a>
          <span className="lp-capture-label">
            Actual DICOM viewer · breast MRI
          </span>
        </article>
      </div>
      <div className="lp-learning-gallery">
        <div className="lp-learning-intro">
          <p className="lp-eyebrow">LEARN WITH THE WIKI</p>
          <h3>
            A cartoon can open
            <br />a whole new conversation.
          </h3>
          <p>
            Open to everyone, without a password. Follow a course, look up a
            concept, and learn through illustrated explanations.
          </p>
          <SourceLink path="/wiki/education/index">
            Browse the curriculum
          </SourceLink>
        </div>
        <figure>
          <img
            src="/landing/tumor-biology-layers.webp"
            width="1536"
            height="1024"
            loading="lazy"
            decoding="async"
            alt="Real wiki illustration of morphology, genomics, transcriptomics, proteomics, and spatial biology"
          />
          <figcaption>
            <SourceLink path="/wiki/education/reading-a-tumor/index">
              Reading a tumor report
            </SourceLink>
            <span>Follow what each biological layer measures.</span>
          </figcaption>
        </figure>
        <figure>
          <img
            src="/landing/cell-therapy-family.webp"
            width="1536"
            height="1024"
            loading="lazy"
            decoding="async"
            alt="Real wiki cartoon comparing peptide-HLA, surface-antigen, and innate-like cell therapy families"
          />
          <figcaption>
            <SourceLink path="/wiki/education/cellular-therapies/index">
              Cellular therapies
            </SourceLink>
            <span>Meet the different families of immune cells.</span>
          </figcaption>
        </figure>
      </div>
      <p className="lp-snapshot-note">
        Selected content and site screenshots captured October 1, 2026. Source
        links open Diana’s wiki; its access rules still apply.
      </p>
    </section>
  );
}
