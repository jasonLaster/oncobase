import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { formatRemoteDocument, mapWithConcurrency } from "./sync";
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

describe("mapWithConcurrency", () => {
  test("runs work in parallel up to the configured limit", async () => {
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      active--;
    });

    expect(maxActive).toBe(2);
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
  });
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
