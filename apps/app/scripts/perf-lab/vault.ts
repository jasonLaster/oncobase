/**
 * Deterministic synthetic vault for the perf lab: about 2,300 pages in nested
 * folders, mixed sizes, some `sensitive: true` pages, and nine very large
 * pages (60 sections, 30 tables of 40 rows). No real data.
 *
 * The generator is a seeded LCG, so the same seed yields byte-identical files.
 * The default seed (42) and the order of every random draw match the scratch
 * harness the proposal's baseline numbers came from. Changing anything here
 * changes the numbers: update VAULT_FINGERPRINT in vault.test.ts on purpose.
 */
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_SEED = 42;

/**
 * `lab`: the original ~2,300-page vault (default; the budgets' baseline).
 * `prod`: the same vault plus pages and assets shaped like production on
 * 2026-11-23 (plans/2026-11-23-opportunities-and-analytics.md, O0): about
 * 8,750 pages in about 1,000 folders, one 6k-page folder with a 4.5k-page
 * subfolder, longer slugs and titles, and about 14,400 tiny assets (91% in
 * one directory, mostly images). Only the shape is production's; every byte
 * is synthetic.
 */
export type VaultScale = "lab" | "prod";
export const VAULT_SCALES: readonly VaultScale[] = ["lab", "prod"];

/** Pages the scenarios rely on. */
export const PAGES = {
  /** Ordinary article for load scenarios. */
  article: "wiki/treatment/treatment-note-1",
  /** ~279 KB page with 30 tables. */
  large: "wiki/treatment/treatment-note-0",
  /** Neighbour of the large page, used to navigate away from it. */
  largeNeighbour: "wiki/treatment/treatment-note-2",
  /** ~10 KB pages reached by tree clicks. */
  small: [3, 7, 11, 15, 19].map((i) => `sources/papers/2024/paper-2024-${i}`),
} as const;

export type VaultFile = { file: string; content: string };
export type VaultStats = {
  seed: number;
  scale: VaultScale;
  pages: number;
  assets: number;
  bytes: number;
  sensitive: number;
  large: number;
  fingerprint: string;
  largePage: { slug: string; bytes: number; tables: number };
  smallPageBytes: number[];
};

const WORDS = "tumor response cycle infusion carboplatin paclitaxel pembrolizumab biopsy margin node staging receptor pathway trial cohort endpoint survival toxicity neuropathy fatigue scan contrast lesion baseline follow-up dose schedule clinic referral insurance appeal summary evidence guideline marker assay mutation variant germline somatic immune checkpoint antibody conjugate regimen adjuvant neoadjuvant surgery radiation recovery nutrition exercise sleep support".split(" ");

type Entry = { file: string; title: string; sensitive: boolean; big: boolean; tags: string[]; sections?: number };

