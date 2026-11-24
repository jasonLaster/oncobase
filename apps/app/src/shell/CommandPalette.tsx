import { readerQuery, useInitialReaderData, useReaderQuery, useReaderStoreKit, EMPTY_READER_ROWS } from "../bootstrap/reader-queries";
import {
  BugIcon,
  CalculatorIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ListIcon,
  MessageCircleIcon,
  MonitorIcon,
  MoonIcon,
  PaperclipIcon,
  PowerIcon,
  PowerOffIcon,
  RotateCcwIcon,
  SearchIcon,
  SunIcon,
  TagIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@oncobase/ui/alert-dialog";
import { Command, CommandGroup, CommandInput } from "@oncobase/ui/command";
import { Dialog, DialogClose } from "@oncobase/ui/dialog";
import { useLocation, useNavigate } from "react-router";
// Subpaths, not the package index: a module the index re-exports is evaluated
// with the index, which the paint-critical shell imports, so palette-only code
// imported through the index would download before the article paints.
import {
  WikiCommandBackdrop,
  WikiCommandEmpty,
  WikiCommandFooter,
  WikiCommandGroupHeading,
  WikiCommandItem,
  WikiCommandList,
  WikiCommandPanel,
  WikiCommandSearch,
} from "@oncobase/wiki-shell/palette";
import {
  getWikiThemePreference,
  setWikiThemePreference,
  subscribeWikiSystemTheme,
  subscribeWikiThemePreference,
} from "@oncobase/wiki-shell/theme";
import {
  buildWikiFilePaletteState,
  WikiFilePalette,
  type WikiFilePalettePage,
  type WikiFilePalettePick,
} from "@oncobase/wiki-shell/file-palette";
import { flattenFileTree, isListedManifestAsset } from "@oncobase/wiki-content";
import { bootstrappedNavigation } from "../bootstrap/seed-state";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { readLiveStoreDevtoolsEnabled, reloadWithLiveStoreDevtools } from "../livestore/devtools";
import { emit } from "../reader-bus";
import type { AssetIndexRow, PageIndexRow } from "../types";
import { useWikiScope } from "../wiki-context";
import {
  backendHref,
  hrefForSlug,
  parseJsonArray,
  readRecentSlugs,
  rememberSlug,
  returnToHref,
  slugFromPath,
} from "../wiki-utils";
import { assetFileName, assetHref, relatedAssetsForSlug } from "../wiki-assets";
import { setNavigationIntentForSlug } from "./navigation-intent";
import { collectOutline, scrollToOutlineItem, type OutlineItem } from "./outline";
import { webMcpAvailable } from "../webmcp/webmcp-flag";
import { paletteJevEnabled, setPaletteJevEnabled } from "./palette-jev-flag";
import { fetchRecommendedSlugs, recommendCandidates, recordPalettePick } from "./palette-recommend";
import { paletteBoost } from "./palette-boost";
import { agentsMayReadPrivatePages, setAgentsMayReadPrivatePages } from "../webmcp/agent-access";

export type PaletteMode = "pages" | "outline" | "assets" | "tags" | "actions" | "debug";

type ActionItem = {
  label: string;
  description: string;
  href?: string;
  icon: ReactNode;
  run?: () => void;
  group: "Theme" | "Navigate" | "Source" | "Search" | "Downloads" | "AI agents" | "Tools";
};

type DebugItem = {
  label: string;
  description: string;
  icon: ReactNode;
  run: () => void;
};

type TagResult = {
  tag: string;
  count: number;
};

function commandLabel() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

export function CommandPalette({
  open,
  initialMode = "pages",
  onOpenChange,
}: {
  open: boolean;
  initialMode?: PaletteMode;
  onOpenChange: (open: boolean) => void;
}) {
  const kit = useReaderStoreKit();
  const store = kit?.store;
  const initial = useInitialReaderData();
  const pages = useReaderQuery(readerQuery.pageIndex, initial?.pages ?? EMPTY_READER_ROWS) as PageIndexRow[];
  const manifestTree = useReaderQuery(readerQuery.fileTree, null);
  // A validated public tree is usable before sync; even an empty authoritative
  // manifest supersedes it. The fallback is scoped to this exact store.
  const initialTree = manifestTree ? undefined : (store ? bootstrappedNavigation.get(store) : initial?.tree);
  const assetRows = useReaderQuery(readerQuery.assets, EMPTY_READER_ROWS) as AssetIndexRow[];
  // Image rows exist only for content-addressed URLs; the palette lists PDFs.
  const assets = useMemo(() => assetRows.filter(isListedManifestAsset), [assetRows]);
  const scope = useWikiScope();
  const [mode, setPaletteMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [pageInitialQuery, setPageInitialQuery] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>(() => collectOutline());
  const [recentSlugs] = useState<string[]>(() => readRecentSlugs());
  const [liveStoreDevtoolsEnabled] = useState(() => readLiveStoreDevtoolsEnabled());
  const navigate = useNavigate();
  const location = useLocation();
  const currentSlug = slugFromPath(location.pathname);
  const returnTo = returnToHref(location.pathname, location.search, location.hash);
  const themePreference = useSyncExternalStore(subscribeWikiThemePreference, getWikiThemePreference, () => null);
  const systemDark = useSyncExternalStore(subscribeWikiSystemTheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches, () => false);
  const isDark = themePreference === "dark" || (themePreference === null && systemDark);

  const setMode = setPaletteMode;

  const filePalettePages = useMemo<WikiFilePalettePage[]>(
    () => {
      const titles = new Map(pages.map(page => [page.slug, page.title]));
      return (initialTree
        ? [...new Map(flattenFileTree(initialTree).filter(node => node.type === "file").map(node => [node.slug, node])).values()]
        : pages).map((page) => {
        const segments = page.slug.split("/");
        return {
          name: formatFileLabel(segments.at(-1) ?? page.slug),
          title: titles.get(page.slug),
          path: segments.join(" / "),
          slug: page.slug,
          boost: paletteBoost(page.slug),
        };
      });
    },
    [pages, initialTree],
  );

  const [jevEnabled, setJevEnabled] = useState(paletteJevEnabled);
  const recommendPages = useCallback(async (search: string, signal: AbortSignal) => {
    const fuzzy = buildWikiFilePaletteState(filePalettePages, search).searchResults ?? [];
    const candidates = recommendCandidates(pages, search, fuzzy.map(page => page.slug));
    return candidates.length ? fetchRecommendedSlugs(search, candidates, scope, signal) : [];
  }, [filePalettePages, pages, scope]);
  const recordPick = useCallback((pick: WikiFilePalettePick) => recordPalettePick(pick, scope), [scope]);

  const outlineResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return outline.slice(0, 14);
    return outline
      .filter((item) => item.text.toLowerCase().includes(normalized))
      .slice(0, 14);
  }, [outline, query]);

  const relatedAssets = useMemo(
    () => relatedAssetsForSlug(currentSlug, assets).slice(0, 3),
    [assets, currentSlug],
  );

  const [agentPrivateAccess, setAgentPrivateAccess] = useState(agentsMayReadPrivatePages);
  const agentToolsAvailable = useMemo(webMcpAvailable, []);
  const currentPageTitle = useMemo(
    () => pages.find((page) => page.slug === currentSlug)?.title,
    [currentSlug, pages],
  );

  const actions = useMemo<ActionItem[]>(
    () => [
      {
        group: "Theme",
        label: `Switch to ${isDark ? "Light" : "Dark"} theme`,
        description: "Use an explicit appearance preference",
        icon: isDark ? <SunIcon size={15} aria-hidden="true" /> : <MoonIcon size={15} aria-hidden="true" />,
        run: () => {
          setWikiThemePreference(isDark ? "light" : "dark");
          onOpenChange(false);
        },
      },
      {
        group: "Theme",
        label: "Use system theme",
        description: "Follow the device appearance preference",
        icon: <MonitorIcon size={15} aria-hidden="true" />,
        run: () => {
          setWikiThemePreference(null);
          onOpenChange(false);
        },
      },
      {
        group: "Navigate",
        label: "Find files",
        description: "Open the fuzzy local file palette",
        icon: <FileTextIcon size={15} aria-hidden="true" />,
        run: () => {
          setPageInitialQuery("");
          setQuery("");
          setMode("pages");
        },
      },
      {
        group: "Navigate",
        label: "Open outline",
        description: "Jump to headings on the current page",
        icon: <ListIcon size={15} aria-hidden="true" />,
        run: () => {
          setQuery("");
          setOutline(collectOutline());
          setMode("outline");
        },
      },
      {
        group: "Navigate",
        label: "Browse source PDFs",
        description: "Find source PDFs from the local manifest",
        icon: <PaperclipIcon size={15} aria-hidden="true" />,
        run: () => {
          setQuery("");
          setMode("assets");
        },
      },
      {
        group: "Navigate",
        label: "Browse tags",
        description: "Filter the local page index by tag",
        icon: <TagIcon size={15} aria-hidden="true" />,
        run: () => {
          setQuery("");
          setMode("tags");
        },
      },
      ...relatedAssets.map<ActionItem>((asset) => ({
        group: "Source",
        label: `Open ${assetFileName(asset.path)}`,
        description: `Source file for ${currentSlug}`,
        href: assetHref(asset.path),
        icon:
          asset.kind === "pdf" ? (
            <FileTextIcon size={15} aria-hidden="true" />
          ) : (
            <FileIcon size={15} aria-hidden="true" />
          ),
      })),
      {
        group: "Search",
        label: "Search wiki",
        description: "Open the backend full-text and AI search surface",
        href: backendHref("/search", { returnTo }),
        icon: <SearchIcon size={15} aria-hidden="true" />,
      },
      ...(currentPageTitle ? [{
        group: "Search",
        label: "Ask about this page",
        description: `Start a chat about ${currentPageTitle}`,
        href: backendHref("/chat", { q: `Summarize the key points of the page "${currentPageTitle}" (${currentSlug}).` }),
        icon: <MessageCircleIcon size={15} aria-hidden="true" />,
      } satisfies ActionItem] : []),
      {
        group: "Search",
        label: "New chat",
        description: "Continue in the full-stack chat experience",
        href: backendHref("/chat", { returnTo }),
        icon: <MessageCircleIcon size={15} aria-hidden="true" />,
      },
      {
        group: "Downloads",
        label: "Download full wiki",
        description: "Download PDFs and markdown as a zip archive",
        href: backendHref("/api/download", { type: "full", scope }),
        icon: <DownloadIcon size={15} aria-hidden="true" />,
      },
      {
        group: "Downloads",
        label: "Download markdown archive",
        description: "Download the current scoped markdown as a zip archive",
        href: backendHref("/api/download", { type: "markdown", scope }),
        icon: <DownloadIcon size={15} aria-hidden="true" />,
      },
      {
        group: "Tools",
        label: "Medical deduction calculator",
        description: "Estimate medical expense deduction timing and tax benefit",
        href: "/tools/medical-deduction",
        icon: <CalculatorIcon size={15} aria-hidden="true" />,
      },
      ...(agentToolsAvailable && scope === "session" ? [{
        group: "AI agents",
        label: agentPrivateAccess ? "Stop AI agents reading private pages" : "Allow AI agents to read private pages",
        description: agentPrivateAccess
          ? "Browser AI agents currently receive private page content on this device"
          : "Browser AI agents see private page titles only, until you allow it on this device",
        icon: agentPrivateAccess ? <PowerOffIcon size={15} aria-hidden="true" /> : <PowerIcon size={15} aria-hidden="true" />,
        run: () => {
          setAgentsMayReadPrivatePages(!agentPrivateAccess);
          setAgentPrivateAccess(!agentPrivateAccess);
          onOpenChange(false);
        },
      } satisfies ActionItem] : []),
      {
        group: "Search",
        label: jevEnabled ? "Stop recommending pages with Jev" : "Recommend pages with Jev",
        description: jevEnabled
          ? "Find files shows fuzzy matches only"
          : "Find files asks Jev which pages fit the query and lists them first",
        icon: jevEnabled ? <PowerOffIcon size={15} aria-hidden="true" /> : <ZapIcon size={15} aria-hidden="true" />,
        run: () => {
          setPaletteJevEnabled(!jevEnabled);
          setJevEnabled(!jevEnabled);
          setPageInitialQuery("");
          setQuery("");
          setMode("pages");
        },
      },
      {
        group: "Tools",
        label: "Local cache tools",
        description: "Warm, reset, or toggle the optional LiveStore inspector",
        icon: <BugIcon size={15} aria-hidden="true" />,
        run: () => {
          setQuery("");
          setMode("debug");
        },
      },
    ],
    [agentPrivateAccess, agentToolsAvailable, jevEnabled, currentPageTitle, currentSlug, isDark, onOpenChange, relatedAssets, returnTo, scope, setMode],
  );

  const actionResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.description}`.toLowerCase().includes(normalized),
    );
  }, [actions, query]);

  const debugActions = useMemo<DebugItem[]>(
    () => [
      {
        label: "Warm local markdown cache",
        description: "Queue eager markdown fetches for local reading",
        icon: <ZapIcon size={15} aria-hidden="true" />,
        run: () => {
          emit("warm-cache");
          onOpenChange(false);
        },
      },
      {
        label: "Reset local cache",
        description: "Clear this LiveStore cache and reload the reader",
        icon: <RotateCcwIcon size={15} aria-hidden="true" />,
        run: () => {
          if (kit) setConfirmingReset(true);
        },
      },
      {
        label: liveStoreDevtoolsEnabled ? "Disable LiveStore devtools" : "Enable LiveStore devtools",
        description: "Reload with the optional local LiveStore inspector setting",
        icon: liveStoreDevtoolsEnabled ? (
          <PowerOffIcon size={15} aria-hidden="true" />
        ) : (
          <PowerIcon size={15} aria-hidden="true" />
        ),
        run: () => reloadWithLiveStoreDevtools(!liveStoreDevtoolsEnabled),
      },
    ],
    [kit, liveStoreDevtoolsEnabled, onOpenChange],
  );

  const debugResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return debugActions;
    return debugActions.filter((action) =>
      `${action.label} ${action.description}`.toLowerCase().includes(normalized),
    );
  }, [debugActions, query]);

  const assetResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? assets.filter((asset) => asset.path.toLowerCase().includes(normalized))
      : assets;
    return matches.slice(0, 14);
  }, [assets, query]);

  const tags = useMemo<TagResult[]>(() => {
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const tag of parseJsonArray<string>(page.tagsJson)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  }, [pages]);

  const tagResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tags
      .filter((result) => !normalized || result.tag.toLowerCase().includes(normalized))
      .slice(0, 14);
  }, [tags, query]);

  const resetLocalCache = () => {
    if (!kit) return;
    kit.store.commit(kit.events.cacheResetRequested({ requestedAt: Date.now() }));
    window.location.reload();
  };

  const openPage = (page: { slug: string }) => {
    rememberSlug(page.slug);
    setNavigationIntentForSlug(page.slug);
    navigate(hrefForSlug(page.slug));
    onOpenChange(false);
  };

  const openOutline = (item: OutlineItem) => {
    scrollToOutlineItem(item, location.pathname);
    onOpenChange(false);
  };

  if (!open) return null;

  if (mode === "pages") {
    return (
      <WikiFilePalette
        footer={false}
        initialSearch={pageInitialQuery}
        // The document's navigation slice holds only the top level and this page's
        // ancestors: searching it would show a few pages as if they were all. A
        // startup snapshot carries the whole tree and is searchable before sync.
        loading={!manifestTree && !(!store && initial?.treeComplete)}
        onOpenChange={onOpenChange}
        onPick={recordPick}
        onSelectPage={openPage}
        open={open}
        pageIcon={<FileTextIcon size={16} aria-hidden="true" />}
        pages={filePalettePages}
        recentSlugs={recentSlugs}
        recommend={jevEnabled ? recommendPages : undefined}
        searchIcon={<SearchIcon size={16} aria-hidden="true" />}
      />
    );
  }

  // Actions come in runs of one group; a group can appear again further down.
  const actionGroups: Array<{ group: ActionItem["group"]; start: number; items: ActionItem[] }> = [];
  actionResults.forEach((action, index) => {
    const last = actionGroups.at(-1);
    if (last?.group === action.group) last.items.push(action);
    else actionGroups.push({ group: action.group, start: index, items: [action] });
  });

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <WikiCommandBackdrop />
      <WikiCommandPanel data-test-id="command-palette" title="Command palette">
        <Command filter={false} onQueryChange={setQuery} query={query}>
          <WikiCommandSearch>
            <CommandInput
              aria-label="Command palette"
              data-test-id="command-palette-input"
              placeholder={
                mode === "outline"
                  ? "Find a heading"
                  : mode === "assets"
                    ? "Find a source PDF"
                    : mode === "tags"
                      ? "Filter local tags"
                      : mode === "actions"
                        ? "Search commands..."
                        : "Run a cache tool"
              }
            />
            <SearchIcon size={16} aria-hidden="true" />
            <DialogClose aria-label="Close command palette">
              <XIcon size={16} aria-hidden="true" />
            </DialogClose>
          </WikiCommandSearch>
          <WikiCommandEmpty>
            {mode === "outline"
              ? "No headings on this page"
              : mode === "assets"
                ? "No source PDFs found"
                : mode === "tags"
                  ? "No tags found"
                  : mode === "actions"
                    ? "No actions found"
                    : "No cache tools found"}
          </WikiCommandEmpty>
          <WikiCommandList aria-label={`${mode} results`}>
            {mode === "outline"
              ? outlineResults.map((item) => (
                <WikiCommandItem
                  depth={Math.max(0, item.level - 1)}
                  description={`Heading ${item.level}`}
                  icon={<ListIcon size={15} aria-hidden="true" />}
                  key={item.id}
                  label={item.text}
                  onSelect={() => openOutline(item)}
                  value={`outline:${item.id}`}
                />
              ))
              : null}
            {mode === "assets"
              ? assetResults.map((asset) => (
                <WikiCommandItem
                  description={asset.path}
                  href={assetHref(asset.path, asset.contentHash)}
                  icon={
                    asset.kind === "pdf" ? (
                      <FileTextIcon size={15} aria-hidden="true" />
                    ) : (
                      <FileIcon size={15} aria-hidden="true" />
                    )
                  }
                  key={asset.path}
                  label={asset.path.split("/").at(-1) ?? asset.path}
                  rel="noreferrer"
                  target="_blank"
                  value={`asset:${asset.path}`}
                />
              ))
              : null}
            {mode === "tags"
              ? tagResults.map((result) => (
                <WikiCommandItem
                  description={`${result.count} pages`}
                  icon={<TagIcon size={15} aria-hidden="true" />}
                  key={result.tag}
                  label={result.tag}
                  onSelect={() => {
                    setPageInitialQuery(result.tag);
                    setMode("pages");
                  }}
                  value={`tag:${result.tag}`}
                />
              ))
              : null}
            {mode === "actions"
              ? actionGroups.map(({ group, items, start }) => (
                <CommandGroup key={`${group}-${start}`}>
                  <WikiCommandGroupHeading>{group}</WikiCommandGroupHeading>
                  {items.map((action) => (
                    <WikiCommandItem
                      description={action.description}
                      href={action.href}
                      icon={action.icon}
                      key={action.label}
                      label={action.label}
                      onSelect={action.run}
                      value={`action:${action.label}`}
                    />
                  ))}
                </CommandGroup>
              ))
              : null}
            {mode === "debug"
              ? debugResults.map((action) => (
                <WikiCommandItem
                  description={action.description}
                  icon={action.icon}
                  key={action.label}
                  label={action.label}
                  onSelect={action.run}
                  value={`debug:${action.label}`}
                />
              ))
              : null}
          </WikiCommandList>
        </Command>
        <WikiCommandFooter>
          <span>{commandLabel()} opens pages</span>
          <span>Enter runs the first result</span>
        </WikiCommandFooter>
        <AlertDialog open={confirmingReset} onOpenChange={setConfirmingReset}>
          <AlertDialogBackdrop className="wiki-shell-command-backdrop" />
          <AlertDialogContent className="wiki-shell-command-palette wiki-shell-command-confirm">
            <AlertDialogTitle render={<div />}>Reset local cache?</AlertDialogTitle>
            <AlertDialogDescription>
              Clear the local LiveStore cache for this reader and reload?
            </AlertDialogDescription>
            <div className="wiki-shell-command-confirm-actions">
              <AlertDialogClose>Cancel</AlertDialogClose>
              <AlertDialogClose action={resetLocalCache} className="wiki-shell-command-confirm-primary" value="confirm">
                Reset and reload
              </AlertDialogClose>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </WikiCommandPanel>
    </Dialog>
  );
}
