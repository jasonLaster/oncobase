export const DEFAULT_ELICIT_API_BASE_URL = "https://elicit.com/api/v2";

export type ElicitSearchKind = "papers" | "trials";
export type ElicitSearchMode = "semantic" | "keyword";
export type ElicitOutputFormat = "json" | "markdown";

const PAPER_TYPE_TAGS = [
  "Review",
  "Meta-Analysis",
  "Systematic Review",
  "RCT",
  "Longitudinal",
] as const;

const TRIAL_PHASES = [
  "NA",
  "EARLY_PHASE1",
  "PHASE1",
  "PHASE2",
  "PHASE3",
  "PHASE4",
] as const;

const TRIAL_STATUSES = [
  "ACTIVE_NOT_RECRUITING",
  "COMPLETED",
  "ENROLLING_BY_INVITATION",
  "NOT_YET_RECRUITING",
  "RECRUITING",
  "SUSPENDED",
  "TERMINATED",
  "WITHDRAWN",
  "AVAILABLE",
] as const;

type PaperTypeTag = (typeof PAPER_TYPE_TAGS)[number];
type TrialPhase = (typeof TRIAL_PHASES)[number];
type TrialStatus = (typeof TRIAL_STATUSES)[number];

export type ElicitCliOptions = {
  kind: ElicitSearchKind;
  query: string;
  maxResults: number;
  searchMode: ElicitSearchMode;
  format: ElicitOutputFormat;
  output?: string;
  corpus?: "elicit" | "pubmed";
  minYear?: number;
  maxYear?: number;
  maxQuartile?: number;
  includeKeywords: string[];
  excludeKeywords: string[];
  typeTags: PaperTypeTag[];
  hasPdf: boolean;
  retracted?: "include_retracted" | "only_retracted";
  phases: TrialPhase[];
  statuses: TrialStatus[];
  hasResults: boolean;
};

export type ElicitPaper = {
  elicitId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  pmid: string | null;
  venue: string | null;
  citedByCount: number | null;
  urls: string[];
  studyTypeTags: string[];
  journalQuartile: number | null;
  fullTextUrl: string | null;
};

export type ElicitTrial = {
  nctId: string;
  title: string;
  summary: string | null;
  url: string;
  overallStatus: string | null;
  phase: string[];
  studyType: string | null;
  enrollmentCount: number | null;
  conditions: string[];
  interventions: string[];
  leadSponsor: string | null;
  startDate: string | null;
  primaryCompletionDate: string | null;
  completionDate: string | null;
  hasResults: boolean | null;
  lastUpdatedYear: number | null;
};

export type ElicitWarning = {
  corpus: string;
  searchMode: string;
  message: string;
  warningDetails?: unknown;
};

type PaperSearchResponse = {
  papers: ElicitPaper[];
  warnings?: ElicitWarning[];
};

type TrialSearchResponse = {
  trials: ElicitTrial[];
  warnings?: ElicitWarning[];
};

export type ElicitSearchResponse = PaperSearchResponse | TrialSearchResponse;

export type ElicitSearchEnvelope = {
  schemaVersion: 1;
  provider: "Elicit API";
  endpoint: string;
  retrievedAt: string;
  request: Record<string, unknown>;
  response: ElicitSearchResponse;
};

function isPaperSearchResponse(
  response: ElicitSearchResponse,
): response is PaperSearchResponse {
  return "papers" in response;
}

const VALUE_FLAGS = new Set([
  "--query",
  "--max-results",
  "--search-mode",
  "--format",
  "--output",
  "--corpus",
  "--min-year",
  "--max-year",
  "--max-quartile",
  "--include-keyword",
  "--exclude-keyword",
  "--type-tag",
  "--phase",
  "--status",
]);

const BOOLEAN_FLAGS = new Set([
  "--has-pdf",
  "--include-retracted",
  "--only-retracted",
  "--has-results",
]);

function readFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readFlags(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    values.push(value);
  }
  return values.flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function readIntegerFlag(
  args: string[],
  name: string,
  options: { min: number; max: number },
) {
  const raw = readFlag(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw new Error(`${name} must be an integer from ${options.min} to ${options.max}.`);
  }
  return value;
}

