// Pure result shaping: flatten samples into named metrics and render the Markdown summary.
import { summarize, type BudgetResult, type Summary } from "./stats";

export type Samples = {
  /** loads[profile][scenario] = one record per iteration */
  loads: Record<string, Record<string, Array<Record<string, number | boolean>>>>;
  /** interactions[`cpu${n}`] = one record per iteration */
  interactions: Record<string, Array<Record<string, number>>>;
  polling?: Record<string, number>;
};

/** Metric keys: load.<profile>.<scenario>.<field>, interaction.cpu<n>.<field>, polling.<field>. */
export function flattenMetrics(samples: Samples): Record<string, Summary> {
  const out: Record<string, Summary> = {};
  const add = (prefix: string, records: Array<Record<string, number | boolean>>) => {
    const fields = new Set(records.flatMap((r) => Object.keys(r)));
    for (const field of fields) {
      if (records.some((r) => typeof r[field] !== "number" && r[field] !== undefined)) continue;
      out[`${prefix}.${field}`] = summarize(records.map((r) => (typeof r[field] === "number" ? (r[field] as number) : Number.NaN)));
    }
  };
  for (const [profile, scenarios] of Object.entries(samples.loads)) for (const [scenario, records] of Object.entries(scenarios)) add(`load.${profile}.${scenario}`, records);
  for (const [cpu, records] of Object.entries(samples.interactions)) add(`interaction.${cpu}`, records);
  if (samples.polling) add("polling", [samples.polling]);
  return out;
}

export const medians = (metrics: Record<string, Summary>) => Object.fromEntries(Object.entries(metrics).map(([k, s]) => [k, s.median]));

const kb = (bytes: number) => (Number.isFinite(bytes) ? `${Math.round(bytes / 1024).toLocaleString("en-US")} KB` : "–");
const ms = (value: number) => (Number.isFinite(value) ? `${Math.round(value).toLocaleString("en-US")} ms` : "–");
const plain = (value: number) => (Number.isFinite(value) ? String(Math.round(value)) : "–");

function cell(metrics: Record<string, Summary>, key: string, format: (n: number) => string) {
  const s = metrics[key];
  if (!s || !s.n) return "–";
  return s.n > 1 && s.min !== s.max ? `${format(s.median)} <sub>${format(s.min)}–${format(s.max)}</sub>` : format(s.median);
}

export function formatValue(value: number, unit: "ms" | "bytes") {
  return unit === "ms" ? ms(value) : kb(value);
}

export function renderSummary(input: { metrics: Record<string, Summary>; budgets: BudgetResult[]; budgetsEnforced: boolean; iterations: { loads: number; interactions: number }; header?: string }): string {
  const { metrics } = input;
  const lines: string[] = [];
  lines.push(`## Reader perf lab${input.header ? ` — ${input.header}` : ""}`, "");
  lines.push(`Medians over ${input.iterations.loads} load and ${input.iterations.interactions} interaction iteration(s); small text is the range. Loopback server: compare runs, do not read absolute numbers as production.`, "");

  if (input.budgets.length) {
    lines.push(`### Budgets (${input.budgetsEnforced ? "enforced" : "report-only"})`, "", "| Metric | Median | Budget | Status |", "| --- | ---: | ---: | --- |");
    for (const r of input.budgets) lines.push(`| \`${r.metric}\` | ${formatValue(r.value, r.unit)} | ${formatValue(r.max, r.unit)} | ${r.status === "pass" ? "pass" : r.status === "fail" ? `**over by ${formatValue(r.overBy, r.unit)}**` : r.status === "skipped" ? "not run" : "**missing**"} |`);
    lines.push("");
  }

  const loadRows = Object.keys(metrics).filter((k) => k.startsWith("load.") && k.endsWith(".requests")).map((k) => k.slice(0, -".requests".length));
  if (loadRows.length) {
    lines.push("### Loads", "", "| Profile | Scenario | Article | Tree | LCP | Manifest | Blocking | Requests | Transferred | JS (files) | Before article |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const prefix of loadRows) {
      const [, profile, scenario] = prefix.split(".");
      const files = metrics[`${prefix}.jsFiles`];
      lines.push(`| ${profile} | ${scenario} | ${cell(metrics, `${prefix}.articleMs`, ms)} | ${cell(metrics, `${prefix}.treeMs`, ms)} | ${cell(metrics, `${prefix}.lcpMs`, ms)} | ${cell(metrics, `${prefix}.manifestMs`, ms)} (${metrics[`${prefix}.manifestBytes`] ? kb(metrics[`${prefix}.manifestBytes`]!.median) : "–"}) | ${cell(metrics, `${prefix}.blockingMs`, ms)} | ${cell(metrics, `${prefix}.requests`, plain)} | ${cell(metrics, `${prefix}.bytes`, kb)} | ${cell(metrics, `${prefix}.jsBytes`, kb)} (${files ? plain(files.median) : "–"}) | ${cell(metrics, `${prefix}.bytesBeforeArticle`, kb)} |`);
    }
    lines.push("", "Before article: bytes received before the article first appeared, partial bodies included (landing: before LCP). Manifest: when the full manifest finished arriving, and its size (signed-in). Blocking: long-task time over 50 ms during the load and settle window.", "");
  }

  const cpus = [...new Set(Object.keys(metrics).filter((k) => k.startsWith("interaction.")).map((k) => k.split(".")[1]!))].sort();
  if (cpus.length) {
    const rows: Array<[string, string]> = [
      ["Tree folder expand", "treeExpandMs"], ["Navigate to ~10 KB page", "navSmallMs"], ["Navigate to 279 KB page", "navLargeMs"],
      ["Longest task, 279 KB navigation", "navLargeLongestTaskMs"], ["Palette open", "paletteOpenMs"], ["Palette keystroke (event duration)", "paletteKeystrokeMs"],
    ];
    lines.push("### Interactions (desktop, signed in)", "", `| Interaction | ${cpus.map((c) => `${c.replace("cpu", "")}× CPU`).join(" | ")} |`, `| --- | ${cpus.map(() => "---:").join(" | ")} |`);
    for (const [label, field] of rows) lines.push(`| ${label} | ${cpus.map((c) => cell(metrics, `interaction.${c}.${field}`, ms)).join(" | ")} |`);
    lines.push("");
  }

  const poll = metrics["polling.manifestRequests"];
  if (poll) lines.push("### Polling", "", `${plain(poll.median)} manifest requests in ${plain(metrics["polling.windowSeconds"]!.median)} s on a visible idle tab (${metrics["polling.manifestPerMinute"]!.median}/min, ${plain(metrics["polling.manifestNotModified"]!.median)} were 304).`, "");
  return lines.join("\n");
}
