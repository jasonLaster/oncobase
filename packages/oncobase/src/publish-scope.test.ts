import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, spyOn } from "bun:test";
import { readPublishScope, readPublishSelection } from "./publish-scope";

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
