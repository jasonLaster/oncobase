import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
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
