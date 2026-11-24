#!/usr/bin/env bun
/**
 * Reader performance lab. See README.md in this directory.
 *
 *   bun run perf:lab                       # full run: stack up, publish, measure, check, tear down
 *   bun run perf:lab --quick               # one iteration of loads and interactions, no polling
 *   bun run perf:lab check [--results <file>] [--report-only]
 *
 * Run options:
 *   --only loads,interactions,polling      scenario groups (default: all)
 *   --profiles desktop,mobile              load profiles (default: both)
 *   --iterations <n>                       load iterations (default 5; --quick 1)
 *   --interaction-iterations <n>           interaction iterations (default 3; --quick 1)
 *   --poll-seconds <n>                     polling window (default 120)
 *   --out <file>                           JSON results (default .local-stack/perf-lab/results.json)
 *   --summary <file>                       Markdown summary (default next to --out)
 *   --budgets <file>                       budgets (default scripts/perf-lab/budgets.json)
 *   --report-only                          print the budget check but exit 0 when over budget
 *   --no-build                             reuse the stack's existing reader dist instead of rebuilding it
 *   --base <url>                           measure an already-running, already-published server; no stack
 *   --scale lab|prod                       synthetic vault: lab (default, the budgets' baseline) or prod
 *                                          (production-shaped, ~8.7k pages and ~14k assets; budgets report-only,
 *                                          results default to results-prod.json)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser, type Browser, type ProfileName } from "./browser";
import { CPU_RATES, runInteractionIteration } from "./interactions";
import { runLoadIteration } from "./loads";
import { runPolling } from "./polling";
import { flattenMetrics, medians, renderSummary, type Samples } from "./report";
import { LAB_DIR, startStack, type Stack } from "./stack";
import { checkBudgets, type BudgetFile, type Summary } from "./stats";
import { buildVault, DEFAULT_SEED, VAULT_SCALES, type VaultScale } from "./vault";

const DEFAULT_BUDGETS = path.join(import.meta.dir, "budgets.json");
const DEFAULT_OUT = path.join(LAB_DIR, "results.json");
const GROUPS = ["loads", "interactions", "polling"] as const;
type Group = (typeof GROUPS)[number];

const argv = process.argv.slice(2);
const command = argv[0] === "check" ? "check" : "run";
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
};
const count = (name: string, fallback: number) => {
  const value = option(name);
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
};
const log = (message: string) => console.log(`[perf-lab] ${message}`);
const KNOWN_FLAGS = {
  run: ["quick", "report-only", "no-build"],
  check: ["report-only"],
};
const KNOWN_OPTIONS = {
  run: ["only", "profiles", "iterations", "interaction-iterations", "poll-seconds", "out", "summary", "budgets", "base", "scale"],
  check: ["results", "budgets"],
};
function validateArgs() {
  for (let i = command === "check" ? 1 : 0; i < argv.length; i++) {
    const name = argv[i]!.replace(/^--/, "");
    if (!argv[i]!.startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`);
    if (KNOWN_OPTIONS[command].includes(name)) i++;
    else if (!KNOWN_FLAGS[command].includes(name)) throw new Error(`Unknown option --${name} for ${command}; see the header of scripts/perf-lab/index.ts`);
  }
}

type Results = {
  schemaVersion: 1;
  generatedAt: string;
  durationSeconds: number;
  git: { commit: string; dirty: boolean };
  machine: { platform: string; arch: string; cpus: number; memoryGb: number; chromium: string; ci: boolean };
  config: { quick: boolean; groups: Group[]; profiles: ProfileName[]; loadIterations: number; interactionIterations: number; pollSeconds: number };
  vault: ReturnType<typeof buildVault>["stats"];
  failedSamples: string[];
  metrics: Record<string, Summary>;
  budgets?: ReturnType<typeof checkBudgets> & { enforced: boolean };
};

function git() {
  const sha = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout.trim().length > 0;
  return { commit: sha || "unknown", dirty };
}

function readBudgets(file: string) {
  return JSON.parse(readFileSync(file, "utf8")) as BudgetFile;
}

/** A budget's scenario was not part of this run (`--only`, `--profiles`, `--quick` without polling). */
function notRun(config: Results["config"]) {
  return (metric: string) => {
    const [kind, scope] = metric.split(".");
    if (kind === "load") return !config.groups.includes("loads") || !config.profiles.includes(scope as ProfileName);
    if (kind === "interaction") return !config.groups.includes("interactions");
    if (kind === "polling") return config.pollSeconds === 0;
    return false;
  };
}

