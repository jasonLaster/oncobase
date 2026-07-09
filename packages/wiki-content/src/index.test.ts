import { describe, expect, test } from "bun:test";
import {
  buildCompactTreeFromManifest,
  createWikiContentClient,
  expandCompactFileTree,
  isHiddenFileTreeAssetPath,
  isHiddenFileTreePath,
  makeWikiStoreId,
  parseWikiManifest,
  parseWikiPageBatch,
  parseWikiSessionIdentity,
  reconcilePageContent,
  transformFileTreeForSidebar,
} from "./index.ts";

type ReferenceFileNode = {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  badge?: string;
  pdfPath?: string;
  children?: ReferenceFileNode[];
};

type ReferenceCompactFileNode =
  | ["d", string, ReferenceCompactFileNode[], (string | null)?, string?]
  | ["f", string, string?]
  | ["p", string, string?];

function referenceChildSlug(parentSlug: string, name: string) {
  return parentSlug ? `${parentSlug}/${name}` : name;
}

function referenceDefaultPdfPath(parentSlug: string, name: string) {
  return `${referenceChildSlug(parentSlug, name)}.pdf`;
}

function referenceSplitSlug(slug: string) {
  return slug.split("/").filter(Boolean);
}

function referenceRelativeSlug(fromSlug: string, toSlug: string) {
  const from = referenceSplitSlug(fromSlug);
  const to = referenceSplitSlug(toSlug);
  let common = 0;

  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }

  const up = Array.from({ length: from.length - common }, () => "..");
  const down = to.slice(common);
  return [...up, ...down].join("/") || ".";
}

function referenceCompactPathOverride(
  parentSlug: string,
  name: string,
  slug: string,
  expectedSlug = referenceChildSlug(parentSlug, name),
) {
  if (slug === expectedSlug) return undefined;

  const relative = referenceRelativeSlug(parentSlug, slug);
  const safeRelative =
    relative.includes("/") && !relative.startsWith("../") ? `./${relative}` : relative;

  return safeRelative.length < slug.length ? safeRelative : slug;
}

function referenceCompactFileTree(
  nodes: ReferenceFileNode[],
  parentSlug = "",
): ReferenceCompactFileNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      const compactChildren = referenceCompactFileTree(node.children ?? [], node.slug);
      const badge = node.badge ?? null;
      const slugOverride = referenceCompactPathOverride(parentSlug, node.name, node.slug);

      if (slugOverride) return ["d", node.name, compactChildren, badge, slugOverride];
      if (badge) return ["d", node.name, compactChildren, badge];
      return ["d", node.name, compactChildren];
    }

    if (node.type === "pdf") {
      const pdfPath = node.pdfPath ?? node.slug;
      const expectedPdfPath = referenceDefaultPdfPath(parentSlug, node.name);
      const pdfPathOverride = referenceCompactPathOverride(
        parentSlug,
        node.name,
        pdfPath,
        expectedPdfPath,
      );
      return pdfPath === expectedPdfPath
        ? ["p", node.name]
        : ["p", node.name, pdfPathOverride];
    }

    const expectedSlug = referenceChildSlug(parentSlug, node.name);
    const slugOverride = referenceCompactPathOverride(parentSlug, node.name, node.slug);
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, slugOverride];
  });
}

function referenceIsHiddenFileTreePath(path: string): boolean {
  const segments = referenceSplitSlug(path);
  if ((segments[0] ?? "").toLowerCase() === "diagnostics") return true;

  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return (
      lower === "images" ||
      lower === "package.json" ||
      lower === "tsconfig" ||
      lower.startsWith("tsconfig.")
    );
  });
}

function referenceIsHiddenFileTreeAssetPath(path: string): boolean {
  if (referenceIsHiddenFileTreePath(path)) return true;
  const lower = path.toLowerCase();
  return [".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].some((extension) =>
    lower.endsWith(extension),
  );
}

function referenceWeekNumberFromName(name: string) {
  return /^week-(\d+)(?:\b|-)/i.exec(name)?.[1];
}

