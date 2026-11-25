import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { batchVersions, readDocumentHistory } from "./git-history";

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oncobase-history-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } });
  git("init", "-q", "-b", "main");
  const vault = path.join(root, "vault");
  fs.mkdirSync(path.join(vault, "notes"), { recursive: true });
  let clock = 1_700_000_000;
  const commit = (files: Record<string, string | null>, message: string) => {
    for (const [file, body] of Object.entries(files)) {
      const target = path.join(vault, file);
      if (body === null) fs.rmSync(target);
      else fs.writeFileSync(target, body);
    }
    git("add", "-A");
    clock += 60;
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` } });
  };
  return { root, vault, commit };
}

test("reads each committed revision of the requested pages, parsed like publish", () => {
  const { root, vault, commit } = repo();
  try {
    commit({ "notes/page.md": "# Page\n\nfirst", "notes/other.md": "# Other\n\nx", "outside.txt": "ignored" }, "add pages");
    commit({ "notes/page.md": "---\nsensitive: true\nsensitive-include: [serova]\ntags: [a]\n---\n# Page v2\n\nsecond" }, "edit page");
    commit({ "notes/other.md": null }, "delete other");
    fs.writeFileSync(path.join(root, "README.md"), "# Not in the vault");
    const history = readDocumentHistory(vault, new Set(["notes/page", "notes/other"]));
    const page = history.get("notes/page")!;
    expect(page.map(v => [v.title, v.content, v.sensitive, v.tags, v.commitMessage])).toEqual([
      ["Page v2", "second", true, ["a"], "edit page"],
      ["Page", "first", false, [], "add pages"],
    ]);
    expect(page[0].versionAt).toBeGreaterThan(page[1].versionAt);
    expect(page[0].sensitiveInclude).toEqual(["serova"]);
    expect(page[0].commitSha).toMatch(/^[0-9a-f]{40}$/);
    // The deletion commit adds no revision.
    expect(history.get("notes/other")!.map(v => v.content)).toEqual(["x"]);
    expect(readDocumentHistory(vault, new Set(["notes/page"]), { maxPerPage: 1 }).get("notes/page")!.map(v => v.content)).toEqual(["second"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("batches stay under the count and byte caps", () => {
  const version = (content: string) => ({ title: "t", content, tags: [], sensitive: false, sensitiveInclude: [], versionAt: 1, commitSha: "a".repeat(40) });
  expect(batchVersions([version("a"), version("b"), version("c")], { maxCount: 2 }).map(b => b.length)).toEqual([2, 1]);
  expect(batchVersions([version("x".repeat(100)), version("y".repeat(100))], { maxBytes: 150 }).map(b => b.length)).toEqual([1, 1]);
});