function parseChoice<T extends string>(
  value: string | undefined,
  name: string,
  choices: readonly T[],
  fallback: T,
) {
  if (value === undefined) return fallback;
  if (!choices.includes(value as T)) {
    throw new Error(`${name} must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

function parseChoices<T extends string>(
  values: string[],
  name: string,
  choices: readonly T[],
) {
  for (const value of values) {
    if (!choices.includes(value as T)) {
      throw new Error(`${name} must be one of: ${choices.join(", ")}.`);
    }
  }
  return values as T[];
}

function positionalQuery(args: string[]) {
  const values: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) continue;
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    values.push(arg);
  }
  return values.join(" ").trim();
}

export function parseElicitArgs(args: string[]): ElicitCliOptions {
  const kind = args[0];
  if (kind !== "papers" && kind !== "trials") {
    throw new Error("Choose either papers or trials.");
  }

  const query = (readFlag(args, "--query") ?? positionalQuery(args)).trim();
  if (!query) throw new Error("Provide a search query.");

  const searchMode = parseChoice(
    readFlag(args, "--search-mode"),
    "--search-mode",
    ["semantic", "keyword"] as const,
    "semantic",
  );
  const format = parseChoice(
    readFlag(args, "--format"),
    "--format",
    ["json", "markdown"] as const,
    "json",
  );
  const maxResults =
    readIntegerFlag(args, "--max-results", { min: 1, max: 10_000 }) ?? 10;
  const minYear = readIntegerFlag(args, "--min-year", {
    min: 1000,
    max: 9999,
  });
  const maxYear = readIntegerFlag(args, "--max-year", {
    min: 1000,
    max: 9999,
  });
  if (minYear && maxYear && minYear > maxYear) {
    throw new Error("--min-year cannot be later than --max-year.");
  }

  const includeKeywords = readFlags(args, "--include-keyword");
  const excludeKeywords = readFlags(args, "--exclude-keyword");
  const typeTags = parseChoices(
    readFlags(args, "--type-tag"),
    "--type-tag",
    PAPER_TYPE_TAGS,
  );
  const phases = parseChoices(
    readFlags(args, "--phase"),
    "--phase",
    TRIAL_PHASES,
  );
  const statuses = parseChoices(
    readFlags(args, "--status"),
    "--status",
    TRIAL_STATUSES,
  );

  const corpus = parseChoice(
    readFlag(args, "--corpus"),
    "--corpus",
    ["elicit", "pubmed"] as const,
    "elicit",
  );
  const maxQuartile = readIntegerFlag(args, "--max-quartile", {
    min: 1,
    max: 4,
  });
  const hasPdf = args.includes("--has-pdf");
  const hasResults = args.includes("--has-results");
  const includeRetracted = args.includes("--include-retracted");
  const onlyRetracted = args.includes("--only-retracted");
  if (includeRetracted && onlyRetracted) {
    throw new Error("Use only one of --include-retracted or --only-retracted.");
  }

  const paperFiltersUsed = Boolean(
    minYear ||
      maxYear ||
      maxQuartile ||
      includeKeywords.length ||
      excludeKeywords.length ||
      typeTags.length ||
      hasPdf ||
      includeRetracted ||
      onlyRetracted,
  );
  const trialFiltersUsed = Boolean(phases.length || statuses.length || hasResults);

  if (kind === "papers" && trialFiltersUsed) {
    throw new Error("--phase, --status, and --has-results apply only to trials.");
  }
  if (kind === "trials" && (paperFiltersUsed || args.includes("--corpus"))) {
    throw new Error("Paper filters and --corpus apply only to papers.");
  }
  if (searchMode === "keyword" && (paperFiltersUsed || trialFiltersUsed)) {
    throw new Error(
      "Elicit does not allow filter options with --search-mode keyword; put filters in the query.",
    );
  }

  return {
    kind,
    query,
    maxResults,
    searchMode,
    format,
    output: readFlag(args, "--output"),
    corpus,
    minYear,
    maxYear,
    maxQuartile,
    includeKeywords,
    excludeKeywords,
    typeTags,
    hasPdf,
    retracted: onlyRetracted
      ? "only_retracted"
      : includeRetracted
        ? "include_retracted"
        : undefined,
    phases,
    statuses,
    hasResults,
  };
}

export function buildElicitRequest(options: ElicitCliOptions) {
  const request: Record<string, unknown> = {
    query: options.query,
    searchMode: options.searchMode,
    maxResults: options.maxResults,
  };

  if (options.kind === "papers") {
    request.corpus = options.corpus;
    const filters: Record<string, unknown> = {};
    if (options.minYear !== undefined) filters.minYear = options.minYear;
    if (options.maxYear !== undefined) filters.maxYear = options.maxYear;
    if (options.maxQuartile !== undefined) filters.maxQuartile = options.maxQuartile;
    if (options.includeKeywords.length) {
      filters.includeKeywords = options.includeKeywords;
    }
    if (options.excludeKeywords.length) {
      filters.excludeKeywords = options.excludeKeywords;
    }
    if (options.typeTags.length) filters.typeTags = options.typeTags;
    if (options.hasPdf) filters.hasPdf = true;
    if (options.retracted) filters.retracted = options.retracted;
    if (Object.keys(filters).length) request.filters = filters;
  } else {
    const trialFilters: Record<string, unknown> = {};
    if (options.phases.length) trialFilters.phase = options.phases;
    if (options.statuses.length) {
      trialFilters.recruitmentStatus = options.statuses;
    }
    if (options.hasResults) trialFilters.hasResults = true;
    if (Object.keys(trialFilters).length) request.trialFilters = trialFilters;
  }

  return request;
}

function errorMessage(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string" ? `${error}: ${message}` : error;
  }
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code === "string" && typeof message === "string") {
      return `${code}: ${message}`;
    }
    if (typeof message === "string") return message;
  }
  return undefined;
}

export async function searchElicit(
  options: ElicitCliOptions,
  apiKey: string,
  dependencies: {
    fetch?: typeof fetch;
    now?: () => Date;
    baseUrl?: string;
  } = {},
): Promise<ElicitSearchEnvelope> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const baseUrl = (dependencies.baseUrl ?? DEFAULT_ELICIT_API_BASE_URL).replace(
    /\/$/,
    "",
  );
  const endpoint = `${baseUrl}/search/${options.kind}`;
  const request = buildElicitRequest(options);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const detail =
      errorMessage(body) || text.slice(0, 500) || "No error detail returned";
    throw new Error(`Elicit request failed (${response.status}): ${detail}`);
  }
  const results = (body as Record<string, unknown> | undefined)?.[options.kind];
  if (!Array.isArray(results)) {
    throw new Error(`Elicit response did not contain a ${options.kind} array.`);
  }

  return {
    schemaVersion: 1,
    provider: "Elicit API",
    endpoint,
    retrievedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    request,
    response: body as ElicitSearchResponse,
  };
}

function markdownText(value: string) {
  return value.replace(/([\\[\]*_])/g, "\\$1");
}

function markdownLink(label: string, url: string) {
  return `[${markdownText(label)}](${url.replace(/\)/g, "%29")})`;
}

function paperLinks(paper: ElicitPaper) {
  const links = new Map<string, string>();
  if (paper.doi) links.set("DOI", `https://doi.org/${paper.doi}`);
  if (paper.pmid) {
    links.set("PubMed", `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`);
  }
  if (paper.fullTextUrl) links.set("Full text", paper.fullTextUrl);
  paper.urls.forEach((url, index) => links.set(`Source ${index + 1}`, url));
  return [...links].map(([label, url]) => markdownLink(label, url)).join(" · ");
}

function renderPaper(paper: ElicitPaper, index: number) {
  const metadata = [
    paper.year ? `**Year:** ${paper.year}` : undefined,
    paper.venue ? `**Venue:** ${markdownText(paper.venue)}` : undefined,
    paper.citedByCount !== null ? `**Cited by:** ${paper.citedByCount}` : undefined,
    paper.journalQuartile !== null
      ? `**Journal quartile:** Q${paper.journalQuartile}`
      : undefined,
  ].filter(Boolean);
  const identifiers = [
    paper.doi ? `DOI ${markdownText(paper.doi)}` : undefined,
    paper.pmid ? `PMID ${markdownText(paper.pmid)}` : undefined,
    paper.elicitId ? `Elicit ${markdownText(paper.elicitId)}` : undefined,
  ].filter(Boolean);
  const links = paperLinks(paper);

  return [
    `## ${index + 1}. ${markdownText(paper.title || "Untitled paper")}`,
    "",
    metadata.length ? `- ${metadata.join(" · ")}` : undefined,
    paper.authors.length
      ? `- **Authors:** ${paper.authors.map(markdownText).join(", ")}`
      : undefined,
    identifiers.length ? `- **Identifiers:** ${identifiers.join(" · ")}` : undefined,
    paper.studyTypeTags.length
      ? `- **Study types:** ${paper.studyTypeTags.map(markdownText).join(", ")}`
      : undefined,
    links ? `- **Links:** ${links}` : undefined,
    "",
    paper.abstract ? "### Abstract" : undefined,
    paper.abstract ? "" : undefined,
    paper.abstract?.trim(),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function renderTrial(trial: ElicitTrial, index: number) {
  const dates = [
    trial.startDate ? `start ${trial.startDate}` : undefined,
    trial.primaryCompletionDate
      ? `primary completion ${trial.primaryCompletionDate}`
      : undefined,
    trial.completionDate ? `completion ${trial.completionDate}` : undefined,
  ].filter(Boolean);

  return [
    `## ${index + 1}. ${markdownText(trial.title || "Untitled trial")}`,
    "",
    `- **Record:** ${markdownLink(trial.nctId, trial.url)}`,
    trial.overallStatus ? `- **Status:** ${markdownText(trial.overallStatus)}` : undefined,
    trial.phase.length ? `- **Phase:** ${trial.phase.map(markdownText).join(", ")}` : undefined,
    trial.studyType ? `- **Study type:** ${markdownText(trial.studyType)}` : undefined,
    trial.enrollmentCount !== null
      ? `- **Enrollment:** ${trial.enrollmentCount}`
      : undefined,
    trial.conditions.length
      ? `- **Conditions:** ${trial.conditions.map(markdownText).join(", ")}`
      : undefined,
    trial.interventions.length
      ? `- **Interventions:** ${trial.interventions.map(markdownText).join(", ")}`
      : undefined,
    trial.leadSponsor
      ? `- **Lead sponsor:** ${markdownText(trial.leadSponsor)}`
      : undefined,
    dates.length ? `- **Dates:** ${dates.join(" · ")}` : undefined,
    trial.hasResults !== null
      ? `- **Posted results:** ${trial.hasResults ? "yes" : "no"}`
      : undefined,
    trial.lastUpdatedYear !== null
      ? `- **Last updated year:** ${trial.lastUpdatedYear}`
      : undefined,
    "",
    trial.summary ? "### Summary" : undefined,
    trial.summary ? "" : undefined,
    trial.summary?.trim(),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function formatElicitMarkdown(envelope: ElicitSearchEnvelope) {
  let kind: ElicitSearchKind;
  let resultCount: number;
  let sections: string[];
  if (isPaperSearchResponse(envelope.response)) {
    kind = "papers";
    resultCount = envelope.response.papers.length;
    sections = envelope.response.papers.map(renderPaper);
  } else {
    kind = "trials";
    resultCount = envelope.response.trials.length;
    sections = envelope.response.trials.map(renderTrial);
  }
  const warnings = envelope.response.warnings ?? [];
  const title = `Elicit ${kind === "papers" ? "paper" : "clinical-trial"} search: ${String(envelope.request.query)}`;

  return [
    "---",
    "source: elicit-api",
    `retrieved: ${envelope.retrievedAt}`,
    `query: ${JSON.stringify(envelope.request.query)}`,
    `resultType: ${kind}`,
    `resultCount: ${resultCount}`,
    "---",
    "",
    `# ${markdownText(title)}`,
    "",
    "> Discovery output from Elicit. Verify decision-relevant claims against the linked primary sources and current registries.",
    "",
    `- **Retrieved:** ${envelope.retrievedAt}`,
    `- **Search mode:** ${envelope.request.searchMode}`,
    `- **Maximum results requested:** ${envelope.request.maxResults}`,
    kind === "papers" ? `- **Corpus:** ${envelope.request.corpus}` : undefined,
    warnings.length ? "" : undefined,
    warnings.length ? "## API warnings" : undefined,
    warnings.length ? "" : undefined,
    ...warnings.map((warning) => `- ${markdownText(warning.message)}`),
    sections.length ? "" : undefined,
    ...sections,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function formatElicitOutput(
  envelope: ElicitSearchEnvelope,
  format: ElicitOutputFormat,
) {
  return format === "markdown"
    ? formatElicitMarkdown(envelope)
    : `${JSON.stringify(envelope, null, 2)}\n`;
}
