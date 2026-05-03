import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { formatRemoteDocument } from "./sync";
import { hashDocument, readVaultDocuments } from "./walk-vault";

let tmpDir: string | null = null;

function makeVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-sync-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("formatRemoteDocument", () => {
  test("round-trips to the same document hash", () => {
    const vault = makeVault();
    const remote = {
      slug: "remote",
      title: "Remote",
      content: "Body text",
      tags: ["tag"],
    };
    fs.writeFileSync(path.join(vault, "remote.md"), formatRemoteDocument(remote));

    const [local] = readVaultDocuments(vault);

    expect(local.content).toBe(remote.content);
    expect(local.hash).toBe(hashDocument(remote));
  });

  test("preserves intentional trailing newlines", () => {
    const vault = makeVault();
    const remote = {
      slug: "remote",
      title: "Remote",
      content: "Body text\n",
      tags: ["tag"],
    };
    fs.writeFileSync(path.join(vault, "remote.md"), formatRemoteDocument(remote));

    const [local] = readVaultDocuments(vault);

    expect(local.content).toBe(remote.content);
    expect(local.hash).toBe(hashDocument(remote));
  });
});
