import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  convexUrlFromDeployKey,
  convexUrlGuardCommand,
  planVercelBuild,
  PROD_CONVEX_FALLBACK_URL,
  runVercelBuild,
  type BuildEnv,
  type StepRunner,
} from "./vercel-build-plan";

// Never a real key: the secret half is a placeholder.
const PROD_KEY = "prod:youthful-cricket-560|not-a-real-secret";
const production: BuildEnv = { VERCEL_ENV: "production", CONVEX_DEPLOY_KEY: PROD_KEY };

function names(env: BuildEnv) {
  return planVercelBuild(env).steps.map(step => step.name);
}

/** Records the order steps ran in; fails the named command. Runs nothing. */
function recorder(failing?: string) {
  const ran: string[] = [];
  const runner: StepRunner = {
    command(step) {
      ran.push(step.name);
      return step.name === failing ? 1 : 0;
    },
    task(step) {
      ran.push(step.name);
      if (step.name === failing) throw new Error(`${step.name} failed`);
    },
  };
  return { ran, runner };
}

describe("Vercel build order", () => {
  test("production checks everything, then deploys Convex last", () => {
    expect(names(production)).toEqual([
      "public-assets",
      "app-build",
      "bundle-budget",
      "carry-previous-assets",
      "convex-deploy",
    ]);
  });

  test("the app is built against the deploy key's Convex URL", () => {
    const plan = planVercelBuild(production);
    expect(plan.convexUrl).toBe(PROD_CONVEX_FALLBACK_URL);
    const build = plan.steps.find(step => step.name === "app-build");
    expect(build).toMatchObject({ command: "bun", args: ["run", "build"] });
    expect(build?.kind === "command" && build.env).toEqual({
      NEXT_PUBLIC_CONVEX_URL: PROD_CONVEX_FALLBACK_URL,
      CONVEX_URL: PROD_CONVEX_FALLBACK_URL,
      WIKI_VITE_EMBED_APP_SHELL: "1",
    });
  });

  for (const failing of ["public-assets", "app-build", "bundle-budget"]) {
    test(`a failed ${failing} never reaches the Convex deploy`, async () => {
      const { ran, runner } = recorder(failing);
      const outcome = runVercelBuild(planVercelBuild(production), runner);
      if (failing === "public-assets") await expect(outcome).rejects.toThrow();
      else expect(await outcome).toBe(1);
      expect(ran.at(-1)).toBe(failing);
      expect(ran).not.toContain("convex-deploy");
    });
  }

  test("a successful run executes every step once, in order", async () => {
    const { ran, runner } = recorder();
    expect(await runVercelBuild(planVercelBuild(production), runner)).toBe(0);
    expect(ran).toEqual(names(production));
  });

  test("previews and local builds never deploy Convex or carry assets", () => {
    for (const env of [{ VERCEL_ENV: "preview", CONVEX_DEPLOY_KEY: PROD_KEY }, {}]) {
      expect(names(env)).toEqual(["public-assets", "app-build", "bundle-budget"]);
      expect(planVercelBuild(env).deploysConvex).toBe(false);
    }
    expect(planVercelBuild({ VERCEL_ENV: "preview" }).convexUrl).toBe(PROD_CONVEX_FALLBACK_URL);
    expect(planVercelBuild({ VERCEL_ENV: "preview", NEXT_PUBLIC_CONVEX_URL: "https://a-b-1.convex.cloud" }).convexUrl)
      .toBe("https://a-b-1.convex.cloud");
  });

  test("a frontend-only production deploy skips Convex and needs a real URL", () => {
    const env = { ...production, WIKI_DEPLOY_FRONTEND_ONLY: "1" };
    expect(() => planVercelBuild(env)).toThrow(/requires the current NEXT_PUBLIC_CONVEX_URL/);
    expect(() => planVercelBuild({ ...env, NEXT_PUBLIC_CONVEX_URL: "https://placeholder.convex.cloud" })).toThrow();
    const plan = planVercelBuild({ ...env, NEXT_PUBLIC_CONVEX_URL: "https://x-y-2.convex.cloud" });
    expect(plan.steps.map(step => step.name)).toEqual(["public-assets", "app-build", "bundle-budget", "carry-previous-assets"]);
    expect(plan.convexUrl).toBe("https://x-y-2.convex.cloud");
  });

  test("production without a production deploy key fails before building", () => {
    expect(() => planVercelBuild({ VERCEL_ENV: "production" })).toThrow(/CONVEX_DEPLOY_KEY/);
    expect(() => planVercelBuild({ VERCEL_ENV: "production", CONVEX_DEPLOY_KEY: "preview:team:proj|x" })).toThrow();
  });

  test("the bundle budget can be skipped only explicitly, and says so", () => {
    const plan = planVercelBuild({ ...production, WIKI_DEPLOY_SKIP_BUNDLE_BUDGET: "1" });
    expect(plan.steps.map(step => step.name)).not.toContain("bundle-budget");
    expect(plan.steps.at(-1)?.name).toBe("convex-deploy");
    expect(plan.notes.join("\n")).toContain("NOT checked");
  });
});

