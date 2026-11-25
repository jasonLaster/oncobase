import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseVaultDocumentSource } from "./walk-vault";

export type PastVersion = {
  title: string;
  content: string;
  tags: string[];
  sensitive: boolean;
  sensitiveInclude: string[];
  /** Commit time, epoch ms. */
  versionAt: number;
  commitSha: string;
  commitMessage?: string;
};

type Revision = { sha: string; time: number; subject: string; gitPath: string };

const RECORD = "\x1e";
const FIELD = "\x1f";
const CAT_FILE_CHUNK = 400;

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** Read many blobs in one `git cat-file --batch` per chunk. */
function readBlobs(gitRoot: string, specs: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < specs.length; i += CAT_FILE_CHUNK) {
    const chunk = specs.slice(i, i + CAT_FILE_CHUNK);
    const result = spawnSync("git", ["cat-file", "--batch"], { cwd: gitRoot, input: `${chunk.join("\n")}\n`, maxBuffer: 1024 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git cat-file failed: ${result.stderr.toString()}`);
    const buffer = result.stdout;
    let offset = 0;
    for (const spec of chunk) {
      const newline = buffer.indexOf(10, offset);
      const header = buffer.subarray(offset, newline).toString("utf8");
      offset = newline + 1;
      if (header.endsWith(" missing")) continue;
      const size = Number(header.split(" ")[2]);
      out.set(spec, buffer.subarray(offset, offset + size).toString("utf8"));
      offset += size + 1;
    }
  }
  return out;
}

/**
 * Every committed revision of each requested page, parsed exactly as publish
 * parses the working tree. Renames are not followed: a page's history starts
 * at its current path. Newest first, at most `maxPerPage` per page.
 */
export function readDocumentHistory(vaultPath: string, slugs: ReadonlySet<string>, options: { maxPerPage?: number } = {}) {
  const resolved = fs.realpathSync(vaultPath);
  const gitRoot = fs.realpathSync(git(resolved, ["rev-parse", "--show-toplevel"]).trim());
  const vaultRel = path.relative(gitRoot, resolved).split(path.sep).join("/");
  const prefix = vaultRel ? `${vaultRel}/` : "";
  // quotePath=false keeps non-ASCII paths literal, one per line.
  const log = git(gitRoot, [
    "-c", "core.quotePath=false",
    "log", "--no-renames", "--diff-filter=AM", "--name-only",
    `--format=${RECORD}%H${FIELD}%ct${FIELD}%s`,
    "HEAD", "--", vaultRel || ".",
  ]);
  const maxPerPage = options.maxPerPage ?? 200;
  const revisions = new Map<string, Revision[]>();
  for (const record of log.split(RECORD)) {
    if (!record.trim()) continue;
    const [header, ...names] = record.split("\n").filter(Boolean);
    const [sha, time, subject = ""] = header.split(FIELD);
    for (const gitPath of names) {
      if (!gitPath.startsWith(prefix) || !/\.(?:md|mdx)$/i.test(gitPath)) continue;
      const slug = gitPath.slice(prefix.length).replace(/\.(?:md|mdx)$/i, "");
      if (!slugs.has(slug)) continue;
      const list = revisions.get(slug) ?? [];
      if (list.length >= maxPerPage) continue;
      list.push({ sha, time: Number(time) * 1000, subject, gitPath });
      revisions.set(slug, list);
    }
  }

  const specs = [...revisions.values()].flat().map(rev => `${rev.sha}:${rev.gitPath}`);
  const blobs = readBlobs(gitRoot, specs);
  const history = new Map<string, PastVersion[]>();
  for (const [slug, list] of revisions) {
    const versions: PastVersion[] = [];
    for (const rev of list) {
      const raw = blobs.get(`${rev.sha}:${rev.gitPath}`);
      if (raw === undefined) continue;
      const doc = parseVaultDocumentSource(rev.gitPath.slice(prefix.length), raw);
      versions.push({
        title: doc.title,
        content: doc.content,
        tags: doc.tags,
        sensitive: doc.sensitive,
        sensitiveInclude: doc.sensitiveInclude,
        versionAt: rev.time,
        commitSha: rev.sha,
        ...(rev.subject ? { commitMessage: rev.subject } : {}),
      });
    }
    history.set(slug, versions);
  }
  return history;
}

/** Split one page's versions into request bodies under the function body cap. */
export function batchVersions(versions: PastVersion[], { maxCount = 200, maxBytes = 3 * 1024 * 1024 } = {}) {
  const batches: PastVersion[][] = [];
  let current: PastVersion[] = [];
  let bytes = 0;
  for (const version of versions) {
    const size = Buffer.byteLength(JSON.stringify(version));
    if (current.length && (current.length >= maxCount || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(version);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}
