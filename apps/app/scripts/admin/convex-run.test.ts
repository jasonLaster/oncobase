import { expect, test } from "bun:test";
import { internal } from "../../convex/_generated/api";
import { convexRunCommand, splitDeploymentFlags } from "./convex-run";

test("deployment-selection flags pass through to convex run; script args stay", () => {
  expect(splitDeploymentFlags(["--site", "alpha", "--prod"])).toEqual({ deployment: ["--prod"], rest: ["--site", "alpha"] });
  expect(splitDeploymentFlags(["alpha", "--env-file", "x.env", "--owner", "o@x.test", "--deployment-name=dev-1"]))
    .toEqual({ deployment: ["--env-file", "x.env", "--deployment-name=dev-1"], rest: ["alpha", "--owner", "o@x.test"] });
  expect(() => splitDeploymentFlags(["--env-file"])).toThrow("requires a value");
  expect(() => splitDeploymentFlags(["--env-file", "--prod"])).toThrow("requires a value");
});

test("internal functions are addressed by their Convex path with JSON args", () => {
  expect(convexRunCommand(internal.sites.archive, { slug: "alpha" }, ["--prod"]))
    .toEqual(["convex", "run", "sites:archive", "{\"slug\":\"alpha\"}", "--typecheck", "disable", "--codegen", "disable", "--prod"]);
});
