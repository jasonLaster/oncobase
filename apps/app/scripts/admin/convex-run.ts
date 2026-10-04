/**
 * Run an internal Convex function through the Convex CLI (`convex run`).
 *
 * Operator functions (site creation, publish tokens, archive/restore, password
 * resets, migrations) are internal, so the application's service JWT cannot
 * reach them. `convex run` authenticates with the operator's own deployment
 * credentials (logged-in CLI, CONVEX_DEPLOYMENT/CONVEX_DEPLOY_KEY in
 * apps/app/.env.local, or a self-hosted env file) and may call internal
 * functions.
 *
 * Deployment selection is passed straight through to the CLI. Without one,
 * the CLI uses the deployment configured for apps/app (normally your dev
 * deployment). Production requires an explicit `--prod`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";

const APP_DIR = path.join(import.meta.dir, "..", "..");
const VALUE_FLAGS = new Set(["--deployment-name", "--deployment", "--preview-name", "--env-file", "--url", "--admin-key"]);
const BOOLEAN_FLAGS = new Set(["--prod"]);

export const DEPLOYMENT_FLAGS_USAGE = "[--prod | --deployment-name <name> | --env-file <path>]";

/** Separate Convex CLI deployment-selection flags from a script's own args. */
export function splitDeploymentFlags(argv: string[]) {
  const deployment: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.split("=", 1)[0];
    if (BOOLEAN_FLAGS.has(arg)) deployment.push(arg);
    else if (VALUE_FLAGS.has(name)) {
      if (arg.includes("=")) deployment.push(arg);
      else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error(`${arg} requires a value`);
      else deployment.push(arg, argv[++i]);
    } else rest.push(arg);
  }
  return { deployment, rest };
}

type InternalFunction = FunctionReference<"query" | "mutation" | "action", "internal">;

export function convexRunCommand(fn: InternalFunction, args: Record<string, unknown>, deployment: string[]) {
  return ["convex", "run", getFunctionName(fn), JSON.stringify(args), "--typecheck", "disable", "--codegen", "disable", ...deployment];
}

/** Invoke `bunx convex run <fn> <args>` from apps/app and parse its JSON result. */
export function convexRun<F extends InternalFunction>(fn: F, args: FunctionArgs<F>, deployment: string[] = []): FunctionReturnType<F> {
  const result = spawnSync("bunx", convexRunCommand(fn, args as Record<string, unknown>, deployment), {
    cwd: APP_DIR,
    encoding: "utf8",
    // CLI progress and errors go straight to the operator's terminal.
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`convex run ${getFunctionName(fn)} failed (exit ${result.status})`);
  const output = result.stdout.trim();
  // The CLI prints nothing for a null result and pretty JSON otherwise
  // (stdout is a pipe, so it never uses the colored TTY format).
  return (output ? JSON.parse(output) : null) as FunctionReturnType<F>;
}
