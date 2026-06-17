import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
) as { version: string };

describe("oncobase cli", () => {
  test.each(["-v", "--version"])("prints the package version with %s", (flag) => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "src/main.ts", flag],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(packageJson.version);
    expect(result.stderr.toString()).toBe("");
  });
});