function referenceCompareFileTreeNodes(
  a: Pick<ReferenceFileNode, "name" | "type">,
  b: Pick<ReferenceFileNode, "name" | "type">,
) {
  if (a.type === "directory" && b.type !== "directory") return -1;
  if (a.type !== "directory" && b.type === "directory") return 1;

  const aWeek = referenceWeekNumberFromName(a.name);
  const bWeek = referenceWeekNumberFromName(b.name);
  if (aWeek && bWeek) return Number(bWeek) - Number(aWeek);
  if (aWeek) return -1;
  if (bWeek) return 1;

  return a.name.localeCompare(b.name);
}

function referenceIsArchivedDirectory(node: Pick<ReferenceFileNode, "name" | "type">) {
  return node.type === "directory" && node.name === "archived";
}

function referenceIsUpdatesDirectory(slug: string) {
  return slug === "wiki/updates";
}

function referenceCompareFileTreeNodesForParent(
  a: Pick<ReferenceFileNode, "name" | "type">,
  b: Pick<ReferenceFileNode, "name" | "type">,
  parentSlug: string,
) {
  if (referenceIsUpdatesDirectory(parentSlug)) {
    return referenceCompareFileTreeNodes(a, b);
  }
  if (a.name === "index" && b.name !== "index") return -1;
  if (b.name === "index" && a.name !== "index") return 1;
  if (referenceIsArchivedDirectory(a) && !referenceIsArchivedDirectory(b)) return 1;
  if (referenceIsArchivedDirectory(b) && !referenceIsArchivedDirectory(a)) return -1;
  return a.name.localeCompare(b.name);
}

function referenceInsertFileNode(
  nodes: ReferenceFileNode[],
  segments: string[],
  type: "file" | "pdf",
  pdfPath?: string,
  parentSlug = "",
) {
  if (segments.length === 0) return;
  const [name, ...rest] = segments;
  const slug = parentSlug ? `${parentSlug}/${name}` : name;

  if (rest.length === 0) {
    const existing = nodes.find((node) => node.name === name);
    const nextNode: ReferenceFileNode =
      type === "pdf"
        ? { name, slug: pdfPath ?? slug, type: "pdf", pdfPath: pdfPath ?? slug }
        : { name, slug, type: "file" };

    if (!existing) {
      nodes.push(nextNode);
      return;
    }

    if (existing.type === "directory") {
      existing.children = existing.children ?? [];
      existing.children.unshift(nextNode);
      return;
    }

    Object.assign(existing, nextNode);
    return;
  }

  let directory = nodes.find(
    (node) => node.name === name && node.type === "directory",
  );
  if (!directory) {
    directory = { name, slug, type: "directory", children: [] };
    nodes.push(directory);
  }
  directory.children = directory.children ?? [];
  referenceInsertFileNode(directory.children, rest, type, pdfPath, slug);
}

function referenceSortFileTree(nodes: ReferenceFileNode[], parentSlug = "") {
  nodes.sort((a, b) => referenceCompareFileTreeNodesForParent(a, b, parentSlug));
  for (const node of nodes) referenceSortFileTree(node.children ?? [], node.slug);
}

function referenceBuildCompactTreeFromManifest(
  pages: Array<{ slug: string }>,
  assets: Array<{ kind: "pdf" | "file"; path: string }> = [],
) {
  const root: ReferenceFileNode[] = [];

  for (const page of pages) {
    if (referenceIsHiddenFileTreePath(page.slug)) continue;
    referenceInsertFileNode(root, referenceSplitSlug(page.slug), "file");
  }
  for (const asset of assets) {
    if (referenceIsHiddenFileTreeAssetPath(asset.path)) continue;
    const segments = referenceSplitSlug(asset.path);
    if (segments.length === 0) continue;

    if (asset.kind === "pdf" || asset.path.toLowerCase().endsWith(".pdf")) {
      const name = segments[segments.length - 1]!.replace(/\.pdf$/i, "");
      referenceInsertFileNode(
        root,
        [...segments.slice(0, -1), name],
        "pdf",
        asset.path,
      );
    } else {
      referenceInsertFileNode(root, segments, "file");
    }
  }

  referenceSortFileTree(root);
  return referenceCompactFileTree(root);
}

