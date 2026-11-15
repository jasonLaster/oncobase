import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertPublicAssets } from "./public-assets";
import { planVercelBuild, runVercelBuild, type StepRunner } from "./vercel-build-plan";

// Vercel's buildCommand. The step order lives in vercel-build-plan.ts:
// review public files, build and check everything, and deploy Convex last.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const runner: StepRunner = {
  command(step) {
    const result = spawnSync(step.command, step.args, {
      cwd: ROOT,
      env: { ...process.env, ...step.env },
      stdio: "inherit",
    });
    return result.status ?? 1;
  },
  task() {
    assertPublicAssets(path.join(ROOT, "public"));
  },
};

process.exit(await runVercelBuild(planVercelBuild(process.env), runner));
