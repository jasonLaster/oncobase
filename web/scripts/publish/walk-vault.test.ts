import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { readVaultDocuments } from "./walk-vault";

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
});
