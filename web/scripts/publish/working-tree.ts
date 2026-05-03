import { execFileSync } from "node:child_process";
import path from "node:path";

// Pre-publish gate. The publisher reads files from the working tree
// (not from a git revision), so uncommitted edits, deletions, and
// untracked files all flow into the manifest. Today this caused
// surprises: 22 PNGs that had been silently deleted in the working
// tree showed up as "stale" tombstones, almost wiping legitimate
// content. Refuse to run when the vault tree is dirty unless the
// caller explicitly opts in with --allow-dirty.

export type WorkingTreeStatus = {
  modified: string[];
  deleted: string[];
  untracked: string[];
  added: string[];
  renamed: string[];
};

export function readWorkingTreeStatus(vaultPath: string): WorkingTreeStatus {
  const absVault = path.resolve(vaultPath);
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["status", "--porcelain=1", "--untracked-files=normal", "--", absVault],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    // Vault may live outside any git repo (rare but supported).
    // Treat as clean — the gate is a safety net, not a hard
    // dependency on git.
    if (error instanceof Error && /not a git repository/i.test(error.message)) {
      return { modified: [], deleted: [], untracked: [], added: [], renamed: [] };
    }
    throw error;
  }

  const status: WorkingTreeStatus = {
    modified: [],
    deleted: [],
    untracked: [],
    added: [],
    renamed: [],
  };
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === "??") status.untracked.push(file);
    else if (code.includes("M")) status.modified.push(file);
    else if (code.includes("D")) status.deleted.push(file);
    else if (code.includes("A")) status.added.push(file);
    else if (code.includes("R")) status.renamed.push(file);
  }
  return status;
}

export function workingTreeIsDirty(status: WorkingTreeStatus) {
  return (
    status.modified.length +
      status.deleted.length +
      status.untracked.length +
      status.added.length +
      status.renamed.length >
    0
  );
}

function summarize(status: WorkingTreeStatus) {
  const parts: string[] = [];
  if (status.modified.length) parts.push(`${status.modified.length} modified`);
  if (status.deleted.length) parts.push(`${status.deleted.length} deleted`);
  if (status.added.length) parts.push(`${status.added.length} added`);
  if (status.renamed.length) parts.push(`${status.renamed.length} renamed`);
  if (status.untracked.length) parts.push(`${status.untracked.length} untracked`);
  return parts.join(", ");
}

function preview(status: WorkingTreeStatus, limit = 10) {
  const lines: string[] = [];
  for (const f of status.deleted.slice(0, limit)) lines.push(`  D  ${f}`);
  for (const f of status.modified.slice(0, limit)) lines.push(`  M  ${f}`);
  for (const f of status.added.slice(0, limit)) lines.push(`  A  ${f}`);
  for (const f of status.renamed.slice(0, limit)) lines.push(`  R  ${f}`);
  for (const f of status.untracked.slice(0, limit)) lines.push(`  ?? ${f}`);
  return lines;
}

export function ensureCleanVault(
  vaultPath: string,
  options: { allowDirty?: boolean } = {},
) {
  const status = readWorkingTreeStatus(vaultPath);
  if (!workingTreeIsDirty(status)) return;

  const headline = `Vault working tree is dirty: ${summarize(status)}`;
  const lines = preview(status);

  if (options.allowDirty) {
    console.warn(`${headline} (--allow-dirty set; continuing)`);
    for (const line of lines) console.warn(line);
    return;
  }

  console.error(headline);
  for (const line of lines) console.error(line);
  console.error(
    "\nDeleted files become tombstones; modified files publish their working-tree content.",
  );
  console.error(
    "Commit, stash, or restore the vault, or rerun with --allow-dirty to acknowledge.",
  );
  process.exit(1);
}
