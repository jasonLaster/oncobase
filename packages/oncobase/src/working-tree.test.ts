import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUpToDateWithUpstream, readUpstreamStatus } from "./working-tree";

const tempDirs: string[] = [];

function mkTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("upstream freshness guard", () => {
  test("returns not-git for plain directories and no-upstream for local-only repos", () => {
    const plain = mkTempDir("oncobase-plain-");
    expect(readUpstreamStatus(plain)).toEqual({ state: "not-git" });

    const localRepo = mkTempDir("oncobase-local-");
    git(localRepo, ["init"]);
    fs.writeFileSync(path.join(localRepo, "index.md"), "# Home\n");
    git(localRepo, ["add", "index.md"]);
    git(localRepo, ["commit", "-m", "initial"]);
    expect(readUpstreamStatus(localRepo)).toEqual({ state: "no-upstream" });
  });

  test("detects when local checkout is behind upstream after a remote commit", () => {
    const remote = mkTempDir("oncobase-remote-");
    git(remote, ["init", "--bare"]);

    const cloneA = mkTempDir("oncobase-clone-a-");
    git(cloneA, ["clone", remote, "."]);
    fs.writeFileSync(path.join(cloneA, "plan.md"), "# Plan\n\nOriginal\n");
    git(cloneA, ["add", "plan.md"]);
    git(cloneA, ["commit", "-m", "initial"]);
    const branch = git(cloneA, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(cloneA, ["push", "-u", "origin", branch]);

    const cloneB = mkTempDir("oncobase-clone-b-");
    git(cloneB, ["clone", remote, "."]);
    expect(readUpstreamStatus(cloneA)).toEqual({
      state: "current",
      upstream: `origin/${branch}`,
      ahead: 0,
    });

    // Simulate a remote commit (e.g. from Chat editing directly on GitHub).
    fs.writeFileSync(path.join(cloneB, "plan.md"), "# Plan\n\nUpdated via chat\n");
    git(cloneB, ["add", "plan.md"]);
    git(cloneB, ["commit", "-m", "chat edit"]);
    git(cloneB, ["push", "origin", branch]);

    const behind = readUpstreamStatus(cloneA);
    expect(behind).toEqual({
      state: "behind",
      upstream: `origin/${branch}`,
      behind: 1,
      ahead: 0,
    });

    // Without --allow-behind, ensureUpToDateWithUpstream exits with code 1.
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => ensureUpToDateWithUpstream(cloneA)).toThrow("EXIT:1");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }

    // With --allow-behind, it warns and returns the behind status.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(ensureUpToDateWithUpstream(cloneA, { allowBehind: true })).toEqual(behind);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
