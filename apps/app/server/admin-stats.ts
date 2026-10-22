import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api.js";
import { listDocuments } from "./document-listing";
import { withSiteSlug } from "./reader-access.js";

// Content inventory for the admin dashboard. Folder conventions come from the
// vault: calls live in sources/meeting-notes (one call publishes -raw,
// -formatted and -overview pages), emails in sources/emails, and education
// lessons in wiki/education.
export const CALLS_PREFIX = "sources/meeting-notes/";
export const EMAILS_PREFIX = "sources/emails/";
export const SOURCES_PREFIX = "sources/";
export const WIKI_PREFIX = "wiki/";
export const EDUCATION_PREFIX = "wiki/education/";

const CALL_VARIANT_RE = /-(raw|formatted|overview|avs)$/;
const SLUG_MONTH_RE = /^(\d{2})-\d{2}/;

export type StatsPage = { slug: string; sensitive?: boolean };
export type RedactionRow = { slug: string; sensitive: boolean; redactions: number };
export type FolderCount = { folder: string; pages: number; restricted: number };
export type MonthCount = { month: string; count: number };

export type ContentStats = {
  totals: { pages: number; restricted: number };
  sources: { pages: number; restricted: number; folders: FolderCount[] };
  wiki: { pages: number; restricted: number; folders: FolderCount[] };
  education: { pages: number };
  other: FolderCount[];
  calls: {
    calls: number;
    transcripts: number;
    formatted: number;
    overviews: number;
    pages: number;
    restricted: number;
    redacted: number;
    redactionBlocks: number;
    byMonth: MonthCount[];
  };
  emails: {
    emails: number;
    restricted: number;
    redacted: number;
    redactionBlocks: number;
    byMonth: MonthCount[];
  };
};

/** The call a meeting-notes page belongs to: its slug without the variant suffix. */
export function callKey(slug: string) {
  return slug.slice(CALLS_PREFIX.length).replace(CALL_VARIANT_RE, "");
}

function folderCounts(pages: StatsPage[], prefix: string) {
  const folders = new Map<string, FolderCount>();
  for (const page of pages) {
    const rest = page.slug.slice(prefix.length);
    const folder = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : "(top level)";
    const entry = folders.get(folder) ?? { folder, pages: 0, restricted: 0 };
    entry.pages++;
    if (page.sensitive) entry.restricted++;
    folders.set(folder, entry);
  }
  return [...folders.values()].sort((a, b) => b.pages - a.pages || a.folder.localeCompare(b.folder));
}

