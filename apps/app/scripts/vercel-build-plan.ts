// The Vercel build as an ordered list of steps, kept free of side effects so
// the ordering is unit-tested (vercel-build-plan.test.ts) without building or
// deploying anything. scripts/build-vercel.ts executes the plan.
//
// Order matters. Everything that can reject the release (public-asset review,
// typecheck, the app and function build, the server budget inside it, the
// bundle budget) runs first. The Convex deploy runs last and only if all of
// them passed, so a failed build can no longer leave new Convex functions
// serving the previous app. The app build therefore cannot learn its Convex
// URL from `convex deploy`; it is resolved up front from the deploy key, and
// the deploy step refuses to push if Convex reports a different URL.

export const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";

export type BuildEnv = Record<string, string | undefined>;

export type CommandStep = {
  kind: "command";
  name: "app-build" | "bundle-budget" | "convex-deploy";
  command: string;
  args: string[];
  env: BuildEnv;
};

export type TaskStep = {
  kind: "task";
  name: "public-assets";
};

export type BuildStep = CommandStep | TaskStep;

export type BuildPlan = {
  convexUrl: string;
  deploysConvex: boolean;
  notes: string[];
  steps: BuildStep[];
};

export function isPlaceholderConvexUrl(value: string) {
  return /^https:\/\/(example|placeholder)\./.test(value) || value.includes("placeholder");
}

/** The cloud URL a production deploy key targets, without contacting Convex. */
export function convexUrlFromDeployKey(deployKey: string | undefined): string | null {
  // Production deploy keys are "prod:<deployment-name>|<secret>". Only the
  // part before "|" is read; the secret never leaves the environment.
  const match = /^prod:([a-z0-9-]+)\|/.exec(deployKey?.trim() ?? "");
  return match ? `https://${match[1]}.convex.cloud` : null;
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Convex runs `--cmd` with the deployment's canonical URL after resolving the
 * target and before pushing any code; a non-zero exit aborts the push. Use
 * that hook to refuse a deploy whose URL differs from the one the app was
 * built against.
 */
export function convexUrlGuardCommand(expectedUrl: string) {
  return `test "$NEXT_PUBLIC_CONVEX_URL" = ${shellQuote(expectedUrl)} || ` +
    `{ echo "Convex reports $NEXT_PUBLIC_CONVEX_URL but the app was built for ${expectedUrl.replace(/["$`\\]/g, "")}; not deploying." >&2; exit 1; }`;
}

export function planVercelBuild(env: BuildEnv): BuildPlan {
  const production = env.VERCEL_ENV === "production";
  const deploysConvex = production && env.WIKI_DEPLOY_FRONTEND_ONLY !== "1";
  const notes: string[] = [];
  const fromEnv = env.NEXT_PUBLIC_CONVEX_URL?.trim() || "";
  const usableFromEnv = fromEnv && !isPlaceholderConvexUrl(fromEnv) ? fromEnv : "";

  let convexUrl: string;
  if (deploysConvex) {
    const fromKey = convexUrlFromDeployKey(env.CONVEX_DEPLOY_KEY);
    if (!fromKey) {
      throw new Error(
        "A production deploy needs a production CONVEX_DEPLOY_KEY (prod:<name>|...) to know which Convex URL to build against. " +
          "Set WIKI_DEPLOY_FRONTEND_ONLY=1 with NEXT_PUBLIC_CONVEX_URL to ship the app alone.",
      );
    }
    if (usableFromEnv && usableFromEnv !== fromKey) {
      notes.push(`NEXT_PUBLIC_CONVEX_URL (${usableFromEnv}) differs from the deploy key's deployment; building for ${fromKey}.`);
    }
    convexUrl = fromKey;
  } else if (production) {
    if (!usableFromEnv) {
      throw new Error("A frontend-only production deployment requires the current NEXT_PUBLIC_CONVEX_URL");
    }
    convexUrl = usableFromEnv;
    notes.push(`Skipping Convex deploy (WIKI_DEPLOY_FRONTEND_ONLY=1); using NEXT_PUBLIC_CONVEX_URL=${convexUrl}`);
  } else {
    convexUrl = usableFromEnv || PROD_CONVEX_FALLBACK_URL;
    notes.push(
      `Skipping Convex deploy (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}); using NEXT_PUBLIC_CONVEX_URL=${convexUrl}` +
        (usableFromEnv ? "" : " (fallback - env var was empty or placeholder)"),
    );
  }

  const steps: BuildStep[] = [
    { kind: "task", name: "public-assets" },
    {
      kind: "command",
      name: "app-build",
      // Typecheck, Vite build, then the function bundle with its server budget.
      command: "bun",
      args: ["run", "build"],
      env: { NEXT_PUBLIC_CONVEX_URL: convexUrl, CONVEX_URL: convexUrl, WIKI_VITE_EMBED_APP_SHELL: "1" },
    },
  ];

  if (env.WIKI_DEPLOY_SKIP_BUNDLE_BUDGET === "1") {
    notes.push("WIKI_DEPLOY_SKIP_BUNDLE_BUDGET=1: the bundle budget is NOT checked for this deployment.");
  } else {
    steps.push({ kind: "command", name: "bundle-budget", command: "bun", args: ["scripts/check-bundle-budget.ts"], env: {} });
  }

  if (deploysConvex) {
    steps.push({
      kind: "command",
      name: "convex-deploy",
      command: "npx",
      args: [
        "convex",
        "deploy",
        "--cmd-url-env-var-name",
        "NEXT_PUBLIC_CONVEX_URL",
        "--cmd",
        convexUrlGuardCommand(convexUrl),
      ],
      env: {},
    });
  }

  return { convexUrl, deploysConvex, notes, steps };
}

export type StepRunner = {
  command(step: CommandStep): number;
  task(step: TaskStep): Promise<void> | void;
};

/** Runs steps in order and stops at the first failure. Returns the exit code. */
export async function runVercelBuild(plan: BuildPlan, runner: StepRunner): Promise<number> {
  for (const note of plan.notes) console.log(note);
  for (const step of plan.steps) {
    if (step.kind === "task") {
      await runner.task(step);
      continue;
    }
    const status = runner.command(step);
    if (status !== 0) {
      console.error(`Vercel build step "${step.name}" failed (exit ${status}).` +
        (plan.deploysConvex && step.name !== "convex-deploy" ? " Convex was not deployed." : ""));
      return status;
    }
  }
  return 0;
}
