import { useState, type ImgHTMLAttributes, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useResolvedWikiTheme } from "../PublicThemeControl";
import { DianaMark } from "./LandingBrands";
import { requestSignIn, signInHref } from "./landing-sign-in";

type ThemedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** Public path without the `-light`/`-dark` suffix, e.g. `/landing/reader-desktop`. */
  base: string;
  extension: "jpg" | "webp";
};

/** Load only the variant that matches the theme the visitor sees. */
export function ThemedImage({ base, extension, ...props }: ThemedImageProps) {
  const theme = useResolvedWikiTheme();
  return <img {...props} src={`${base}-${theme}.${extension}`} />;
}

/**
 * Private pages send signed-out visitors back here, so these links move to the
 * password form and continue to the page after sign-in.
 */
export function PrivateLink({
  path,
  label,
  className,
  children,
}: {
  path: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={signInHref(path)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        requestSignIn(path, label);
      }}
    >
      {children}
    </a>
  );
}

export function ProductShots() {
  return (
    <div className="lp-product-shots">
      <figure className="lp-browser">
        <div className="lp-browser-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>diana-tnbc.com</span>
        </div>
        <ThemedImage
          base="/landing/reader-desktop"
          extension="jpg"
          width="1800"
          height="1197"
          fetchPriority="high"
          alt="Diana’s knowledge base on a laptop, open to the Reading a tumor report guide with the page list beside it"
        />
      </figure>
      <figure className="lp-phone">
        <ThemedImage
          base="/landing/reader-mobile"
          extension="jpg"
          width="600"
          height="1301"
          alt="The same guide on a phone"
        />
      </figure>
    </div>
  );
}

const contents = [
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
      ["Educational content", "/education"],
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
] as const;

export function KnowledgeBaseContents() {
  return (
    <div className="lp-contents">
      <div className="lp-contents-title">
        <DianaMark />
        <div>
          <strong>Diana TNBC</strong>
          <span>Table of contents</span>
        </div>
      </div>
      <div className="lp-contents-groups">
        {contents.map((group) => (
          <div className="lp-contents-group" key={group.title}>
            <h4>{group.title}</h4>
            <ul>
              {group.entries.map(([label, path]) => (
                <li key={path}>
                  {path === "/education" ? (
                    <a href={path}>
                      <FileText size={14} />
                      <span>{label}</span>
                      <ArrowRight size={13} />
                    </a>
                  ) : (
                    <PrivateLink path={path} label={label}>
                      <FileText size={14} />
                      <span>{label}</span>
                      <LockKeyhole
                        size={13}
                        aria-label="Sign in required"
                        role="img"
                      />
                    </PrivateLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RedactionDemo() {
  const [redacted, setRedacted] = useState(true);
  return (
    <div className="lp-demo lp-redaction-demo">
      <div className="lp-demo-heading">
        <ShieldCheck size={18} />
        <strong>Hide personal details</strong>
        <button
          type="button"
          role="switch"
          aria-checked={redacted}
          aria-label="Redact example personal information"
          onClick={() => setRedacted(!redacted)}
        >
          <span className="lp-toggle-track" aria-hidden="true">
            <i />
          </span>
          {redacted ? "Redacted" : "Original"}
        </button>
      </div>
      <div className="lp-redaction-document">
        <p className="lp-document-label">Consultation notes</p>
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
        <hr />
        <p>
          For the next call: review the report and make a list of questions for
          the care team.
        </p>
      </div>
      <p className="lp-demo-note">
        Names and contact details are hidden. The rest of the note stays
        readable.
      </p>
    </div>
  );
}

const exampleRoles = [
  {
    name: "Care team",
    initials: "CT",
    access: [true, true, true, true],
    description:
      "Clinical records, research, educational content, and shared updates.",
  },
  {
    name: "Research partner",
    initials: "RP",
    access: [false, true, true, false],
    description:
      "Research and educational content. Clinical records stay hidden.",
  },
  {
    name: "Friends & family",
    initials: "FF",
    access: [false, false, true, true],
    description:
      "Educational content and shared updates. Detailed records stay private.",
  },
];
const examplePages = [
  "Clinical records",
  "Research reviews",
  "Educational content",
  "Shared updates",
];

export function RoleDemo() {
  const [selected, setSelected] = useState(0);
  const role = exampleRoles[selected]!;
  return (
    <div className="lp-demo lp-role-demo">
      <div className="lp-demo-heading">
        <Users size={18} />
        <strong>Who can see which pages?</strong>
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
        <span className="lp-role-avatar" aria-hidden="true">
          {role.initials}
        </span>
        <strong>Viewing as {role.name}</strong>
      </div>
      <ul
        className="lp-permission-pages"
        aria-label={`Page visibility for ${role.name}`}
      >
        {examplePages.map((page, index) => (
          <li key={page}>
            <FileText size={16} />
            <span>{page}</span>
            <span
              className={
                role.access[index] ? "lp-access-allowed" : "lp-access-hidden"
              }
            >
              {role.access[index] ? (
                <Check size={14} />
              ) : (
                <LockKeyhole size={13} />
              )}{" "}
              {role.access[index] ? "Viewable" : "Hidden"}
            </span>
          </li>
        ))}
      </ul>
      <p className="lp-demo-note" aria-live="polite">
        {role.description}
      </p>
    </div>
  );
}

export function GuideFigure({
  base,
  alt,
  title,
  path,
  description,
}: {
  base: string;
  alt: string;
  title: string;
  path: string;
  description: string;
}) {
  return (
    <figure className="lp-guide">
      <ThemedImage
        base={base}
        extension="webp"
        width="1536"
        height="1024"
        loading="lazy"
        decoding="async"
        alt={alt}
      />
      <figcaption>
        <a href={path}>
          {title} <ArrowRight size={15} />
        </a>
        <span>{description}</span>
      </figcaption>
    </figure>
  );
}
