/**
 * axe-core on every surface x theme x viewport, all impact levels, WCAG 2.0-2.2 A/AA tags.
 *
 * Ratchet: known-axe-violations.json records today's backlog as surface key -> rule -> nodes.
 * A test fails on a rule not in the file, on a node count that grew, and on a recorded rule
 * that shrank or disappeared (so the fix is locked in by shrinking the file).
 */
import axe from "axe-core";
import { expect, test } from "@playwright/test";
import { surfaceCases } from "./surfaces";
import { RATCHET_HINT, UPDATE_RATCHET, newSurfaceContext, openSurface, readJSON, writeFragment } from "./support";
import { RATCHET_FILES } from "./ratchet-teardown";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Violation = { impact: string | null; nodes: number; help: string; samples: string[] };
type Recorded = Record<string, Record<string, { impact: string | null; nodes: number }>>;

const known = readJSON<Recorded>(RATCHET_FILES.axe!, {});

for (const { surface, theme, viewport, key } of surfaceCases()) {
  test(`axe ${key}`, async ({ browser }) => {
    const context = await newSurfaceContext(browser, { auth: surface.auth, theme, viewport });
    try {
      const page = await context.newPage();
      await openSurface(page, surface);
      await page.addScriptTag({ content: axe.source });
      const found = await page.evaluate(async (tags) => {
        type AxeResult = { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[] }> }> };
        const run = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<AxeResult> } }).axe.run;
        const result = await run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: tags } });
        return Object.fromEntries(result.violations.map((violation) => [violation.id, {
          impact: violation.impact,
          nodes: violation.nodes.length,
          help: violation.help,
          samples: violation.nodes.slice(0, 3).map((node) => node.target.map(String).join(" ")),
        }]));
      }, AXE_TAGS) as Record<string, Violation>;

      if (UPDATE_RATCHET) {
        const entries = Object.entries(found);
        writeFragment("axe", key, entries.length
          ? Object.fromEntries(entries.map(([rule, violation]) => [rule, { impact: violation.impact, nodes: violation.nodes }]))
          : null);
        return;
      }

      const recorded = known[key] ?? {};
      const problems: string[] = [];
      for (const [rule, violation] of Object.entries(found)) {
        const before = recorded[rule];
        if (!before) problems.push(`NEW ${rule} (${violation.impact}, ${violation.nodes} nodes): ${violation.help} — e.g. ${violation.samples.join(" | ")}`);
        else if (violation.nodes > before.nodes) problems.push(`GREW ${rule}: ${before.nodes} -> ${violation.nodes} nodes — e.g. ${violation.samples.join(" | ")}`);
      }
      const fixed = Object.entries(recorded)
        .filter(([rule, before]) => (found[rule]?.nodes ?? 0) < before.nodes)
        .map(([rule, before]) => `${rule}: ${before.nodes} -> ${found[rule]?.nodes ?? 0} nodes`);
      expect(problems, `New or worse accessibility violations on ${key}`).toEqual([]);
      expect(fixed, `Recorded violations improved on ${key}. ${RATCHET_HINT}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
