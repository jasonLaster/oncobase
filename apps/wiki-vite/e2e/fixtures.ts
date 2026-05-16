import crypto from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  buildCompactTreeFromManifest,
  type WikiManifest,
  type WikiManifestAsset,
  type WikiManifestPage,
  type WikiPageRecord,
  type WikiScope,
} from "@diana-tnbc/wiki-content";
import {
  applyPiiRedactions,
  parseSitePiiPatterns,
  type PiiPattern,
} from "@diana-tnbc/wiki-content/pii";

type FixturePage = {
  title: string;
  tags: string[];
  description?: string;
  content: string;
  sensitive?: boolean;
};

type MockOptions = {
  siteSlug?: string;
  sessionAuthenticated?: boolean;
  sessionCacheKey?: string;
  sessionUserHash?: string;
  manifestFailure?: boolean;
  pageFailures?: Partial<Record<string, number | true>>;
  pageOverrides?: Partial<Record<string, Partial<FixturePage>>>;
  piiPatterns?: string[] | null;
};

const generatedAt = "2026-05-09T12:00:00.000Z";
const defaultSiteSlug = "diana";

function repeatParagraph(label: string, count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${label} background note ${index + 1}. This paragraph gives the reader enough vertical space to exercise scroll restoration and hash navigation in the Vite reader.`,
  ).join("\n\n");
}

const basePages: Record<string, FixturePage> = {
  index: {
    title: "Diana Wiki Home",
    tags: ["home", "wiki"],
    description: "Local fixture home page for the Vite reader.",
    content: `# Diana Wiki Home

Welcome to the local Vite reader fixture.

- [[wiki/logistics/insurance|Insurance]]
- [[wiki/updates/week-5-april-12-to-18|Week 5 update]]
- [[wiki/examples/smart-table|Smart Table Examples]]
- [[wiki/media/image-theater|Image Theater Fixture]]
- [[sources/people/providers/stanford/telli|Telli source]]
`,
  },
  "wiki/logistics/insurance": {
    title: "Insurance",
    tags: ["logistics", "insurance"],
    description: "Insurance planning notes.",
    content: `# Insurance

This page covers authorization, coverage notes, and practical logistics.

## Prior authorization

Keep the current payer, oncology office, and imaging center aligned before scheduled care.

## Claims follow-up

Use this section to track follow-up calls and documents.
`,
  },
  "wiki/updates/week-5-april-12-to-18": {
    title: "Week 5: April 12 to 18",
    tags: ["updates", "timeline"],
    description: "A long update page used by navigation tests.",
    content: `# Week 5: April 12 to 18

This weekly update links to [BRCA terminology](/about/Terminology#brca), [radioligand therapy](/wiki/treatment/therapeutics/radioligand-therapy), and [the treatment note](#treatment-note).

${repeatParagraph("Opening", 16)}

## Saturday, April 12

This is the heading used by the migrated heading-anchor tests.

${repeatParagraph("Saturday", 16)}

## Treatment note

The treatment note is the same-page hash target.

${repeatParagraph("Treatment", 8)}
`,
  },
  "wiki/treatment/therapeutics/radioligand-therapy": {
    title: "Radioligand Therapy",
    tags: ["treatment", "therapeutics"],
    content: `# Radioligand Therapy

This page exists so cross-page markdown links can prove app navigation resets scroll without fetching server-rendered HTML.
`,
  },
  "about/About": {
    title: "About This Wiki",
    tags: ["about"],
    content: `# About This Wiki

The Vite prototype reads markdown from a local LiveStore cache and refreshes content in the background.
<redact label="the patient">Diana Laster</redact> keeps raw identifiers out of rendered pages.

## Reading goals

Reader parity should be measured with local navigation, headings, media, tables, and sidebar traversal.
`,
  },
  "about/Terminology": {
    title: "Terminology",
    tags: ["about", "terminology"],
    content: `# Terminology

${repeatParagraph("Terminology", 12)}

## BRCA

BRCA is the cross-page hash target.

${repeatParagraph("BRCA", 8)}

## Survival Endpoints

Survival endpoint definitions belong here.
`,
  },
  "wiki/examples/smart-table": {
    title: "Smart Table Examples",
    tags: ["tables", "examples"],
    content: `# Smart Table Examples

${repeatParagraph("Overview", 12)}

## Component API Scenarios

| Scenario | Column One | Column Two | Column Three | Column Four | Column Five | Column Six |
| --- | --- | --- | --- | --- | --- | --- |
| Compact row | A short value | Another value | Follow up | Owner | Status | Notes |
| Landscape row | This row is intentionally long enough to create horizontal overflow in the table wrapper | Wide value | Additional information | Care team | Open | Resize target |

${repeatParagraph("Trailing", 16)}

## Resize Performance Audit

| Target | Expected | Actual |
| --- | --- | --- |
| Resize handle | Responsive | Responsive |
| Expansion lane | Stable | Stable |

${repeatParagraph("Audit footnotes", 8)}
`,
  },
  "wiki/media/image-theater": {
    title: "Image Theater Fixture",
    tags: ["media"],
    content: `# Image Theater Fixture

![Pathology slide](/api/file?path=sources/images/pathology-slide.png)
`,
  },
  "wiki/diagnostics/diagnosis": {
    title: "Diagnosis",
    tags: ["diagnostics"],
    content: `# Diagnosis

Diagnosis content should render through the Vite shell without a source loading boundary.
Diana Laster has MRN 88855655 in raw source fixtures, which must not appear in the Vite reader.
`,
  },
  "sources/people/providers/stanford/telli": {
    title: "Telli 2016 HRD Platinum TNBC",
    tags: ["source", "stanford"],
    content: `# Telli 2016 HRD Platinum TNBC

This source page proves source routes render as markdown links in the same reader.

[[sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf|Open PDF]]
`,
  },
  "wiki/timeline/gantt": {
    title: "Timeline Gantt",
    tags: ["timeline"],
    content: `# Timeline Gantt

\`\`\`mermaid
gantt
  title Care Timeline
  dateFormat  YYYY-MM-DD
  section Treatment
  Chemo :done, 2026-04-01, 7d
\`\`\`
`,
  },
  "private/plan": {
    title: "Private Plan",
    tags: ["sensitive"],
    sensitive: true,
    content: `# Private Plan

Sensitive session-only planning note.
`,
  },
};