describe("wiki content contracts", () => {
  test("expands compact file trees", () => {
    expect(expandCompactFileTree([["d", "wiki", [["f", "index"], ["p", "paper"]]]])).toEqual([
      {
        name: "wiki",
        slug: "wiki",
        type: "directory",
        children: [
          { name: "index", slug: "wiki/index", type: "file" },
          { name: "paper", slug: "wiki/paper.pdf", type: "pdf", pdfPath: "wiki/paper.pdf" },
        ],
      },
    ]);
  });

  test("builds compact trees from manifest entries", () => {
    expect(
      buildCompactTreeFromManifest(
        [{ slug: "index" }, { slug: "research/papers/index" }],
        [
          { kind: "pdf", path: "research/papers/trial.pdf" },
          { kind: "file", path: "images/scan.png" },
        ],
      ),
    ).toEqual([
      ["f", "index"],
      [
        "d",
        "research",
        [["d", "papers", [["f", "index"], ["p", "trial"]]]],
      ],
    ]);
  });

  test("matches the previous manifest compact-tree builder over representative inputs", () => {
    const cases: Array<{
      name: string;
      pages: Array<{ slug: string }>;
      assets?: Array<{ kind: "pdf" | "file"; path: string }>;
    }> = [
      {
        name: "mixed-case siblings and nested index files",
        pages: [
          { slug: "index" },
          { slug: "about/Terminology" },
          { slug: "about/overview/index" },
          { slug: "about/Thesis" },
          { slug: "about/log/July 2026" },
          { slug: "about/Journal" },
          { slug: "about/Log" },
          { slug: "about/About" },
        ],
      },
      {
        name: "files, pdfs, hidden assets, and directory interleaving",
        pages: [
          { slug: "wiki/treatment/index" },
          { slug: "wiki/treatment/clinical-trials" },
          { slug: "wiki/treatment/archived/old-plan" },
          { slug: "wiki/treatment/plan/current" },
          { slug: "wiki/config/tsconfig.json" },
        ],
        assets: [
          { kind: "pdf", path: "sources/diagnostics/report.pdf" },
          { kind: "file", path: "sources/diagnostics/report.csv" },
          { kind: "file", path: "sources/diagnostics/plot.png" },
          { kind: "pdf", path: "diagnostics/viewer-upload/report.pdf" },
        ],
      },
      {
        name: "weekly update ordering and ungrouped meeting notes",
        pages: [
          { slug: "wiki/updates/week-8-may-3-to-9" },
          { slug: "wiki/updates/week-10-may-17-to-23" },
          { slug: "wiki/updates/week-9-may-10-to-16" },
          { slug: "wiki/updates/index" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw" },
        ],
      },
      {
        name: "paper collection files remain manifest-flat",
        pages: [
          { slug: "sources/research/papers/telli-2016-hrd-platinum-tnbc" },
          { slug: "sources/research/papers/telli-2016-hrd-platinum-tnbc-analysis" },
        ],
        assets: [
          { kind: "pdf", path: "sources/research/papers/telli-2016-hrd-platinum-tnbc.pdf" },
          { kind: "file", path: "sources/research/papers/telli-2016-hrd-platinum-tnbc.bib" },
        ],
      },
    ];

    for (const testCase of cases) {
      const pageVariants = [
        testCase.pages,
        [...testCase.pages].reverse(),
        [...testCase.pages.slice(2), ...testCase.pages.slice(0, 2)],
      ];
      const assetVariants = [
        testCase.assets ?? [],
        [...(testCase.assets ?? [])].reverse(),
      ];

      for (const pages of pageVariants) {
        for (const assets of assetVariants) {
          expect(buildCompactTreeFromManifest(pages, assets), testCase.name).toEqual(
            referenceBuildCompactTreeFromManifest(pages, assets),
          );
        }
      }
    }

    const aboutTree = buildCompactTreeFromManifest([
      { slug: "about/Terminology" },
      { slug: "about/overview/index" },
      { slug: "about/Thesis" },
      { slug: "about/log/July 2026" },
      { slug: "about/Journal" },
      { slug: "about/Log" },
      { slug: "about/About" },
    ]);
    expect(aboutTree[0]).toEqual([
      "d",
      "about",
      [
        ["f", "About"],
        ["f", "Journal"],
        ["d", "log", [["f", "July 2026"]]],
        ["f", "Log"],
        ["d", "overview", [["f", "index"]]],
        ["f", "Terminology"],
        ["f", "Thesis"],
      ],
    ]);

    const meetingTree = buildCompactTreeFromManifest([
      { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted" },
      { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview" },
      { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw" },
    ]);
    expect(JSON.stringify(meetingTree)).not.toContain("Notes set");
    expect(JSON.stringify(meetingTree)).not.toContain("__meeting-set");

    const paperTree = buildCompactTreeFromManifest(
      [
        { slug: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization" },
        { slug: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization-analysis" },
      ],
      [
        {
          kind: "pdf",
          path: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization.pdf",
        },
      ],
    );
    expect(JSON.stringify(paperTree)).not.toContain("PDF set");
    expect(JSON.stringify(paperTree)).not.toContain("__paper-set");
    expect(paperTree).toEqual([
      [
        "d",
        "sources",
        [
          [
            "d",
            "research",
            [
              [
                "d",
                "papers",
                [
                  ["p", "grippin-2025-covid-mrna-tumor-sensitization"],
                  ["f", "grippin-2025-covid-mrna-tumor-sensitization-analysis"],
                ],
              ],
            ],
          ],
        ],
      ],
    ]);
  });

  test("sidebar transform builds meeting-note set folders for display only", () => {
    const tree = expandCompactFileTree(
      buildCompactTreeFromManifest(
        [
          { slug: "about/Terminology" },
          { slug: "about/overview/index" },
          { slug: "about/Thesis" },
          { slug: "about/log/July 2026" },
          { slug: "about/Journal" },
          { slug: "about/Log" },
          { slug: "about/About" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview" },
          { slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw" },
          { slug: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization" },
          { slug: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization-analysis" },
        ],
        [
          {
            kind: "pdf",
            path: "sources/research/papers/grippin-2025-covid-mrna-tumor-sensitization.pdf",
          },
        ],
      ),
    );

    const transformed = transformFileTreeForSidebar(tree);
    const sources = transformed.find((node) => node.slug === "sources");
    const meetingNotes = sources?.children?.find(
      (node) => node.slug === "sources/meeting-notes",
    );
    const meetingSet = meetingNotes?.children?.find(
      (node) =>
        node.type === "directory" &&
        node.slug === "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync__meeting-set",
    );

    expect(meetingSet).toMatchObject({
      name: "05-13---echo-kernis-phm-tissue-sync",
      type: "directory",
      badge: "Notes set",
    });
    expect(meetingSet?.children?.map((child) => [child.name, child.slug]).sort()).toEqual([
      ["Formatted", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted"],
      ["Overview", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview"],
      ["Raw", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw"],
    ]);
    expect(
      meetingNotes?.children?.some(
        (node) =>
          node.slug === "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview",
      ),
    ).toBe(false);
  });

  test("sorts weekly update pages by descending week number", () => {
    expect(
      buildCompactTreeFromManifest([
        { slug: "wiki/updates/week-8-may-3-to-9" },
        { slug: "wiki/updates/week-10-may-17-to-23" },
        { slug: "wiki/updates/week-9-may-10-to-16" },
        { slug: "wiki/updates/index" },
      ]),
    ).toEqual([
      [
        "d",
        "wiki",
        [
          [
            "d",
            "updates",
            [
              ["f", "week-10-may-17-to-23"],
              ["f", "week-9-may-10-to-16"],
              ["f", "week-8-may-3-to-9"],
              ["f", "index"],
            ],
          ],
        ],
      ],
    ]);
  });

  test("hides image asset directories from the navigation tree only", () => {
    expect(isHiddenFileTreePath("diagnostics/viewer-upload/report.pdf")).toBe(true);
    expect(isHiddenFileTreePath("wiki/diagnostics/index")).toBe(false);
    expect(isHiddenFileTreePath("sources/diagnostics/report")).toBe(false);
    expect(isHiddenFileTreePath("images/scan.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/media/images/scan.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/image-analysis/notes")).toBe(false);
    expect(isHiddenFileTreePath("wiki/config/package.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig.base.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig-notes")).toBe(false);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/img-000.jpg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/diagram.svg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/table.csv")).toBe(false);
    expect(
      buildCompactTreeFromManifest(
        [
          { slug: "wiki/image-analysis/notes" },
          { slug: "wiki/education/images/index" },
          { slug: "wiki/config/package.json" },
          { slug: "wiki/config/tsconfig.json" },
        ],
        [
          { kind: "pdf", path: "diagnostics/viewer-upload/report.pdf" },
          { kind: "file", path: "wiki/media/images/scan.png" },
          { kind: "file", path: "wiki/config/package.json" },
          { kind: "file", path: "wiki/config/tsconfig.json" },
          { kind: "file", path: "sources/paper-images/img-000.jpg" },
          { kind: "pdf", path: "sources/diagnostics/report.pdf" },
          { kind: "pdf", path: "sources/images/pathology-slide.pdf" },
          { kind: "pdf", path: "sources/people/providers/stanford/telli.pdf" },
        ],
      ),
    ).toEqual([
      [
        "d",
        "sources",
        [
          ["d", "diagnostics", [["p", "report"]]],
          ["d", "people", [["d", "providers", [["d", "stanford", [["p", "telli"]]]]]]],
        ],
      ],
      ["d", "wiki", [["d", "image-analysis", [["f", "notes"]]]]],
    ]);
  });

  test("parses manifest payloads", () => {
    const manifest = parseWikiManifest({
      siteSlug: "diana",
      manifestHash: "abc",
      generatedAt: "2026-05-09T12:00:00.000Z",
      scope: "public",
      compactTree: [["f", "index"]],
      pages: [
        {
          slug: "index",
          title: "Index",
          tags: [],
          description: null,
          contentHash: "hash",
          sensitive: false,
          size: 10,
        },
      ],
      assets: [{ kind: "pdf", path: "wiki/paper.pdf", contentHash: null, size: null }],
    });

    expect(manifest.pages[0]?.contentHash).toBe("hash");
  });

  test("rejects invalid manifest payloads before they reach LiveStore", () => {
    expect(() =>
      parseWikiManifest({
        siteSlug: "diana",
        manifestHash: "abc",
        generatedAt: "2026-05-09T12:00:00.000Z",
        scope: "public",
        compactTree: [["x", "bad"]],
        pages: [],
        assets: [],
      }),
    ).toThrow("manifest.compactTree");

    expect(() =>
      parseWikiManifest({
        siteSlug: "diana",
        manifestHash: "abc",
        generatedAt: "2026-05-09T12:00:00.000Z",
        scope: "public",
        compactTree: [],
        pages: [
          {
            slug: "index",
            title: "Index",
            tags: ["home"],
            description: null,
            contentHash: null,
            sensitive: false,
            size: "large",
          },
        ],
        assets: [],
      }),
    ).toThrow("page.size");
  });

  test("parses page batches and stable pagination cursors", () => {
    const batch = parseWikiPageBatch({
      siteSlug: "diana",
      generatedAt: "2026-05-09T12:00:00.000Z",
      scope: "public",
      pages: [
        {
          slug: "wiki/page",
          title: "Page",
          content: "# Page",
          tags: ["wiki"],
          contentHash: null,
          sensitive: false,
          size: 6,
        },
      ],
      isDone: false,
      continueCursor: "cursor-2",
    });

    expect(batch.continueCursor).toBe("cursor-2");
    expect(batch.pages[0]?.content).toBe("# Page");
  });

  test("reconciles content hashes", () => {
    expect(reconcilePageContent(null, { contentHash: "a" })).toEqual({ status: "missing" });
    expect(reconcilePageContent({ contentHash: "a" }, { contentHash: "a" })).toEqual({
      status: "fresh",
      contentHash: "a",
    });
    expect(reconcilePageContent({ contentHash: "a" }, { contentHash: "b" })).toEqual({
      status: "stale",
      localHash: "a",
      remoteHash: "b",
    });
    expect(reconcilePageContent({ contentHash: "a" }, null)).toEqual({
      status: "stale",
      localHash: "a",
      remoteHash: null,
    });
  });

  test("separates public and session store ids", () => {
    const publicId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
    });
    const sessionId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "session",
      origin: "https://example.test",
      cacheKey: "session-user-1",
    });
    expect(publicId).not.toBe(sessionId);
    expect(sessionId).toContain("session-user-1");
    expect(
      makeWikiStoreId({
        siteSlug: "diana tn/bc",
        scope: "session",
        origin: "https://example.test/path",
        cacheKey: "user:1/private",
      }),
    ).toBe("wiki-vite-reader-v3-diana_tn_bc-session-https___example_test_path-user_1_private");
  });

  test("includes the reader cache version in store ids", () => {
    const currentId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
    });
    const nextId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
      readerCacheVersion: "reader:v2",
    });

    expect(currentId).toContain("reader-v3");
    expect(nextId).toBe("wiki-vite-reader_v2-diana-public-https___example_test-public-v1");
    expect(nextId).not.toBe(currentId);
  });

  test("parses server-issued session cache identities", () => {
    const identity = parseWikiSessionIdentity({
      siteSlug: "diana",
      scope: "session",
      authenticated: true,
      cacheKey: "diana:session:user:v1",
      cacheVersion: "v1",
      userHash: "user",
    });

    expect(identity.authenticated).toBe(true);
    expect(identity.cacheKey).toContain("session");
  });

  test("client helpers can include credentials for preview API origins", async () => {
    let requestInit: RequestInit | undefined;
    const client = createWikiContentClient({
      baseUrl: "https://wiki.example",
      credentials: "include",
      fetch: (async (_url, init) => {
        requestInit = init;
        return Response.json({
          siteSlug: "diana",
          scope: "public",
          authenticated: false,
          cacheKey: "public",
          cacheVersion: "v1",
          userHash: null,
        });
      }) as typeof fetch,
    });

    await client.fetchSessionIdentity();

    expect(requestInit?.credentials).toBe("include");
    expect(requestInit?.cache).toBe("no-cache");
  });

  test("client helpers allow cache policy overrides", async () => {
    let requestInit: RequestInit | undefined;
    const client = createWikiContentClient({
      cache: "reload",
      fetch: (async (_url, init) => {
        requestInit = init;
        return Response.json({
          siteSlug: "diana",
          manifestHash: "hash",
          generatedAt: "2026-05-10T00:00:00.000Z",
          scope: "public",
          compactTree: [],
          pages: [],
          assets: [],
        });
      }) as typeof fetch,
    });

    await client.fetchManifest();

    expect(requestInit?.cache).toBe("reload");
  });

  test("client helpers time out stalled wiki requests", async () => {
    const client = createWikiContentClient({
      requestTimeoutMs: 1,
      fetch: (async (
        _url: Parameters<typeof fetch>[0],
        init: Parameters<typeof fetch>[1],
      ) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        throw new Error("unreachable");
      }) as unknown as typeof fetch,
    });

    await expect(client.fetchManifest()).rejects.toThrow("timed out");
  });
});