describe("Convex deploy guard", () => {
  test("reads only the deployment name from a production key", () => {
    expect(convexUrlFromDeployKey(PROD_KEY)).toBe("https://youthful-cricket-560.convex.cloud");
    expect(convexUrlFromDeployKey(undefined)).toBeNull();
    expect(convexUrlFromDeployKey("dev:abc|x")).toBeNull();
    expect(convexUrlFromDeployKey("prod:abc")).toBeNull();
  });

  test("the deploy step passes the URL guard as Convex's pre-push command", () => {
    const deploy = planVercelBuild(production).steps.at(-1);
    expect(deploy).toMatchObject({
      name: "convex-deploy",
      command: "npx",
      args: ["convex", "deploy", "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL", "--cmd", convexUrlGuardCommand(PROD_CONVEX_FALLBACK_URL)],
    });
    expect(deploy?.kind === "command" && deploy.args).not.toContain("--dry-run");
  });

  // Convex runs --cmd through a shell with NEXT_PUBLIC_CONVEX_URL set to the
  // deployment's canonical URL, and aborts the push on a non-zero exit.
  test("the guard command passes only for the URL the app was built for", () => {
    const guard = convexUrlGuardCommand(PROD_CONVEX_FALLBACK_URL);
    const run = (url: string) => spawnSync(guard, { shell: true, env: { PATH: process.env.PATH, NEXT_PUBLIC_CONVEX_URL: url } });
    expect(run(PROD_CONVEX_FALLBACK_URL).status).toBe(0);
    const mismatch = run("https://other-deployment-1.convex.cloud");
    expect(mismatch.status).toBe(1);
    expect(String(mismatch.stderr)).toContain("not deploying");
  });
});

// The real entry point, with `bun` and `npx` replaced by stubs on PATH that
// only record their arguments. Nothing is built or deployed.
describe("build-vercel.ts wiring", () => {
  const script = path.join(import.meta.dir, "build-vercel.ts");

  function runEntry(env: BuildEnv, failing = "") {
    const dir = mkdtempSync(path.join(tmpdir(), "build-vercel-"));
    const bin = path.join(dir, "bin");
    const log = path.join(dir, "calls.log");
    mkdirSync(bin);
    mkdirSync(path.join(dir, "dist/assets"), { recursive: true });
    for (const name of ["bun", "npx"]) {
      const stub = path.join(bin, name);
      writeFileSync(stub, `#!/bin/sh\necho "${name} $* | url=$NEXT_PUBLIC_CONVEX_URL" >> "${log}"\ncase "$*" in *${failing || "__never__"}*) exit 3;; esac\nexit 0\n`);
      chmodSync(stub, 0o755);
    }
    const result = spawnSync(process.execPath, [script], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: process.env.HOME,
        WIKI_VERCEL_DIST_DIR: path.join(dir, "dist"),
        WIKI_ASSET_HISTORY_ORIGIN: "http://127.0.0.1:9",
        ...env,
      },
      encoding: "utf8",
    });
    let calls: string[] = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean); } catch { /* no calls */ }
    const historyWritten = (() => { try { readFileSync(path.join(dir, "dist/assets/asset-history.json")); return true; } catch { return false; } })();
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, calls, historyWritten, output: result.stdout + result.stderr };
  }

  test("production runs build, budget, then convex deploy against the built URL", () => {
    const { status, calls, historyWritten } = runEntry(production);
    expect(status).toBe(0);
    expect(calls.map(call => call.split(" | ")[0].split(" ").slice(0, 3).join(" "))).toEqual([
      "bun run build",
      "bun scripts/check-bundle-budget.ts",
      "npx convex deploy",
    ]);
    expect(calls[0]).toContain(`url=${PROD_CONVEX_FALLBACK_URL}`);
    expect(historyWritten).toBe(true);
  });

  test("a failing budget exits non-zero without calling convex", () => {
    const { status, calls } = runEntry(production, "check-bundle-budget");
    expect(status).toBe(3);
    expect(calls.some(call => call.startsWith("npx"))).toBe(false);
  });
});
