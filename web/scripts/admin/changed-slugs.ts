import { execFileSync } from "node:child_process";

// Returns the set of vault slugs whose .md file has been modified
// since `ref`. Used by the hash-backfill admin script to skip slugs
// that need to publish naturally.
//
// History: an earlier version passed `${vaultRel}/**.md` as the git
// pathspec, which silently dropped files in nested directories on
// some git versions. Pass the directory and filter to .md in JS.

export function changedSlugsSinceRef(args: {
  cwd: string;
  vaultRel: string;
  ref: string;
}): Set<string> {
  const raw = execFileSync(
    "git",
    [
      "log",
      `${args.ref}..HEAD`,
      "--name-only",
      "--pretty=format:",
      "--",
      `${args.vaultRel}/`,
    ],
    { cwd: args.cwd, encoding: "utf8" },
  );
  return slugsFromGitOutput(raw, args.vaultRel);
}

export function slugsFromGitOutput(
  raw: string,
  vaultRel: string,
): Set<string> {
  const slugs = new Set<string>();
  const prefix = vaultRel.endsWith("/") ? vaultRel : `${vaultRel}/`;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.endsWith(".md")) continue;
    const rel = trimmed.startsWith(prefix)
      ? trimmed.slice(prefix.length)
      : trimmed;
    slugs.add(rel.replace(/\.md$/, ""));
  }
  return slugs;
}
