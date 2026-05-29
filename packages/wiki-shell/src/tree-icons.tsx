import {
  Activity,
  Archive,
  Beaker,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CircleCheckBig,
  ClipboardCheck,
  Crosshair,
  Dna,
  FileText,
  Flame,
  Folder,
  FolderOpen,
  GraduationCap,
  HelpCircle,
  Inbox,
  Info,
  Landmark,
  ListChecks,
  ListTodo,
  Mail,
  Microscope,
  NotebookPen,
  Package,
  Pill,
  ScrollText,
  ShieldCheck,
  Syringe,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

// Semantic file-tree icons for the Diana wiki, shared by both readers so the
// sidebar renders identical icons. Folder keys are the final path segment so
// the same icon applies at any depth (e.g. "research" matches /research and
// /wiki/research). Anything unmapped falls back to a generic folder/file icon.
const SECTION_ICONS: Record<string, LucideIcon> = {
  about: Info,
  "project-management": ListTodo,
  sources: BookOpen,
  wiki: BookOpen,
  overview: Activity,
  "claudes-research": Beaker,
  "echo-immune": Activity,
  emails: Mail,
  institutions: Building2,
  insurance: ShieldCheck,
  kernis: Users,
  "meeting-notes": NotebookPen,
  "research-analyses": Beaker,
  "research-articles": BookOpen,
  "test-results": Microscope,
  archived: Archive,
  companies: Briefcase,
  diagnostics: ClipboardCheck,
  education: GraduationCap,
  logistics: Package,
  people: Users,
  prognosis: TrendingUp,
  questions: HelpCircle,
  research: Beaker,
  strategy: Target,
  summary: ScrollText,
  treatment: Pill,
  updates: Calendar,
  "designing-a-vaccine": Syringe,
  "molecular-profiling": Dna,
  "oncology-101": Landmark,
  "reading-a-tumor": Microscope,
  "targeted-therapy-modalities": Crosshair,
};

const FILE_ICONS: Record<string, LucideIcon> = {
  "1-inbox": Inbox,
  "2-urgent": Flame,
  "3-completed": CircleCheckBig,
  "4-backlog": ListChecks,
};

const FILE_ICONS_BY_SLUG: Record<string, LucideIcon> = {
  "about/About": Info,
  "about/Index": Info,
  "about/Journal": NotebookPen,
  "about/Log": ScrollText,
  "about/Terminology": BookOpen,
  "about/overview/index": Activity,
  "about/overview/active-workstreams": ListChecks,
  "about/overview/current-status": ClipboardCheck,
  "about/overview/for-experts": GraduationCap,
  "about/overview/for-friends-and-family": Users,
  "about/overview/for-peers": Users,
  "about/overview/key-context": Target,
  "about/overview/test-tracker": Microscope,
};

function lastPathSegment(slug: string) {
  const index = slug.lastIndexOf("/");
  return index === -1 ? slug : slug.slice(index + 1);
}

/** Folder icon for a directory node (semantic, falling back to a folder glyph). */
export function getWikiDirectoryIcon(slug: string, open: boolean): LucideIcon {
  return SECTION_ICONS[lastPathSegment(slug)] ?? (open ? FolderOpen : Folder);
}

/** File icon for a leaf node (by slug, then by name, then a generic doc). */
export function getWikiFileIcon(slug: string, name: string): LucideIcon {
  return FILE_ICONS_BY_SLUG[slug] ?? FILE_ICONS[name] ?? FileText;
}