/** Print the check and return whether the process should fail. */
function reportBudgets(results: Results, budgetsFile: string, reportOnly: boolean) {
  const check = checkBudgets(medians(results.metrics), readBudgets(budgetsFile), notRun(results.config));
  for (const r of check.results) {
    if (r.status === "skipped") { log(`budget SKIPPED ${r.metric} (not run)`); continue; }
    const shown = r.unit === "bytes" ? `${Math.round(r.value / 1024)} KB / ${Math.round(r.max / 1024)} KB` : `${Math.round(r.value)} ms / ${r.max} ms`;
    log(`budget ${r.status.toUpperCase().padEnd(7)} ${r.metric}  ${shown}`);
  }
  if (!check.ok) log(reportOnly ? "over budget (report-only: not failing)" : "over budget");
  return { check, fail: !check.ok && !reportOnly };
}

async function runLab() {
  const started = performance.now();
  const quick = flag("quick");
  const groups = (option("only")?.split(",") ?? [...GROUPS]) as Group[];
  for (const g of groups) if (!GROUPS.includes(g)) throw new Error(`Unknown group ${g}; expected ${GROUPS.join(", ")}`);
  const profiles = (option("profiles")?.split(",") ?? ["desktop", "mobile"]) as ProfileName[];
  for (const p of profiles) if (p !== "desktop" && p !== "mobile") throw new Error(`Unknown profile ${p}`);
  const loadIterations = count("iterations", quick ? 1 : 5);
  const interactionIterations = count("interaction-iterations", quick ? 1 : 3);
  const pollSeconds = count("poll-seconds", 120);
  const runPoll = groups.includes("polling") && !quick && pollSeconds > 0;
  const scale = (option("scale") ?? "lab") as VaultScale;
  if (!VAULT_SCALES.includes(scale)) throw new Error(`Unknown scale ${scale}; expected ${VAULT_SCALES.join(", ")}`);
  const out = path.resolve(option("out") ?? (scale === "lab" ? DEFAULT_OUT : DEFAULT_OUT.replace(/\.json$/, `-${scale}.json`)));
  const summaryPath = path.resolve(option("summary") ?? out.replace(/\.json$/, "") + ".md");
  const budgetsFile = path.resolve(option("budgets") ?? DEFAULT_BUDGETS);
  // The budgets are lab-scale baselines; other scales are reported, never enforced.
  const reportOnly = flag("report-only") || scale !== "lab";
  const externalBase = option("base");

  let stack: Stack | undefined;
  let browser: Browser | undefined;
  const shutdown = async () => {
    await browser?.close().catch(() => undefined);
    await stack?.stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { log(`${signal}: shutting down`); void shutdown().finally(() => process.exit(130)); });
  }

  try {
    let base: string;
    let vault = buildVault(DEFAULT_SEED, scale).stats;
    if (externalBase) {
      base = externalBase.replace(/\/$/, "");
      if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("--base must be a loopback URL");
    } else {
      stack = await startStack({ build: !flag("no-build"), scale });
      base = stack.base;
      vault = stack.vault;
    }
    browser = await launchBrowser();
    const samples: Samples = { loads: {}, interactions: {} };
    const failed: string[] = [];

    // Unmeasured warm-up: fills server-side caches and the proxy's gzip cache
    // so the first measured cold load does not pay for them.
    log("warm-up load (not measured)");
    await runLoadIteration(browser, base, "desktop");

    if (groups.includes("loads")) {
      // Alternate profiles within each iteration so slow drift hits both alike.
      for (let i = 0; i < loadIterations; i++) {
        for (const profile of profiles) {
          const t = performance.now();
          const result = await runLoadIteration(browser, base, profile);
          for (const [scenario, sample] of Object.entries(result)) {
            ((samples.loads[profile] ??= {})[scenario] ??= []).push(sample);
            if (!sample.ok) failed.push(`load ${profile} ${scenario} #${i + 1}`);
          }
          const cold = result["signed-in-cold"];
          log(`loads ${profile} ${i + 1}/${loadIterations}: signed-in cold article ${cold.articleMs} ms, tree ${cold.treeMs} ms, manifest ${cold.manifestMs} ms (${Math.round(cold.manifestBytes / 1024)} KB), blocking ${cold.blockingMs} ms, ${Math.round(cold.bytesBeforeArticle / 1024)} KB before article; warm ${result["signed-in-warm"].articleMs} ms; landing LCP ${result["landing-cold"].lcpMs} ms (${((performance.now() - t) / 1000).toFixed(0)}s)`);
        }
      }
    }
    if (groups.includes("interactions")) {
      for (let i = 0; i < interactionIterations; i++) {
        for (const cpu of CPU_RATES) {
          const sample = await runInteractionIteration(browser, base, cpu);
          (samples.interactions[`cpu${cpu}`] ??= []).push(sample);
          if (!Number.isFinite(sample.navLargeMs) || !Number.isFinite(sample.navSmallMs)) failed.push(`interactions cpu${cpu} #${i + 1}`);
          log(`interactions ${cpu}x ${i + 1}/${interactionIterations}: expand ${sample.treeExpandMs} ms, 10 KB nav ${sample.navSmallMs} ms, 279 KB nav ${sample.navLargeMs} ms (longest task ${sample.navLargeLongestTaskMs} ms), keystroke ${sample.paletteKeystrokeMs} ms`);
        }
      }
    }
    if (runPoll) {
      log(`polling: watching a visible idle tab for ${pollSeconds}s`);
      samples.polling = await runPolling(browser, base, pollSeconds);
      log(`polling: ${samples.polling.manifestRequests} manifest requests (${samples.polling.manifestPerMinute}/min)`);
    }

    const chromium = browser.version();
    await shutdown();
    browser = undefined;
    stack = undefined;

    const metrics = flattenMetrics(samples);
    const results: Results = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      durationSeconds: Math.round((performance.now() - started) / 1000),
      git: git(),
      machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), chromium, ci: !!process.env.CI },
      config: { quick, groups, profiles, loadIterations, interactionIterations, pollSeconds: runPoll ? pollSeconds : 0 },
      vault,
      failedSamples: failed,
      metrics,
    };
    const { check, fail } = reportBudgets(results, budgetsFile, reportOnly);
    results.budgets = { ...check, enforced: !reportOnly };
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 1) + "\n");
    const summary = renderSummary({
      metrics, budgets: check.results, budgetsEnforced: !reportOnly,
      iterations: { loads: loadIterations, interactions: interactionIterations },
      header: `${results.git.commit}${results.git.dirty ? "+dirty" : ""}, ${results.machine.platform}/${results.machine.arch}, ${results.machine.cpus} CPUs, ${scale}-scale vault (${vault.pages} pages, ${vault.assets} assets)`,
    });
    mkdirSync(path.dirname(summaryPath), { recursive: true });
    writeFileSync(summaryPath, summary + "\n");
    console.log("\n" + summary);
    if (failed.length) log(`samples that never became ready: ${failed.join("; ")}`);
    log(`wrote ${out} and ${summaryPath} in ${results.durationSeconds}s`);
    return fail || failed.length > 0 ? 1 : 0;
  } finally {
    await shutdown();
  }
}

function runCheck() {
  const file = path.resolve(option("results") ?? DEFAULT_OUT);
  const results = JSON.parse(readFileSync(file, "utf8")) as Results;
  const { fail } = reportBudgets(results, path.resolve(option("budgets") ?? DEFAULT_BUDGETS), flag("report-only"));
  return fail ? 1 : 0;
}

try {
  validateArgs();
  process.exit(command === "check" ? runCheck() : await runLab());
} catch (error) {
  console.error(`[perf-lab] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
}
