import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flattenMetrics, medians, renderSummary } from "./report";
import { checkBudgets, type BudgetFile } from "./stats";

test("flattenMetrics names metrics by scenario and skips non-numeric fields", () => {
  const metrics = flattenMetrics({
    loads: { mobile: { "signed-in-cold": [{ ok: true, articleMs: 7000 }, { ok: true, articleMs: 7400 }, { ok: false, articleMs: Number.NaN }] } },
    interactions: { cpu4: [{ navLargeLongestTaskMs: 600 }, { navLargeLongestTaskMs: 580 }] },
    polling: { manifestPerMinute: 2 },
  });
  expect(Object.keys(metrics).sort()).toEqual(["interaction.cpu4.navLargeLongestTaskMs", "load.mobile.signed-in-cold.articleMs", "polling.manifestPerMinute"]);
  expect(metrics["load.mobile.signed-in-cold.articleMs"]).toMatchObject({ median: 7200, n: 2 });
  expect(medians(metrics)["interaction.cpu4.navLargeLongestTaskMs"]).toBe(590);
});

test("the checked-in budgets name metrics the lab produces", () => {
  const file = JSON.parse(readFileSync(path.join(import.meta.dir, "budgets.json"), "utf8")) as BudgetFile;
  expect(Object.keys(file.budgets).sort()).toEqual([
    "interaction.cpu4.navLargeLongestTaskMs",
    "load.mobile.signed-in-cold.articleMs",
    "load.mobile.signed-in-cold.bytesBeforeArticle",
  ]);
  for (const budget of Object.values(file.budgets)) expect(budget.max).toBeGreaterThan(budget.baseline);
});

test("renderSummary shows budget status and load rows", () => {
  const metrics = flattenMetrics({ loads: { mobile: { "signed-in-cold": [{ articleMs: 7300, requests: 74, bytesBeforeArticle: 1_200_000 }] } }, interactions: {} });
  const { results } = checkBudgets(medians(metrics), { budgets: { "load.mobile.signed-in-cold.articleMs": { max: 7000, unit: "ms", baseline: 6000, description: "" } } });
  const md = renderSummary({ metrics, budgets: results, budgetsEnforced: false, iterations: { loads: 1, interactions: 1 } });
  expect(md).toContain("report-only");
  expect(md).toContain("over by 300 ms");
  expect(md).toContain("| mobile | signed-in-cold | 7,300 ms |");
});
