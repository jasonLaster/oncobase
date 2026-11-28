import type { SiteBrand } from "../../site-host";
import { SINGLE_CELL_OWNER_SLUG } from "../single-cell/data";

export type ToolAudience = "everyone" | "clinicians" | "labs";
export type ToolStatus = "current" | "archival";

/**
 * Who can open a tool. "site" tools open for anyone past the site's password
 * gate (every reader route). "page" tools show data owned by a sensitive page,
 * which the reader lists only for roles allowed to read it (the same rule
 * `/api/file` applies to the data); without it the card is locked (or hidden,
 * with `hideWhenLocked`).
 */
export type ToolAccess = { kind: "site" } | { kind: "page"; slug: string; requirement: string };

export type ToolEntry = {
  id: string;
  title: string;
  href: string;
  audience: ToolAudience[];
  status: ToolStatus;
  /** What the tool shows, in a sentence. */
  shows: string;
  /** The question it answers. */
  question: string;
  /** Help the tool is asking for, if any. */
  help?: string;
  access: ToolAccess;
  hideWhenLocked?: boolean;
};

export const AUDIENCE_LABELS: Record<ToolAudience, string> = {
  everyone: "For everyone",
  clinicians: "For clinicians",
  labs: "For labs and researchers",
};

export const STATUS_LABELS: Record<ToolStatus, { title: string; description: string }> = {
  current: { title: "Current", description: "Tools in use for decisions being made now." },
  archival: { title: "Archival", description: "Earlier samples and questions, kept for reference and for planning that still draws on them." },
};

const SITE: ToolAccess = { kind: "site" };

/** Diana's tools. One entry per app route; the page renders only from this list. */
export const DIANA_TOOLS: ToolEntry[] = [
  {
    id: "timeline",
    title: "Diagnostics timeline",
    href: "/diagnostics",
    audience: ["everyone"],
    status: "current",
    shows: "Every scan, biopsy, ctDNA test and blood count on one timeline, with links to each report.",
    question: "What has been tested, when, and what changed between tests?",
    access: SITE,
  },
  {
    id: "imaging",
    title: "Imaging studies",
    href: "/diagnostics/imaging",
    audience: ["everyone", "clinicians"],
    status: "current",
    shows: "Each imaging study with its report, images, comparisons and download.",
    question: "Which scans exist, and where are the report and images for each?",
    access: SITE,
  },
  {
    id: "dicom-viewer",
    title: "DICOM viewer",
    href: "/tools/dicom-viewer",
    audience: ["clinicians"],
    status: "current",
    shows: "The original CT, MRI, PET/CT and ultrasound images, with window/level, a calibrated ruler and saved annotations.",
    question: "What do the images themselves show, beyond the written report?",
    help: "Second reads and annotations from radiologists.",
    access: SITE,
  },
  {
    id: "dicom-compare",
    title: "Scan comparison",
    href: "/tools/dicom-compare",
    audience: ["clinicians"],
    status: "current",
    shows: "Two studies side by side in synced viewports, with subtraction and slice-matched presets.",
    question: "How has the tumor changed from one scan to the next?",
    access: SITE,
  },
  {
    id: "pathology-viewer",
    title: "Pathology slide viewer",
    href: "/tools/pathology-viewer",
    audience: ["clinicians", "labs"],
    status: "current",
    shows: "Whole-slide tissue images with a navigator, magnification, scale bar, rulers and saved region notes.",
    question: "What does the tissue look like under the microscope?",
    help: "Pathologist notes on regions of interest.",
    access: SITE,
  },
  {
    id: "cellularity",
    title: "Tumor-bed cellularity in 3D",
    href: "/diagnostics/cellularity",
    audience: ["clinicians", "labs"],
    status: "current",
    shows: "The surgical specimen's keratin-stained blocks rebuilt in 3D, with field-level cellularity and a residual cancer burden calculator.",
    question: "How much cancer was left after chemotherapy, and where in the tumor bed?",
    help: "Pathologist review of the cellularity estimate.",
    access: SITE,
  },
  {
    id: "single-cell",
    title: "Single-cell viewer",
    href: "/tools/single-cell",
    audience: ["labs"],
    status: "archival",
    shows: "A map of tens of thousands of biopsy nuclei from single-nucleus RNA sequencing, colored by cell type, tumor call or the RNA of drug and vaccine target genes.",
    question: "Which cells make the RNA for a target such as TROP-2, HER3 or NY-BR-1, and how reliably can this sample tell?",
    help: "Lab and computational review of target and cell-type calls.",
    access: { kind: "page", slug: SINGLE_CELL_OWNER_SLUG, requirement: "Private genomic data: needs access to Diana's private diagnostics." },
  },
  {
    id: "medical-deduction",
    title: "Medical deduction calculator",
    href: "/tools/medical-deduction",
    audience: ["everyone"],
    status: "current",
    shows: "An estimate of the tax value of medical expenses, including spreading costs across years.",
    question: "How much of the medical spending is deductible, and in which tax year should it fall?",
    access: SITE,
  },
  {
    id: "chat",
    title: "Ask the wiki",
    href: "/chat",
    audience: ["everyone"],
    status: "current",
    shows: "Plain-language answers to questions, citing the wiki pages they come from.",
    question: "What does the wiki say about a question, and where?",
    access: SITE,
  },
];

/** Tool lists by site brand name. Hosted wikis (e.g. kevin.oncobase.io) add theirs here. */
export const TOOLS_BY_SITE: Record<string, ToolEntry[]> = {
  Diana: DIANA_TOOLS,
};

export function toolsForBrand(brand: Pick<SiteBrand, "name">): ToolEntry[] {
  return TOOLS_BY_SITE[brand.name] ?? [];
}

export type ToolAvailability = "open" | "locked" | "checking";

export function toolAvailability(tool: ToolEntry, readablePages: ReadonlySet<string>, identityPending: boolean): ToolAvailability {
  if (tool.access.kind === "site") return "open";
  if (readablePages.has(tool.access.slug)) return "open";
  return identityPending ? "checking" : "locked";
}

/** Tools grouped by status (current first), each group in config order, with locked tools hidden when asked. */
export function groupTools(tools: ToolEntry[], availability: (tool: ToolEntry) => ToolAvailability) {
  const order: ToolStatus[] = ["current", "archival"];
  return order
    .map((status) => ({
      status,
      tools: tools
        .filter((tool) => tool.status === status)
        .map((tool) => ({ tool, availability: availability(tool) }))
        .filter(({ tool, availability: state }) => !(tool.hideWhenLocked && state === "locked")),
    }))
    .filter((group) => group.tools.length > 0);
}