const assets: WikiManifestAsset[] = [
  {
    kind: "pdf",
    path: "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
    contentHash: "pdf-hash",
    size: 256,
  },
  {
    kind: "file",
    path: "sources/images/pathology-slide.png",
    contentHash: "image-hash",
    size: 96,
  },
];

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function pagesForOptions(options: MockOptions) {
  const pages: Record<string, FixturePage> = { ...basePages };

  for (const [slug, override] of Object.entries(options.pageOverrides ?? {})) {
    const base = pages[slug];
    if (base) {
      pages[slug] = { ...base, ...override };
      continue;
    }

    if (
      typeof override.title !== "string" ||
      !Array.isArray(override.tags) ||
      typeof override.content !== "string"
    ) {
      throw new Error(`Fixture override for ${slug} must include title, tags, and content`);
    }

    pages[slug] = {
      title: override.title,
      tags: override.tags,
      content: override.content,
      ...(typeof override.description === "string"
        ? { description: override.description }
        : {}),
      ...(override.sensitive === true ? { sensitive: true } : {}),
    };
  }

  return pages;
}

function resolvePatterns(options: MockOptions): PiiPattern[] | undefined {
  if (options.piiPatterns === null) return [];
  if (Array.isArray(options.piiPatterns)) {
    return parseSitePiiPatterns(options.piiPatterns);
  }
  const siteSlug = options.siteSlug ?? defaultSiteSlug;
  return siteSlug === defaultSiteSlug ? undefined : [];
}

function pageRecord(slug: string, page: FixturePage, options: MockOptions): WikiPageRecord {
  const patterns = resolvePatterns(options);
  const content = applyPiiRedactions(page.content, { patterns });
  return {
    slug,
    title: page.title,
    content,
    tags: page.tags,
    contentHash: hash(`${slug}:${content}`),
    sensitive: page.sensitive === true,
    size: content.length,
  };
}

function visibleRecords(scope: WikiScope, options: MockOptions) {
  return Object.entries(pagesForOptions(options))
    .map(([slug, page]) => pageRecord(slug, page, options))
    .filter((page) => scope === "session" || !page.sensitive);
}

function manifest(scope: WikiScope, options: MockOptions): WikiManifest {
  const siteSlug = options.siteSlug ?? defaultSiteSlug;
  const pages: WikiManifestPage[] = visibleRecords(scope, options).map((page) => ({
    slug: page.slug,
    title: page.title,
    tags: page.tags,
    description: pagesForOptions(options)[page.slug]?.description ?? null,
    contentHash: page.contentHash,
    sensitive: page.sensitive,
    size: page.size,
  }));
  const compactTree = buildCompactTreeFromManifest(pages, assets);
  const core = { siteSlug, scope, compactTree, pages, assets };
  return {
    ...core,
    generatedAt,
    manifestHash: hash(JSON.stringify(core)),
  };
}

function scopeFromUrl(url: URL): WikiScope {
  return url.searchParams.get("scope") === "session" ? "session" : "public";
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp5y9wAAAABJRU5ErkJggg==",
  "base64",
);

