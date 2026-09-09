import { createElement } from "react";
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
  MessageSquare,
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
import type { WikiNavigationNode } from "@oncobase/wiki-shell";
const ICON_SIZE = 16;
const SECTION_ICONS: Record<string, LucideIcon> = {
  about: Info,
  "project-management": ListTodo,
  sources: BookOpen,
  wiki: BookOpen,
  overview: Activity,
  "echo-immune": Activity,
  emails: Mail,
  institutions: Building2,
  insurance: ShieldCheck,
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
  return slug.split("/").filter(Boolean).at(-1) ?? slug;
}
export function nodeIcon({
  active,
  node,
  open,
}: {
  active: boolean;
  depth: number;
  node: WikiNavigationNode;
  open?: boolean;
}) {
  const Icon =
    node.type === "directory"
      ? (SECTION_ICONS[lastPathSegment(node.slug)] ??
        (open ? FolderOpen : Folder))
      : (FILE_ICONS_BY_SLUG[node.slug] ?? FILE_ICONS[node.name] ?? FileText);
  return createElement(Icon, {
    size: ICON_SIZE,
    className: active ? "wiki-shell-tree-icon active" : "wiki-shell-tree-icon",
    "aria-hidden": true,
  });
}

export function MobileChatIcon() {
  return createElement("svg", { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    createElement("path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" }),
    createElement("path", { d: "M9 10h6M9 14h4" }));
}
