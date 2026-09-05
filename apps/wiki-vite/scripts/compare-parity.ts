import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { createRequire } from "node:module";
import type { JSONReport, JSONReportSuite } from "@playwright/test/reporter";
type PngImage = { width: number; height: number; data: Buffer };
const { PNG } = createRequire(import.meta.url)("pngjs") as {
  PNG: { new (size: { width: number; height: number }): PngImage; sync: { read(buffer: Buffer): PngImage; write(image: PngImage): Buffer } };
};

// Local-only evidence, never a screenshot-baseline updater. A numerical image
// difference is review evidence, not an automatic visual-parity pass.
if (process.env.CI) throw new Error("Private parity evidence must not be published by CI.");
const directory = path.resolve(process.argv[2] || "../../.playwright/shared-parity");
const report: JSONReport = JSON.parse(await fs.readFile(path.join(directory, "results.json"), "utf8"));
let safetyNotice = "";
try {
  const provenance = JSON.parse(await fs.readFile(path.join(directory, "provenance.json"), "utf8"));
  safetyNotice = provenance.observedSafetyIncident || "";
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
type Result = { status: string; trace?: string; contentContract?: string; images: Map<string, string> };
const pairs = new Map<string, { title: string; browser: string; next?: Result; vite?: Result }>();
function collect(suite: JSONReportSuite, parents: string[] = []) {
  for (const spec of suite.specs) {
    const title = [...parents, spec.title].join(" › ");
    for (const test of spec.tests) {
      const match = test.projectName.match(/^(next|vite)-(chromium|webkit)$/);
      if (!match) throw new Error(`Unknown parity project: ${test.projectName}`);
      const [, host, browser] = match;
      const key = `${spec.file}:${title}:${browser}`;
      const pair = pairs.get(key) || { title, browser };
      const result = test.results.at(-1);
      pair[host as "next" | "vite"] = {
        status: test.status === "expected" && result?.status === "passed" ? "passed" : result?.status || "not-run",
        trace: result?.attachments.find((a) => a.name === "trace")?.path,
        contentContract: result?.attachments.find((a) => a.name === "content-contract")?.body,
        images: new Map(result?.attachments.filter((a) => a.contentType === "image/png" && a.name !== "screenshot" && a.path)
          .map((a) => [a.name, a.path!])),
      };
      pairs.set(key, pair);
    }
  }
  for (const child of suite.suites || []) collect(child, [...parents, ...(suite.title ? [suite.title] : [])]);
}
for (const suite of report.suites) collect(suite);
const escape = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const href = (file: string) => path.relative(directory, file).split(path.sep).map(encodeURIComponent).join("/");
const cards: string[] = [];
const metrics: object[] = [];
let passedPairs = 0, matched = 0, missing = 0, traces = 0, missingTraces = 0, contentMismatches = 0;
await fs.mkdir(path.join(directory, "diffs"), { recursive: true });
for (const [key, pair] of pairs) {
  if (pair.next?.status === "passed" && pair.vite?.status === "passed") passedPairs++;
  const links: string[] = [];
  for (const host of ["next", "vite"] as const) {
    const result = pair[host];
    if (result?.trace) { await fs.access(result.trace); traces++; }
    else if (result?.status === "passed") missingTraces++;
    links.push(`${host}: ${escape(result?.status || "missing")} ${result?.trace ? `<a href="${href(result.trace)}">trace.zip</a>` : "(no trace)"}`);
  }
  const images: string[] = [];
  if (pair.next?.contentContract || pair.vite?.contentContract) {
    const equal = pair.next?.contentContract === pair.vite?.contentContract;
    if (!equal) contentMismatches++;
    images.push(`<p>Published manifest inventory and page SHA-256 hashes: ${equal ? "identical" : "MISMATCH or missing counterpart — inspect content-contract attachments"}</p>`);
  }
  const names = new Set([...(pair.next?.images.keys() || []), ...(pair.vite?.images.keys() || [])]);
  for (const name of names) {
    const next = pair.next?.images.get(name), vite = pair.vite?.images.get(name);
    let difference = "Missing counterpart — not comparable";
    let diffFile: string | undefined;
    let changedRatio: number | undefined;
    if (next && vite) {
      const a = PNG.sync.read(await fs.readFile(next)), b = PNG.sync.read(await fs.readFile(vite));
      if (a.width === b.width && a.height === b.height) {
        const diff = new PNG({ width: a.width, height: a.height });
        const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
        changedRatio = changed / (a.width * a.height);
        difference = `${(changedRatio * 100).toFixed(2)}% differing pixels (review only)`;
        diffFile = path.join(directory, "diffs", `${matched}.png`);
        await fs.writeFile(diffFile, PNG.sync.write(diff));
        matched++;
      } else { difference = "Viewport mismatch — not comparable"; missing++; }
    } else missing++;
    metrics.push({ key, checkpoint: name, next, vite, difference, changedRatio });
    images.push(`<h4>${escape(name)} — ${difference}</h4><div class="images">${[["Next", next], ["Vite", vite], ["Diff", diffFile]].map(([label, file]) => `<figure><figcaption>${label}</figcaption>${file ? `<a href="${href(file)}"><img loading="lazy" src="${href(file)}" alt="${label} ${escape(name)}"></a>` : "Missing checkpoint"}</figure>`).join("")}</div>`);
  }
  cards.push(`<details><summary>${escape(pair.browser)} · ${escape(pair.title)} — ${links.join(" / ")}</summary>${images.join("") || "API-only test; inspect its trace."}</details>`);
}
const summary = { pairs: pairs.size, passedPairs, nonPassingPairs: pairs.size - passedPairs, matchedCheckpoints: matched, missingCheckpoints: missing, traces, missingTraces, contentMismatches };
await fs.writeFile(path.join(directory, "comparisons.json"), JSON.stringify({ summary, safetyNotice, metrics }, null, 2));
const safetyBanner = safetyNotice ? `<aside role="alert" style="padding:16px;border:2px solid #a40000;background:#fff0f0"><strong>Run stopped — not release approval.</strong> ${escape(safetyNotice)}</aside>` : "";
await fs.writeFile(path.join(directory, "comparisons.html"), `<!doctype html><meta charset="utf-8"><title>Private shared parity evidence</title><style>body{font:14px system-ui;margin:24px;color:#172033;background:#fafafa}summary{padding:14px;cursor:pointer}details{border-top:1px solid #bbb}a{color:#165aab}.images{display:flex;align-items:flex-start;gap:8px}figure{margin:0;width:33%}img{width:100%;border:1px solid #ccc}h4{margin:16px 0 8px}</style><h1>Private shared parity evidence</h1>${safetyBanner}<p>${escape(JSON.stringify(summary))}</p><p>Same tests and checkpoints; no retries, baseline updates, previous-run substitutions, or host-specific test branches. Pixel differences require review and are not a visual pass. Authentication sessions and clinical content are private; do not upload traces.</p><p><a href="report/index.html">Playwright report and trace viewer</a></p>${cards.join("")}`);
console.log(summary);
if (!summary.pairs || summary.nonPassingPairs || summary.missingCheckpoints || missingTraces || contentMismatches || safetyNotice) process.exitCode = 1;
