import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The production promotion gate in wiki-vite-checks.yml (A3). It must wait
// for every other job, so a check added later cannot be skipped by accident.
type Job = { if?: string; needs?: string[]; steps: { run?: string; if?: string }[] };
const workflow = Bun.YAML.parse(
  readFileSync(new URL("../../../.github/workflows/wiki-vite-checks.yml", import.meta.url), "utf8"),
) as { jobs: Record<string, Job> };

test("promotion waits for every check and runs only for opted-in main pushes", () => {
  const promote = workflow.jobs.promote;
  expect(promote).toBeDefined();
  const others = Object.keys(workflow.jobs).filter(name => name !== "promote").sort();
  expect([...(promote.needs ?? [])].sort()).toEqual(others);
  expect(promote.if).toContain("github.ref == 'refs/heads/main'");
  expect(promote.if).toContain("github.event_name == 'push'");
  expect(promote.if).toContain("vars.WIKI_VITE_GATED_PROMOTION == 'true'");
});

test("promotion promotes the exact tested URL and only while it is main's tip", () => {
  const steps = workflow.jobs.promote.steps;
  const promoteStep = steps.find(step => step.run?.includes("vercel@"));
  expect(promoteStep?.if).toBe("steps.tip.outputs.current == 'true'");
  expect(promoteStep?.run).toContain('promote "${DEPLOYMENT_URL}"');
  // Pinned CLI, never a floating "latest".
  expect(promoteStep?.run).toMatch(/vercel@\d+\.\d+\.\d+ /);
  for (const step of steps) expect(step.run ?? "").not.toMatch(/vercel(@\S+)? deploy|convex deploy/);
});
