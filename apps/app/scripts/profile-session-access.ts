/** Synthetic session cache-key experiment: no user records or credentials. */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadAllowedSensitiveSlugs } from "../server/allowed-sensitive-slugs";

const documents = Array.from({ length: 2500 }, (_, index) => ({ slug: `fixture/${index}`, sensitive: index % 5 !== 0 }));
const expected = documents.filter(document => document.sensitive && Number(document.slug.split("/")[1]) % 3 === 0).map(document => document.slug);
const samples = [];
for (const latency of [20, 50]) for (let run = 1; run <= 3; run++) {
  for (const mode of run % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
    let pageCalls = 0, accessCalls = 0, active = 0, peak = 0;
    const read = async (cursor: string | null, numItems: number) => {
      pageCalls++;
      await Bun.sleep(latency);
      const start = Number(cursor ?? 0);
      return { page: documents.slice(start, start + numItems), isDone: start + numItems >= documents.length, continueCursor: String(start + numItems) };
    };
    const check = async (slugs: string[]) => {
      accessCalls++;
      peak = Math.max(peak, ++active);
      await Bun.sleep(latency);
      active--;
      return slugs.map(slug => ({ slug, allowed: Number(slug.split("/")[1]) % 3 === 0 }));
    };
    const started = performance.now();
    let allowed: string[] = [];
    if (mode === "candidate") allowed = await loadAllowedSensitiveSlugs(read, check);
    else {
      let cursor: string | null = null;
      while (true) {
        const page = await read(cursor, 100);
        const sensitive = page.page.filter(document => document.sensitive).map(document => document.slug);
        if (sensitive.length) allowed.push(...(await check(sensitive)).filter(result => result.allowed).map(result => result.slug));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    if (JSON.stringify(allowed) !== JSON.stringify(expected)) throw new Error("Access results changed");
    const sample = { mode, run, latency, durationMs: Math.round(performance.now() - started), pageCalls, accessCalls, peakConcurrency: peak, sameAccessResults: true };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
}
mkdirSync(".playwright/overnight", { recursive: true });
writeFileSync(".playwright/overnight/session-access-samples.json", JSON.stringify({ documents: documents.length, sensitiveDocuments: documents.filter(document => document.sensitive).length, samples }, null, 2) + "\n");
