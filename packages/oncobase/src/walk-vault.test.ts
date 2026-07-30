import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import { readVaultAssets, readVaultDocuments } from "./walk-vault";

let tmpDir: string | null = null;

function makeVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-publish-"));
  return tmpDir;
}

function writeDoc(vault: string, markdown: string, name = "home.md") {
  fs.writeFileSync(path.join(vault, name), markdown);
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

  test("reads sensitive-include frontmatter and migrates legacy sensitive tags", () => {
    const vault = makeVault();
    const doc = writeDoc(
      vault,
      "---\ntitle: Alpha\ntags: [serova-sensitive, echo-sensitive, trial]\nsensitive-include: [sponsor]\n---\n# Home\nSame body\n",
    );

    expect(doc.tags).toEqual(["trial"]);
    expect(doc.sensitiveInclude).toEqual(["sponsor", "serova", "echo"]);
  });

  test("reads mdx documents with the same slug rules as markdown", () => {
    const vault = makeVault();
    const mdxDoc = writeDoc(
      vault,
      "---\ntitle: Home\n---\n# Home\n<CustomIsland />\n",
      "index.mdx",
    );

    expect(mdxDoc.slug).toBe("index");
    expect(mdxDoc.content).toContain("<CustomIsland />");
  });

  test("reads provider data bundles and sensitive sidecar assets", () => {
    const vault = makeVault();
    fs.writeFileSync(path.join(vault, "public.md"), "# Public\n");
    fs.writeFileSync(path.join(vault, "public.pdf"), Buffer.alloc(256));
    fs.writeFileSync(
      path.join(vault, "private.md"),
      "---\nsensitive: true\n---\n# Private\n",
    );
    fs.writeFileSync(path.join(vault, "private.pdf"), Buffer.alloc(256));
    fs.mkdirSync(path.join(vault, "biopsy", "raw"), { recursive: true });
    fs.writeFileSync(path.join(vault, "biopsy", "raw", "dicom.zip"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "biopsy", "raw", "scan.dcm"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "biopsy", "path-report.docx"), Buffer.alloc(256));

    const assets = readVaultAssets(vault);
    expect(assets.map((asset) => asset.relativePath)).toEqual(
      expect.arrayContaining([
        "public.pdf",
        "private.pdf",
        "biopsy/raw/dicom.zip",
        "biopsy/raw/scan.dcm",
        "biopsy/path-report.docx",
      ]),
    );
    expect(assets.find((asset) => asset.relativePath === "biopsy/raw/dicom.zip")).toMatchObject({
      kind: "file",
      contentType: "application/zip",
    });
    expect(assets.find((asset) => asset.relativePath === "biopsy/raw/scan.dcm")).toMatchObject({
      kind: "file",
      contentType: "application/dicom",
    });
    expect(assets.find((asset) => asset.relativePath === "private.pdf")).toMatchObject({
      ownerSlugs: ["private"],
      sensitive: true,
      sensitiveInclude: [],
    });
  });

  test("inherits visibility from documents that reference nested assets", () => {
    const vault = makeVault();
    fs.mkdirSync(path.join(vault, "private", "images"), { recursive: true });
    fs.writeFileSync(
      path.join(vault, "private.md"),
      [
        "---",
        "sensitive: true",
        "sensitive-include: [research-partner]",
        "---",
        "# Private",
        "![[private/images/scan.png]]",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(vault, "private", "images", "scan.png"), Buffer.alloc(256));

    expect(readVaultAssets(vault)).toEqual([
      expect.objectContaining({
        relativePath: "private/images/scan.png",
        ownerSlugs: ["private"],
        sensitive: true,
        sensitiveInclude: ["research-partner"],
      }),
    ]);
  });

  test("marks a shared asset sensitive when any owner is sensitive", () => {
    const vault = makeVault();
    fs.mkdirSync(path.join(vault, "images"), { recursive: true });
    fs.writeFileSync(path.join(vault, "images", "shared.png"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "public.md"), "# Public\n![[images/shared.png]]\n");
    fs.writeFileSync(
      path.join(vault, "private.md"),
      "---\nsensitive: true\n---\n# Private\n![[images/shared.png]]\n",
    );

    expect(readVaultAssets(vault)[0]).toMatchObject({
      ownerSlugs: ["private", "public"],
      sensitive: true,
    });
  });

  test("changes the compact visibility hash when ownership becomes sensitive", () => {
    const vault = makeVault();
    fs.mkdirSync(path.join(vault, "images"), { recursive: true });
    fs.writeFileSync(path.join(vault, "images", "scan.png"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "scan.md"), "# Scan\n![[images/scan.png]]\n");
    const publicHash = readVaultAssets(vault)[0].visibilityHash;

    fs.writeFileSync(
      path.join(vault, "scan.md"),
      "---\nsensitive: true\n---\n# Scan\n![[images/scan.png]]\n",
    );
    const sensitiveAsset = readVaultAssets(vault)[0];

    expect(sensitiveAsset.sensitive).toBe(true);
    expect(sensitiveAsset.visibilityHash).not.toBe(publicHash);
    expect(sensitiveAsset.visibilityHash).toHaveLength(16);
  });

  test("honors .oncobaseignore without deleting source files", () => {
    const vault = makeVault();
    fs.mkdirSync(path.join(vault, "archive", "slides"), { recursive: true });
    fs.writeFileSync(path.join(vault, "keep.png"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "hold-back.png"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "archive", "slides", "slide-01.png"), Buffer.alloc(256));
    fs.writeFileSync(
      path.join(vault, ".oncobaseignore"),
      "hold-back.png\narchive/slides/\n",
    );

    expect(readVaultAssets(vault).map((asset) => asset.relativePath)).toEqual(["keep.png"]);
  });

  test("does not publish files ignored by git", () => {
    const vault = makeVault();
    execFileSync("git", ["init"], { cwd: vault, stdio: "ignore" });
    fs.writeFileSync(path.join(vault, ".gitignore"), "ignored.png\n");
    fs.writeFileSync(path.join(vault, "tracked.png"), Buffer.alloc(256));
    fs.writeFileSync(path.join(vault, "ignored.png"), Buffer.alloc(256));
    execFileSync("git", ["add", ".gitignore", "tracked.png"], {
      cwd: vault,
      stdio: "ignore",
    });

    expect(readVaultAssets(vault).map((asset) => asset.relativePath)).toEqual([
      "tracked.png",
    ]);
  });

  test("rejects unresolved Git LFS pointer assets", () => {
    const vault = makeVault();
    fs.writeFileSync(
      path.join(vault, "report.pdf"),
      [
        "version https://git-lfs.github.com/spec/v1",
        "oid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "size 123456",
        "",
      ].join("\n"),
    );

    expect(() => readVaultAssets(vault)).toThrow(
      "Refusing to publish unresolved Git LFS pointer asset: report.pdf",
    );
  });
});
