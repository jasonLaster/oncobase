import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, test, spyOn } from "bun:test";
import { readGitPublishScope, readPublishScope, readPublishSelection } from "./publish-scope";

test("theme companions inherit all owners and sensitivity through relative and file API references", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-theme-images-"));
  try {
    fs.mkdirSync(path.join(dir, "images"));
    for (const name of ["cleanup-light.png", "cleanup-dark.png", "plain-light.png", "plain-dark.png"]) {
      fs.writeFileSync(path.join(dir, "images", name), "image");
    }
    fs.writeFileSync(path.join(dir, "public.md"),
      '<img data-theme-pair src="/api/file?path=images%2Fcleanup-light.png">\n<img src="./images/plain-light.png">');
    fs.writeFileSync(path.join(dir, "private.md"),
      "---\nsensitive: true\nsensitive-include: [team]\n---\n<img src='./images/cleanup-light.png' data-theme-pair=''>");
    const selected = readPublishSelection(dir, new Set(["public"]), "referenced");
    expect(selected.assets.map(asset => asset.relativePath).sort()).toEqual([
      "images/cleanup-dark.png", "images/cleanup-light.png", "images/plain-light.png",
    ]);
    for (const asset of selected.assets.filter(asset => asset.relativePath.startsWith("images/cleanup-"))) {
      expect(asset.ownerSlugs).toEqual(["private", "public"]);
      expect(asset.sensitive).toBe(true);
      expect(asset.sensitiveInclude).toEqual(["team"]);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("referenced scope preserves outside owners and avoids hashing unrelated LFS assets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-scope-"));
  try {
    fs.writeFileSync(path.join(dir, "public.md"), "# Public\n![shared](shared.png)");
    fs.writeFileSync(path.join(dir, "private.md"), "---\nsensitive: true\nsensitive-include: [team]\n---\n# Private\n![shared](shared.png)");
    fs.writeFileSync(path.join(dir, "shared.png"), "image");
    fs.writeFileSync(path.join(dir, "unrelated.pdf"), "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 100\n");
    const scope = new Set(["public"]);
    const selected = readPublishSelection(dir, scope, "referenced");
    expect(selected.documents.map(d => d.slug)).toEqual(["public"]);
    expect(selected.assets).toHaveLength(1);
    expect(selected.assets[0].ownerSlugs).toEqual(["private", "public"]);
    expect(selected.assets[0].sensitive).toBe(true);
    expect(selected.assets[0].sensitiveInclude).toEqual(["team"]);
    expect(selected.assets[0].sizeBytes).toBe(5);
    expect(readPublishSelection(dir, scope, "none").assets).toEqual([]);
    expect(() => readPublishSelection(dir, scope, "all")).toThrow("LFS pointer");
    expect(() => readPublishSelection(dir, new Set(["missing"]), "none")).toThrow("missing");
    const file = path.join(dir, "scope.json");
    for (const paths of [[], ["../public.md"], ["/public.md"], ["public.png"], ["./public.md"]]) {
      fs.writeFileSync(file, JSON.stringify(paths));
      expect(() => readPublishScope(file)).toThrow("vault-relative");
    }
    fs.writeFileSync(file, '["public.md", "public.md"]');
    expect([...readPublishScope(file)]).toEqual(["public"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test("one scan parses documents once and refreshes outside-scope visibility on the next invocation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-snapshot-"));
  const read = spyOn(fs, "readFileSync");
  try {
    fs.writeFileSync(path.join(dir, "public.md"), "# Public\n![shared](shared.png)");
    fs.writeFileSync(path.join(dir, "private.md"), "---\nsensitive: true\n---\n# Private\n![shared](shared.png)");
    fs.writeFileSync(path.join(dir, "shared.png"), "image");
    const first = readPublishSelection(dir, new Set(["public"]), "referenced");
    expect(read.mock.calls.filter(([file]) => String(file).startsWith(dir) && String(file).endsWith(".md"))).toHaveLength(2);
    expect(first.assets[0].sensitive).toBe(true);
    fs.writeFileSync(path.join(dir, "private.md"), "# Public now\n![shared](shared.png)");
    const next = readPublishSelection(dir, new Set(["public"]), "referenced");
    expect(next.assets[0].sensitive).toBe(false);
    expect(next.assets[0].visibilityHash).not.toBe(first.assets[0].visibilityHash);
    fs.unlinkSync(path.join(dir, "private.md"));
    expect(readPublishSelection(dir, new Set(["public"]), "referenced").assets[0].ownerSlugs).toEqual(["public"]);
  } finally { read.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); }
});


test("Git scopes use explicit committed Markdown ranges and reject unsafe omissions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-publish-scope-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
  try {
    git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture");
    fs.writeFileSync(path.join(dir, "one.md"), "one"); git("add", "."); git("commit", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(dir, "one.md"), "updated"); fs.writeFileSync(path.join(dir, "two with spaces.mdx"), "two");
    git("add", "."); git("commit", "-m", "edits");
    expect([...readGitPublishScope(dir, base)]).toEqual(["one", "two with spaces"]);
    expect(readGitPublishScope(dir, "HEAD").size).toBe(0);
    expect(() => readGitPublishScope(dir, "--help")).toThrow("commit/ref");
    fs.writeFileSync(path.join(dir, "asset.png"), "image"); git("add", "."); git("commit", "-m", "asset");
    expect(() => readGitPublishScope(dir, base)).toThrow("reviewed");
    git("rm", "one.md"); git("commit", "-m", "delete");
    expect(() => readGitPublishScope(dir, "HEAD~1")).toThrow("reviewed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
