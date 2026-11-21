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
      [
        "-C",
        absVault,
        "status",
        "--porcelain=1",
        "--untracked-files=normal",
        "--",
        ".",
      ],
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

export type UpstreamStatus =
  | { state: "not-git" }
  | { state: "no-upstream" }
  | { state: "current"; upstream: string; ahead: number }
  | { state: "behind"; upstream: string; behind: number; ahead: number }
  | { state: "fetch-failed"; upstream: string; error: string };

const UPSTREAM_FETCH_TIMEOUT_MS = 15_000;

/**
 * Inspect whether the local vault checkout is behind its configured Git upstream.
 * Runs `git fetch` against the upstream remote so remote commits (such as edits
 * committed via Oncobase Chat) are discovered before publishing from a stale tree.
 */
export function readUpstreamStatus(
  vaultPath: string,
  options: { fetch?: boolean; timeoutMs?: number } = {},
): UpstreamStatus {
  const absVault = path.resolve(vaultPath);
  const timeout = options.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_MS;
  let upstream: string;
  try {
    upstream = execFileSync(
      "git",
      ["-C", absVault, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository/i.test(message)) return { state: "not-git" };
    if (/no upstream configured|does not point to a branch|HEAD/i.test(message)) {
      return { state: "no-upstream" };
    }
    return { state: "no-upstream" };
  }
  if (!upstream) return { state: "no-upstream" };

  if (options.fetch !== false) {
    const slash = upstream.indexOf("/");
    const remote = slash > 0 ? upstream.slice(0, slash) : undefined;
    try {
      execFileSync(
        "git",
        remote ? ["-C", absVault, "fetch", "--quiet", remote] : ["-C", absVault, "fetch", "--quiet"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout },
      );
    } catch (error) {
      return {
        state: "fetch-failed",
        upstream,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const counts = execFileSync(
    "git",
    ["-C", absVault, "rev-list", "--left-right", "--count", `HEAD...${upstream}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split(/\s+/);
  const ahead = Number.parseInt(counts[0] ?? "0", 10) || 0;
  const behind = Number.parseInt(counts[1] ?? "0", 10) || 0;
  if (behind > 0) {
    return { state: "behind", upstream, behind, ahead };
  }
  return { state: "current", upstream, ahead };
}

export function ensureUpToDateWithUpstream(
  vaultPath: string,
  options: { allowBehind?: boolean; fetch?: boolean } = {},
) {
  const status = readUpstreamStatus(vaultPath, { fetch: options.fetch });
  if (status.state === "not-git" || status.state === "no-upstream" || status.state === "current") {
    return status;
  }

  if (status.state === "behind") {
    const headline = `Vault is ${status.behind} commit${status.behind === 1 ? "" : "s"} behind ${status.upstream}.`;
    if (options.allowBehind) {
      console.warn(`${headline} (--allow-behind set; continuing)`);
      return status;
    }
    console.error(headline);
    console.error(
      "Publishing from a stale checkout can silently revert remote edits (such as edits committed from Chat).",
    );
    console.error(
      "Run `git pull` before publishing, or rerun with --allow-behind to acknowledge.",
    );
    process.exit(1);
  }

  const headline = `Could not fetch ${status.upstream} to verify vault is up to date: ${status.error}`;
  if (options.allowBehind) {
    console.warn(`${headline} (--allow-behind set; continuing)`);
    return status;
  }
  console.error(headline);
  console.error(
    "Verify connectivity and run `git pull`, or rerun with --allow-behind to bypass the upstream freshness check.",
  );
  process.exit(1);
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
