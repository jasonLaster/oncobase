import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { readVaultAssets, readVaultDocuments } from "./walk-vault";

let tmpDir: string | null = null;

function makeVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-publish-"));
  return tmpDir;
}

function writeDoc(vault: string, markdown: string) {
  fs.writeFileSync(path.join(vault, "home.md"), markdown);
  return readVaultDocuments(vault)[0];
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("readVaultDocuments", () => {
  test("hash changes when frontmatter title changes", () => {
    const vault = makeVault();
    const original = writeDoc(
      vault,
      "---\ntitle: Alpha\ntags: [care]\n---\n# Home\nSame body\n",
    );
    const renamed = writeDoc(
      vault,
      "---\ntitle: Beta\ntags: [care]\n---\n# Home\nSame body\n",
    );

    expect(renamed.content).toBe(original.content);
    expect(renamed.hash).not.toBe(original.hash);
  });

  test("hash changes when tags change", () => {
    const vault = makeVault();
    const original = writeDoc(
      vault,
      "---\ntitle: Alpha\ntags: [care]\n---\n# Home\nSame body\n",
    );
    const retagged = writeDoc(
      vault,
      "---\ntitle: Alpha\ntags: [care, trial]\n---\n# Home\nSame body\n",
    );

    expect(retagged.content).toBe(original.content);
    expect(retagged.hash).not.toBe(original.hash);
  });

  test("reads sensitive frontmatter and includes it in the hash", () => {
    const vault = makeVault();
    const publicDoc = writeDoc(vault, "---\ntitle: Alpha\n---\n# Home\nSame body\n");
    const sensitiveDoc = writeDoc(
      vault,
      "---\ntitle: Alpha\nsensitive: true\n---\n# Home\nSame body\n",
    );

    expect(sensitiveDoc.sensitive).toBe(true);
    expect(sensitiveDoc.hash).not.toBe(publicDoc.hash);
  });

  test("excludes assets with sensitive markdown sidecars", () => {
    const vault = makeVault();
    fs.writeFileSync(path.join(vault, "public.md"), "# Public\n");
    fs.writeFileSync(path.join(vault, "public.pdf"), Buffer.alloc(256));
    fs.writeFileSync(
      path.join(vault, "private.md"),
      "---\nsensitive: true\n---\n# Private\n",
    );
    fs.writeFileSync(path.join(vault, "private.pdf"), Buffer.alloc(256));

    expect(readVaultAssets(vault).map((asset) => asset.relativePath)).toEqual([
      "public.pdf",
    ]);
  });
});