export function buildVault(seed = DEFAULT_SEED, scale: VaultScale = "lab"): { files: VaultFile[]; assets: VaultFile[]; stats: VaultStats } {
  let state = seed;
  const rnd = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rnd() * items.length)]!;
  const sentence = () => {
    const n = 8 + Math.floor(rnd() * 14);
    const s = Array.from({ length: n }, () => pick(WORDS)).join(" ");
    return s[0]!.toUpperCase() + s.slice(1) + ".";
  };
  const para = () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, sentence).join(" ");

  const all: { slug: string; title: string }[] = [];
  const entries: Entry[] = [];
  const add = (dir: string, name: string, title: string, opts: { sensitive?: boolean; big?: boolean; sections?: number } = {}) => {
    entries.push({ file: `${dir}/${name}.md`, title, sensitive: !!opts.sensitive, big: !!opts.big, tags: [dir.split("/")[0]!], ...(opts.sections ? { sections: opts.sections } : {}) });
    all.push({ slug: `${dir}/${name}`, title });
  };

  const topics = ["chemotherapy", "immunotherapy", "surgery", "radiation", "side-effects", "nutrition", "genetics", "imaging", "pathology", "clinical-trials", "survivorship", "mental-health"];
  for (const t of topics) {
    add(`wiki/education/${t}`, "index", `${t} overview`);
    for (let i = 0; i < 16; i++) add(`wiki/education/${t}/${pick(["basics", "advanced", "faq"])}`, `${t}-lesson-${i}`, `${t} lesson ${i}`);
  }
  for (let i = 0; i < 60; i++) add("wiki/treatment", `treatment-note-${i}`, `Treatment note ${i}`, { big: i % 20 === 0 });
  for (let i = 0; i < 40; i++) add("wiki/biomarkers", `marker-${i}`, `Marker ${i}`);
  for (const phase of ["phase-1", "phase-2", "phase-3"]) {
    for (let i = 0; i < 60; i++) add(`wiki/trials/${phase}/${pick(["recruiting", "active", "completed"])}`, `nct0${1000000 + Math.floor(rnd() * 8999999)}`, `Trial ${phase} ${i}`);
  }
  for (let i = 0; i < 30; i++) add("wiki/logistics", `logistics-${i}`, `Logistics ${i}`);
  for (const area of ["tnbc", "brca", "adc", "parp", "io", "ctdna"]) {
    for (const sub of ["mechanism", "evidence", "open-questions"]) {
      for (let i = 0; i < 17; i++) add(`wiki/research/${area}/${sub}`, `${area}-${sub}-${i}`, `${area.toUpperCase()} ${sub} ${i}`, { big: i === 0 && sub === "evidence" });
    }
  }
  for (let y = 2019; y <= 2026; y++) {
    for (let i = 0; i < 62; i++) add(`sources/papers/${y}`, `paper-${y}-${i}`, `Paper ${y}-${i}: ${pick(WORDS)} ${pick(WORDS)} in ${pick(WORDS)}`);
  }
  for (let m = 1; m <= 12; m++) {
    for (let i = 0; i < 8; i++) {
      for (const kind of ["raw", "formatted", "overview"]) add(`sources/meeting-notes/2026-${String(m).padStart(2, "0")}`, `call-${m}-${i}-${kind}`, `Call ${m}/${i} (${kind})`, { sensitive: kind === "raw" });
    }
  }
  for (let m = 1; m <= 12; m++) {
    for (let i = 0; i < 34; i++) add(`sources/emails/2026-${String(m).padStart(2, "0")}`, `email-${m}-${i}`, `Email ${m}/${i}: ${pick(WORDS)} ${pick(WORDS)}`, { sensitive: i % 2 === 0 });
  }
  for (let i = 0; i < 200; i++) add(`labs/${2024 + (i % 3)}`, `lab-${i}`, `Lab panel ${i}`, { sensitive: i % 4 === 0 });
  for (let i = 0; i < 100; i++) add("imaging/reports", `imaging-${i}`, `Imaging report ${i}`);

  // Production-shaped additions. Drawn after every lab entry so the lab
  // scale's draw order, and therefore its bytes, are unchanged.
  const assets: VaultFile[] = [];
  if (scale === "prod") {
    const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join("-");
    const collections = Array.from({ length: 11 }, (_, i) => `c${i}-${pick(WORDS)}`);
    const shards = Array.from({ length: 70 }, (_, i) => `${pick(WORDS)}-${i}`);
    for (let i = 0; i < 6000; i++) {
      // 4,500 land in the first collection, like production's largest subfolder.
      const collection = i < 4500 ? collections[0]! : collections[1 + (i % 10)]!;
      const year = 2015 + (i % 12);
      // Production pages are mostly short (p50 ~5 KB, p95 ~74 KB).
      const sections = i % 20 === 0 ? 24 : 1 + Math.floor(rnd() * 2);
      add(`sources/library/${collection}/${year}/${shards[i % shards.length]}`, `${words(3)}-${i}`, `${words(4).replace(/-/g, " ")}: ${pick(WORDS)} and ${pick(WORDS)} (${year})`, { sensitive: i % 25 === 0, sections });
    }
    for (let i = 0; i < 434; i++) add(`wiki/notes/${pick(WORDS)}`, `${words(3)}-note-${i}`, `Note ${i}: ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}`);
    const imageExts = [...Array(17).fill(".jpg"), ".png", ".png", ".webp", ".svg"];
    for (let i = 0; i < 14_431; i++) {
      const pdf = i % 12 === 0;
      const ext = pdf ? ".pdf" : imageExts[i % imageExts.length]!;
      const dir = i % 11 === 0 ? `attachments/${shards[i % 7]}` : `sources/library/attachments/${collections[i % 11]}/${2015 + (i % 12)}`;
      // Tiny placeholders: the manifest and publisher only see path, kind and hash.
      assets.push({ file: `${dir}/${words(2)}-${i}${ext}`, content: ext === ".svg" ? `<svg xmlns="http://www.w3.org/2000/svg" data-i="${i}"/>` : `synthetic asset ${i}\n` });
    }
  }

  const body = (f: Entry) => {
    const out = [`---`, `title: ${JSON.stringify(f.title)}`, `description: ${JSON.stringify(sentence())}`, ...(f.sensitive ? ["sensitive: true"] : []), `tags:`, ...f.tags.map((t) => `  - ${t}`), `---`, ``, `# ${f.title}`, ``, para(), ``];
    const sections = f.big ? 60 : f.sections ?? 3 + Math.floor(rnd() * 5);
    for (let s = 0; s < sections; s++) {
      out.push(`## ${pick(WORDS)} ${pick(WORDS)} ${s}`, ``, para(), ``);
      const links = Array.from({ length: 3 }, () => pick(all));
      out.push(links.map((l) => `- [${l.title}](/${l.slug}) — ${sentence()}`).join("\n"), ``);
      if (s % 2 === 0) {
        const rows = f.big ? 40 : 5;
        out.push(`| Date | Marker | Value | Range | Note |`, `| --- | --- | ---: | --- | --- |`, ...Array.from({ length: rows }, (_, r) => `| 2026-0${1 + (r % 9)}-1${r % 9} | ${pick(WORDS)} | ${(rnd() * 100).toFixed(1)} | ${Math.floor(rnd() * 10)}–${50 + Math.floor(rnd() * 50)} | ${sentence()} |`), ``);
      }
      if (s % 3 === 1) out.push(`### ${pick(WORDS)} detail`, ``, para(), ``, `> ${sentence()}`, ``);
      if (f.big && s % 10 === 5) out.push(`Dose intensity is $RDI = \\frac{d_{actual}}{d_{planned}} \\times 100$ over the cycle.`, ``);
    }
    return out.join("\n");
  };

  const files = entries.map((f) => ({ file: f.file, content: body(f) }));
  const hash = crypto.createHash("sha256");
  for (const f of files) hash.update(f.file).update("\0").update(f.content).update("\0");
  for (const f of assets) hash.update(f.file).update("\0").update(f.content).update("\0");
  const byteLength = (s: string) => Buffer.byteLength(s, "utf8");
  const find = (slug: string) => files.find((f) => f.file === `${slug}.md`)!.content;
  const large = find(PAGES.large);
  return {
    files,
    assets,
    stats: {
      seed,
      scale,
      pages: files.length,
      assets: assets.length,
      bytes: files.reduce((sum, f) => sum + byteLength(f.content), 0),
      sensitive: entries.filter((f) => f.sensitive).length,
      large: entries.filter((f) => f.big).length,
      fingerprint: hash.digest("hex").slice(0, 16),
      largePage: { slug: PAGES.large, bytes: byteLength(large), tables: large.split("\n").filter((l) => l.startsWith("| Date |")).length },
      smallPageBytes: PAGES.small.map((slug) => byteLength(find(slug))),
    },
  };
}

/** Write the vault to `root`, replacing whatever was there. */
export function writeVault(root: string, seed = DEFAULT_SEED, scale: VaultScale = "lab"): VaultStats {
  const { files, assets, stats } = buildVault(seed, scale);
  rmSync(root, { recursive: true, force: true });
  for (const f of [...files, ...assets]) {
    const target = path.join(root, f.file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
  return stats;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("Usage: bun scripts/perf-lab/vault.ts <dir> [seed] [lab|prod]");
  const scale = (process.argv[4] ?? "lab") as VaultScale;
  if (!VAULT_SCALES.includes(scale)) throw new Error(`Unknown scale ${scale}`);
  const stats = writeVault(path.resolve(root), Number(process.argv[3] ?? DEFAULT_SEED), scale);
  console.log(JSON.stringify(stats));
}
