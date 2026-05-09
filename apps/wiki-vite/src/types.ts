export type MetricsStatus = "idle" | "syncing" | "ready" | "offline" | "error";

export type Metrics = {
  status: MetricsStatus;
  message: string;
  manifestBytes: number;
  markdownBytes: number;
  eventCount: number;
  opfsBytes: number | null;
  lastSyncMs: number | null;
};

export type MetricsPatch = Partial<Metrics>;

export type PageIndexRow = {
  slug: string;
  title: string;
  tagsJson: string;
  description: string | null;
  contentHash: string | null;
  sensitive: boolean;
  size: number;
};

export type PageContentStatus = "fresh" | "stale" | "missing" | "deleted";

export type PageContentRow = {
  slug: string;
  title: string;
  content: string;
  tagsJson: string;
  contentHash: string | null;
  expectedContentHash: string | null;
  sensitive: boolean;
  size: number;
  fetchedAt: number;
  missingAt: number | null;
  staleAt: number | null;
  deletedAt: number | null;
  contentStatus: PageContentStatus;
};

export type SiteStateRow = {
  siteSlug: string;
  scope: "public" | "session";
  manifestHash: string;
  generatedAt: string;
  lastSyncAt: number;
  manifestSize: number;
};
