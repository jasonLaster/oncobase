import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { dependencyCachePath } from "./dependency-cache";
import { readPublishSelection } from "./publish-scope";

for (const mode of ["content", "metadata"] as const) {
  test(`${mode} rebuilds pre-theme-pair caches without source edits`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-theme-cache-"));
    const vault = path.join(root, "vault"), cache = path.join(root, "cache");
    fs.mkdirSync(vault);
    try {
      fs.writeFileSync(path.join(vault, "public.md"), '<img src="pair-light.png" data-theme-pair>');
      fs.writeFileSync(path.join(vault, "private.md"), '---\nsensitive: true\n---\n<img src="pair-light.png" data-theme-pair>');
      for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(vault, `pair-${theme}.png`), "image");
      const read = () => readPublishSelection(vault, new Set(["public"]), "referenced", mode, cache);
      const fresh = read();
      const file = dependencyCachePath(vault, cache);
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      const dependencies = JSON.parse(envelope.payload);
      // Simulate a valid v1 cache: unchanged source fingerprints, but no inferred dark references.
      for (const entry of Object.values(dependencies) as Array<{ dependency: { references: string[] } }>) {
        entry.dependency.references = entry.dependency.references.filter(reference => !reference.includes("pair-dark"));
      }
      envelope.version = 1;
      envelope.payload = JSON.stringify(dependencies);
      envelope.digest = createHash("sha256").update(envelope.payload).digest("hex");
      fs.writeFileSync(file, JSON.stringify(envelope));
      const rebuilt = read();
      expect(rebuilt).toEqual(fresh);
      const dark = rebuilt.assets.find(asset => asset.relativePath === "pair-dark.png");
      expect(dark?.ownerSlugs).toEqual(["private", "public"]);
      expect(dark?.sensitive).toBe(true);
      expect(read()).toEqual(rebuilt); // The replacement cache also retains ownership.
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test(`${mode} dependency index matches a fresh scan after outside-owner edits, deletion, ignore changes and asset ambiguity`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-cache-test-"));
    const vault = path.join(root, "vault"), cache = path.join(root, "cache");
    fs.mkdirSync(vault);
    const write = (name: string, text: string) => fs.writeFileSync(path.join(vault, name), text);
    const scope = new Set(["home"]);
    const read = () => readPublishSelection(vault, scope, "referenced", mode, cache);
    const check = () => { const result = read(); expect(result).toEqual(readPublishSelection(vault, scope, "referenced", "off")); return result; };
    try {
      write("home.md", "# Home\nBODY_NOT_IN_CACHE\n![asset](shared.pdf)");
      write("owner.md", "---\nsensitive: false\n---\n[[shared.pdf]]");
      write("shared.pdf", "pdf bytes");
      expect(check().assets[0].sensitive).toBe(false);
      const cacheFile = dependencyCachePath(vault, cache);
      expect(fs.readFileSync(cacheFile, "utf8")).not.toContain("BODY_NOT_IN_CACHE");
      expect(fs.statSync(cacheFile).mode & 0o777).toBe(0o600);
      check();
      const stat = fs.statSync(path.join(vault, "owner.md"));
      write("owner.md", "---\nsensitive: true \n---\n[[shared.pdf]]"); // Same size, restored mtime; ctime/content must catch this.
      fs.utimesSync(path.join(vault, "owner.md"), stat.atime, stat.mtime);
      expect(check().assets[0].sensitive).toBe(true);
      fs.renameSync(path.join(vault, "owner.md"), path.join(vault, "renamed.md"));
      expect(check().assets[0].ownerSlugs).toEqual(["home", "renamed"]);
      write(".oncobaseignore", "renamed.md\n");
      expect(check().assets[0].sensitive).toBe(false);
      fs.unlinkSync(path.join(vault, ".oncobaseignore"));
      fs.unlinkSync(path.join(vault, "renamed.md"));
      expect(check().assets[0].ownerSlugs).toEqual(["home"]);
      fs.mkdirSync(path.join(vault, "nested"));
      fs.renameSync(path.join(vault, "shared.pdf"), path.join(vault, "nested/shared.pdf"));
      expect(check().assets[0].relativePath).toBe("nested/shared.pdf");
      fs.mkdirSync(path.join(vault, "other"));
      write("other/shared.pdf", "other");
      expect(check().assets).toEqual([]); // Basename stopped resolving uniquely.
      fs.writeFileSync(cacheFile, "{broken");
      check();
      const envelope = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      envelope.version = -1;
      fs.writeFileSync(cacheFile, JSON.stringify(envelope));
      check();
      write("home.md", "# Changed\nnew body");
      expect(check().documents[0].title).toBe("Changed");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("unwritable cache falls back; refresh replaces stale entries; selected asset bytes stay fresh", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-cache-errors-"));
  const vault = path.join(root, "vault"), cache = path.join(root, "cache");
  fs.mkdirSync(vault);
  try {
    fs.writeFileSync(path.join(vault, "home.md"), "# Home\n[[asset.pdf]]");
    fs.writeFileSync(path.join(vault, "asset.pdf"), "old");
    const scope = new Set(["home"]);
    const first = readPublishSelection(vault, scope, "referenced", "content", cache);
    fs.writeFileSync(path.join(vault, "asset.pdf"), "new");
    const next = readPublishSelection(vault, scope, "referenced", "refresh", cache);
    expect(first.assets[0].hash).not.toBe(next.assets[0].hash);
    fs.writeFileSync(path.join(root, "not-a-directory"), "file");
    expect(readPublishSelection(vault, scope, "referenced", "content", path.join(root, "not-a-directory"))).toEqual(next);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
