import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertPublicAssets } from "./public-assets";
import { assetHistoryOrigin, carryPreviousAssets } from "./asset-history";
import { planVercelBuild, runVercelBuild, type StepRunner } from "./vercel-build-plan";

// Vercel's buildCommand. The step order lives in vercel-build-plan.ts:
// review public files, build and check everything, carry the previous
// production chunks for open tabs, and deploy Convex last.
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
  async task(step) {
    if (step.name === "public-assets") {
      assertPublicAssets(path.join(ROOT, "public"));
      return;
    }
    await carryPreviousAssets({
      // Overridable so the wiring test never writes into the real dist.
      distDir: process.env.WIKI_VERCEL_DIST_DIR || path.join(ROOT, "dist"),
      origin: assetHistoryOrigin(process.env),
      buildId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local",
    });
  },
};

process.exit(await runVercelBuild(planVercelBuild(process.env), runner));
