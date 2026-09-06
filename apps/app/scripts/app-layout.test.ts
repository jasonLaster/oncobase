import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(appDirectory, "../..");
const appPath = path.relative(repositoryRoot, appDirectory);
const readRoot = (filename: string) => readFileSync(path.join(repositoryRoot, filename), "utf8");

test("the permanent application workspace owns the server and build output", () => {
  expect(appPath).toBe("apps/app");
  expect(JSON.parse(readRoot(`${appPath}/package.json`)).name).toBe("@oncobase/app");
  const config = JSON.parse(readRoot("vercel.json"));
  expect(config.buildCommand).toBe(`bun --cwd ${appPath} scripts/build-vercel.ts`);
  expect(config.outputDirectory).toBe(`${appPath}/dist`);
  for (const filename of ["api/index.js", "api/app-shell.js"]) {
    expect(config.functions[filename].includeFiles).toBe(`${appPath}/.vercel-functions/**`);
    expect(readRoot(filename)).toContain(`../${appPath}/.vercel-functions/`);
  }
  for (const filename of ["api-runtime/index.ts", "api-runtime/root-app-shell.ts", "server/standalone.ts", "convex/schema.ts"]) {
    expect(existsSync(path.join(appDirectory, filename))).toBe(true);
  }
  expect(readRoot(`${appPath}/api-runtime/root-app-shell.ts`)).toContain(`"${appPath}/dist"`);
});

test("CI, compatibility commands, and private artifact exclusions use the current workspace", () => {
  const workflow = readRoot(".github/workflows/wiki-vite-checks.yml");
  expect(workflow).toContain(`working-directory: ${appPath}`);
  expect(workflow).toContain(`"${appPath}/**"`);
  expect(readRoot(".gitignore")).toContain(`${appPath}/e2e/.auth/`);
  const scripts = JSON.parse(readRoot("package.json")).scripts as Record<string, string>;
  expect(scripts["dev:wiki-vite"]).toBe(`bun --cwd ${appPath} dev`);
  for (const text of [workflow, ...Object.values(scripts), readRoot("vercel.json"), readRoot("doctor.config.json")]) {
    expect(text).not.toContain("apps/wiki-vite");
  }
});
