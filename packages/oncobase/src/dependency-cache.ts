import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Contains dependency metadata only, never document bodies or credentials.
export type DocumentDependency = {
  relativePath: string;
  document: { slug: string; sensitive: boolean; sensitiveInclude: string[] };
  references: string[];
};
export type DependencyCacheMode = "content" | "metadata" | "off" | "refresh";
type Cached = { fingerprint: string; dependency: DocumentDependency };
const VERSION = 1; // Bump for parsing, sensitivity, reference or exclusion semantics.
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");
function valid(value: Cached, relativePath: string) {
  const dep = value?.dependency;
  return typeof value?.fingerprint === "string" && dep?.relativePath === relativePath &&
    dep.document?.slug === relativePath.replace(/\.(?:md|mdx)$/i, "") &&
    typeof dep.document.sensitive === "boolean" && strings(dep.document.sensitiveInclude) && strings(dep.references);
}
function stamp(file: string) {
  const s = fs.statSync(file, { bigint: true });
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
}

export function dependencyCachePath(vault: string, directory = path.join(os.homedir(), ".cache", "oncobase-publish")) {
  return path.join(directory, `${digest(fs.realpathSync(vault))}.json`);
}

/** Two independently selectable strategies for measurement. Content mode verifies
 * every source's bytes; metadata mode trusts device/inode/size/mtime/ctime. */
export function readDependencies(options: {
  vault: string; entries: Array<{ relativePath: string; filePath: string }>;
  mode: DependencyCacheMode; directory?: string;
  parse: (relativePath: string, raw: string) => DocumentDependency;
}) {
  const file = dependencyCachePath(options.vault, options.directory);
  const strategy = options.mode === "metadata" ? "metadata" : "content";
  let previous: Record<string, Cached> = Object.create(null);
  if (options.mode !== "off" && options.mode !== "refresh") {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw Error("Invalid cache");
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      if (envelope.version !== VERSION || envelope.strategy !== strategy || typeof envelope.payload !== "string" || digest(envelope.payload) !== envelope.digest) throw Error("Invalid cache");
      const parsed = JSON.parse(envelope.payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("Invalid cache");
      previous = parsed;
    } catch { /* Disposable state: missing/corrupt/old caches become cold reads. */ }
  }
  const next: Record<string, Cached> = Object.create(null);
  let parsedDocuments = 0, reusedDocuments = 0;
  const dependencies = options.entries.map(({ relativePath, filePath }) => {
    const before = stamp(filePath);
    let raw: string | undefined;
    const fingerprint = strategy === "metadata" ? before : digest(raw = fs.readFileSync(filePath, "utf8"));
    const cached = Object.prototype.hasOwnProperty.call(previous, relativePath) ? previous[relativePath] : undefined;
    let dependency: DocumentDependency;
    if (cached && valid(cached, relativePath) && cached.fingerprint === fingerprint) {
      dependency = cached.dependency;
      reusedDocuments++;
    } else {
      raw ??= fs.readFileSync(filePath, "utf8");
      dependency = options.parse(relativePath, raw);
      parsedDocuments++;
    }
    if (before !== stamp(filePath)) throw Error("Vault changed while indexing dependencies; retry publish");
    next[relativePath] = { fingerprint, dependency };
    return dependency;
  });
  if (options.mode !== "off" && (parsedDocuments || Object.keys(previous).length !== options.entries.length)) {
    let temporary: string | undefined;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const payload = JSON.stringify(next);
      temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: VERSION, strategy, digest: digest(payload), payload }), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch { /* An unavailable cache never blocks correct publishing. */ }
    finally { if (temporary) { try { fs.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ } } }
  }
  return { dependencies, parsedDocuments, reusedDocuments };
}
