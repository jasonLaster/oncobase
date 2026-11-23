import { Switch, SwitchThumb } from "@oncobase/ui/switch";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";
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
import { images } from "../assets/images";
import type { ResponsiveImageSet } from "../assets/images/types";
import { DianaMark } from "./LandingBrands";
import { signInHref } from "./sign-in";

type ThemedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** Public path without the `-light`/`-dark` suffix, e.g. `/landing/reader-desktop`. */
  base: string;
  extension: "jpg" | "webp";
  /** Required: describe the image, or "" when it is decorative. */
  alt: string;
};

/** Load only the variant that matches the theme the visitor sees. */
export function ThemedImage({ base, extension, alt, ...props }: ThemedImageProps) {
  const theme = useResolvedWikiTheme();
  return <img {...props} alt={alt} src={`${base}-${theme}.${extension}`} />;
}

type ResponsiveImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "sizes" | "width" | "height"
> & {
  /** A generated set from `src/assets/images` (see scripts/optimize-images.ts). */
  image: ResponsiveImageSet;
  /** How wide the image is displayed; picks the variant from the AVIF/WebP `srcset`. */
  sizes: string;
  /** Required: describe the image, or "" when it is decorative. */
  alt: string;
};

/**
 * A fingerprinted AVIF/WebP image, in only the variant that matches the theme the visitor sees.
 * The `<picture>` takes no part in layout, so existing `img` styles apply unchanged.
 */
export function ResponsiveImage({ image, sizes, alt, ...props }: ResponsiveImageProps) {
  const theme = useResolvedWikiTheme();
  const variant = (theme === "dark" && image.dark) || image.light;
  // Remount on a theme change so every browser re-selects from the new sources.
  return (
    <picture key={theme} style={{ display: "contents" }}>
      <source type="image/avif" srcSet={variant.avif} sizes={sizes} />
      <source type="image/webp" srcSet={variant.webp} sizes={sizes} />
      <img {...props} alt={alt} src={variant.fallback} width={image.width} height={image.height} />
    </picture>
  );
}

/**
 * Private pages send signed-out visitors back to the landing page, so these
 * links ask for the password first and then continue to the page.
 */
export function PrivateLink({
  path,
  className,
  children,
}: {
  path: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={signInHref(path)}>
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
        {/* The landing page's LCP element at phone and desktop widths. */}
        <ResponsiveImage
          image={images["reader-desktop"]}
          sizes="(max-width: 1080px) 88vw, 940px"
          fetchPriority="high"
          decoding="async"
          alt="Diana’s knowledge base on a laptop, open to the Reading a tumor report guide with the page list beside it"
        />
      </figure>
      <figure className="lp-phone">
        <ResponsiveImage
          image={images["reader-mobile"]}
          sizes="(max-width: 700px) 28vw, 210px"
          decoding="async"
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
      ["Diagnostic tests", "/wiki/diagnostics/index"],
      ["Treatments", "/wiki/treatment/index"],
      ["Prognosis", "/wiki/prognosis/index"],
      ["Projects and next steps", "/project-management/index"],
    ],
  },
  {
    // Open to everyone: these link to published education guides.
    title: "Understand the science",
    entries: [
      ["Designing a vaccine", "/education/designing-a-vaccine/index"],
      ["Targeted therapies", "/education/targeted-therapy-modalities/index"],
      ["Cellular therapies", "/education/cellular-therapies/index"],
      ["Reading a tumor report", "/education/reading-a-tumor/index"],
      ["Modeling tumor response", "/education/modeling-tumor-response/index"],
      ["All educational content", "/education"],
    ],
  },
  {
    title: "People, research, and records",
    entries: [
      ["Care team and referrals", "/wiki/people/medical-team"],
      ["Companies and research partners", "/wiki/companies/index"],
      ["Research reviews and omics", "/wiki/research/index"],
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
                  {path.startsWith("/education") ? (
                    <a href={path}>
                      <FileText size={14} />
                      <span>{label}</span>
                      <ArrowRight size={13} />
                    </a>
                  ) : (
                    <PrivateLink path={path}>
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
        <Switch
          aria-label="Redact example personal information"
          checked={redacted}
          onCheckedChange={setRedacted}
        >
          <span className="lp-toggle-track" aria-hidden="true">
            <SwitchThumb render={<i />} />
          </span>
          {redacted ? "Redacted" : "Original"}
        </Switch>
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
      <ToggleGroup
        className="lp-role-picker"
        aria-label="Preview an example user role"
        deselectable={false}
        value={[role.name]}
        onValueChange={(next) => {
          const index = exampleRoles.findIndex((item) => item.name === next[0]);
          if (index >= 0) setSelected(index);
        }}
      >
        {exampleRoles.map((item) => (
          <Toggle key={item.name} value={item.name}>
            {item.name}
          </Toggle>
        ))}
      </ToggleGroup>
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

/** Phones scroll one card at 82% of the width; wider screens show two lead cards, then three. */
const GUIDE_SIZES = {
  lead: "(max-width: 700px) 82vw, (max-width: 1200px) 47vw, 546px",
  rest: "(max-width: 700px) 82vw, (max-width: 1200px) 31vw, 355px",
};

export function GuideFigure({
  image,
  lead,
  alt,
  title,
  path,
  description,
}: {
  image: ResponsiveImageSet;
  lead: boolean;
  alt: string;
  title: string;
  path: string;
  description: string;
}) {
  return (
    <figure className="lp-guide">
      <ResponsiveImage
        image={image}
        sizes={lead ? GUIDE_SIZES.lead : GUIDE_SIZES.rest}
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