// Vault filenames start MM-DD; the year is implicit (the current care year).
function byMonth(keys: Iterable<string>) {
  const months = new Map<string, number>();
  for (const key of keys) {
    const month = key.match(SLUG_MONTH_RE)?.[1];
    if (!month || Number(month) < 1 || Number(month) > 12) continue;
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
}

const restrictedCount = (pages: StatsPage[]) => pages.filter((page) => page.sensitive).length;

export function summarizeContent(pages: StatsPage[], redactions: RedactionRow[]): ContentStats {
  const under = (prefix: string) => pages.filter((page) => page.slug.startsWith(prefix));
  const sources = under(SOURCES_PREFIX);
  const wiki = under(WIKI_PREFIX);
  const otherPages = pages.filter((page) => !page.slug.startsWith(SOURCES_PREFIX) && !page.slug.startsWith(WIKI_PREFIX));

  const callPages = under(CALLS_PREFIX);
  const calls = new Map<string, { restricted: boolean; redactions: number }>();
  for (const page of callPages) {
    const call = calls.get(callKey(page.slug)) ?? { restricted: false, redactions: 0 };
    call.restricted ||= page.sensitive === true;
    calls.set(callKey(page.slug), call);
  }
  const variantCount = (variant: string) => callPages.filter((page) => page.slug.endsWith(`-${variant}`)).length;

  // Redaction rows come from a separate body scan; only count pages that are
  // also in the listing so both halves describe the same corpus.
  const listed = new Set(pages.map((page) => page.slug));
  let callRedactionBlocks = 0;
  for (const row of redactions) {
    if (!row.slug.startsWith(CALLS_PREFIX) || !listed.has(row.slug)) continue;
    const call = calls.get(callKey(row.slug));
    if (!call) continue;
    call.redactions += row.redactions;
    callRedactionBlocks += row.redactions;
  }
  const emailRedactions = redactions.filter((row) => row.slug.startsWith(EMAILS_PREFIX) && listed.has(row.slug));
  const emailPages = under(EMAILS_PREFIX);

  return {
    totals: { pages: pages.length, restricted: restrictedCount(pages) },
    sources: { pages: sources.length, restricted: restrictedCount(sources), folders: folderCounts(sources, SOURCES_PREFIX) },
    wiki: { pages: wiki.length, restricted: restrictedCount(wiki), folders: folderCounts(wiki, WIKI_PREFIX) },
    education: { pages: under(EDUCATION_PREFIX).length },
    other: folderCounts(otherPages, ""),
    calls: {
      calls: calls.size,
      transcripts: variantCount("raw"),
      formatted: variantCount("formatted"),
      overviews: variantCount("overview"),
      pages: callPages.length,
      restricted: [...calls.values()].filter((call) => call.restricted).length,
      redacted: [...calls.values()].filter((call) => call.redactions > 0).length,
      redactionBlocks: callRedactionBlocks,
      byMonth: byMonth(calls.keys()),
    },
    emails: {
      emails: emailPages.length,
      restricted: restrictedCount(emailPages),
      redacted: emailRedactions.filter((row) => row.redactions > 0).length,
      redactionBlocks: emailRedactions.reduce((sum, row) => sum + row.redactions, 0),
      byMonth: byMonth(emailPages.map((page) => page.slug.slice(EMAILS_PREFIX.length))),
    },
  };
}

type QueryClient = Pick<ConvexHttpClient, "query">;
const MAX_PAGES = 1000;

async function readRedactions(client: QueryClient, siteSlug: string, prefix: string) {
  const rows: RedactionRow[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const result: FunctionReturnType<typeof api.adminStats.redactionPage> = await client.query(api.adminStats.redactionPage, { siteSlug, prefix, cursor, numItems: 25 });
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
  throw new Error(`Redaction scan of ${prefix} did not finish`);
}

const COUNTED_TABLES = ["pdfAssets", "fileAssets", "dicomSeries", "dicomImages", "pathologySlides", "pageShares", "commentRooms"] as const;
export type RecordCounts = Record<(typeof COUNTED_TABLES)[number] | "commentThreads", number>;

async function countTable(client: QueryClient, siteSlug: string, table: (typeof COUNTED_TABLES)[number]) {
  const total = { count: 0, threads: 0 };
  let cursor: string | null = null;
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const result: FunctionReturnType<typeof api.adminStats.countPage> = await client.query(api.adminStats.countPage, { siteSlug, table, cursor, numItems: 4000 });
    total.count += result.count;
    total.threads += result.threads;
    if (result.isDone) return total;
    cursor = result.continueCursor;
  }
  throw new Error(`Count of ${table} did not finish`);
}

export async function getAdminStats(client: QueryClient, siteSlug: string) {
  const [pages, callRedactions, emailRedactions, counts] = await Promise.all([
    listDocuments(client, withSiteSlug(siteSlug, { includeSensitive: true })) as Promise<StatsPage[]>,
    readRedactions(client, siteSlug, CALLS_PREFIX),
    readRedactions(client, siteSlug, EMAILS_PREFIX),
    Promise.all(COUNTED_TABLES.map((table) => countTable(client, siteSlug, table))),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    content: summarizeContent(pages, [...callRedactions, ...emailRedactions]),
    records: {
      ...Object.fromEntries(COUNTED_TABLES.map((table, index) => [table, counts[index].count])),
      commentThreads: counts[COUNTED_TABLES.indexOf("commentRooms")].threads,
    } as RecordCounts,
  };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