export async function installWikiApiMocks(page: Page, options: MockOptions = {}) {
  const siteSlug = options.siteSlug ?? defaultSiteSlug;
  const sessionState = {
    authenticated: options.sessionAuthenticated === true,
    cacheKey: options.sessionCacheKey ?? `${siteSlug}:session:e2e-user:e2e`,
    userHash: options.sessionUserHash ?? "e2e-user",
  };
  const pageFailures = new Map(
    Object.entries(options.pageFailures ?? {}).map(([slug, count]) => [
      slug,
      count === true ? Number.POSITIVE_INFINITY : count,
    ]),
  );
  const requests = {
    manifest: [] as string[],
    pages: [] as string[],
    files: [] as string[],
    downloads: [] as string[],
    setSessionAuthenticated(authenticated: boolean) {
      sessionState.authenticated = authenticated;
    },
    setSessionCacheKey(cacheKey: string, userHash = sessionState.userHash) {
      sessionState.cacheKey = cacheKey;
      sessionState.userHash = userHash;
    },
    setPageFailure(slug: string, count: number | true) {
      pageFailures.set(slug, count === true ? Number.POSITIVE_INFINITY : count);
    },
  };

  await page.route("**/api/wiki/session**", async (route) => {
    const url = new URL(route.request().url());
    const scope = scopeFromUrl(url);
    if (scope === "session" && !sessionState.authenticated) {
      await route.fulfill(json({ error: "Session required" }, 401));
      return;
    }

    await route.fulfill(
      json({
        siteSlug,
        scope,
        authenticated: scope === "session",
        cacheVersion: "e2e",
        cacheKey: scope === "session" ? sessionState.cacheKey : `${siteSlug}:public:e2e`,
        userHash: scope === "session" ? sessionState.userHash : null,
      }),
    );
  });

  await page.route("**/api/wiki/manifest**", async (route) => {
    const url = new URL(route.request().url());
    const scope = scopeFromUrl(url);
    requests.manifest.push(url.toString());
    if (options.manifestFailure) {
      await route.fulfill(json({ error: "Fixture manifest failure" }, 503));
      return;
    }
    await route.fulfill(json(manifest(scope, options)));
  });

  await page.route("**/api/wiki/pages**", async (route) => {
    const url = new URL(route.request().url());
    const scope = scopeFromUrl(url);
    const records = visibleRecords(scope, options);
    requests.pages.push(url.toString());

    const slugs = (url.searchParams.get("slugs") ?? "")
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean);
    if (slugs.length > 0) {
      const failedSlug = slugs.find((slug) => (pageFailures.get(slug) ?? 0) > 0);
      if (failedSlug) {
        const remaining = pageFailures.get(failedSlug) ?? 0;
        pageFailures.set(failedSlug, remaining - 1);
        await route.fulfill(json({ error: "Fixture markdown failure" }, 503));
        return;
      }

      await route.fulfill(
        json({
          siteSlug,
          generatedAt,
          scope,
          pages: slugs
            .map((slug) => records.find((pageRecord) => pageRecord.slug === slug))
            .filter(Boolean),
          isDone: true,
          continueCursor: null,
        }),
      );
      return;
    }

    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const pageSlice = records.slice(cursor, cursor + limit);
    const nextCursor = cursor + pageSlice.length;
    await route.fulfill(
      json({
        siteSlug,
        generatedAt,
        scope,
        pages: pageSlice,
        isDone: nextCursor >= records.length,
        continueCursor: nextCursor >= records.length ? null : String(nextCursor),
      }),
    );
  });

  await page.route("**/api/file**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    requests.files.push(path);
    if (path.endsWith(".png")) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: png,
      });
      return;
    }
    if (path.endsWith(".pdf")) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
      });
      return;
    }
    await route.fulfill(json({ error: "Unsupported fixture file" }, 400));
  });

  await page.route("**/api/page-copy**", async (route) => {
    const url = new URL(route.request().url());
    const slug = url.searchParams.get("slug") ?? "";
    const scope = scopeFromUrl(url);
    const record = visibleRecords(scope, options).find((pageRecord) => pageRecord.slug === slug);
    if (!record) {
      await route.fulfill({ status: 404, body: "Not found" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: {
        "Content-Disposition": `attachment; filename="${slug.split("/").at(-1) ?? "page"}.md"`,
        "X-Wiki-Cache-Scope": scope,
      },
      body: record.content,
    });
  });

  await page.route("**/api/download**", async (route) => {
    const url = new URL(route.request().url());
    requests.downloads.push(url.toString());
    const scope = scopeFromUrl(url);
    const body = visibleRecords(scope, options)
      .map((record) => `<!-- ${record.slug} -->\n\n${record.content}`)
      .join("\n---\n");
    await route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: {
        "Content-Disposition": `attachment; filename="${siteSlug}-wiki.md"`,
        "X-Wiki-Cache-Scope": scope,
      },
      body,
    });
  });

  return requests;
}

export function documentArticle(page: Page) {
  return page.getByTestId("document-article").first();
}

export function nextErrorOverlay(page: Page) {
  return page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
  );
}

export async function gotoWiki(page: Page, path = "/") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(documentArticle(page)).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0, { timeout: 15_000 });
}

export async function waitForPageTitle(page: Page, title: string | RegExp) {
  await expect(documentArticle(page).locator(".page-header h1")).toHaveText(title, {
    timeout: 15_000,
  });
}

export async function openDirectory(page: Page, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expandButton = page
    .getByRole("button", { name: new RegExp(`^Expand ${escapedName}$`, "i") })
    .first();
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }
}

export function firstSmartTableShell(page: Page): Locator {
  return documentArticle(page).locator("[data-smart-table-shell]").first();
}

export function firstSmartTableToggle(page: Page): Locator {
  return firstSmartTableShell(page).getByRole("button", { name: "Expand table" });
}

export function skippedMigrationSpec(feature: string, reason: string, tests: string[]) {
  return { feature, reason, tests };
}
