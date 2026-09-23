/** Local-only paired benchmark. No network, writes to vault, or persisted content cache. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { readVaultAssets, readVaultDocuments } from "../../../packages/oncobase/src/walk-vault";
import { readPublishScope, readPublishSelection } from "../../../packages/oncobase/src/publish-scope";
const { values } = parseArgs({ options: { vault: { type: "string" }, "files-from": { type: "string" }, output: { type: "string" }, repeat: { type: "string", default: "7" } } });
const repeat = Number(values.repeat);
if (!values.vault || !values["files-from"] || !values.output || !Number.isInteger(repeat) || repeat < 3 || repeat > 20) throw Error("Provide --vault, --files-from, --output and optional --repeat 3..20");
if (fs.existsSync(values.output)) throw Error("Choose a new output path");
const scope = readPublishScope(values["files-from"]);
const samples: Array<{ iteration: number; mode: string; durationMs: number; documents: number; assets: number }> = [];
for (let iteration = 0; iteration < repeat; iteration++) {
  let digest: string | undefined;
  for (const mode of iteration % 2 ? ["shared", "separate"] : ["separate", "shared"]) {
    const started = performance.now();
    const selected = mode === "shared" ? readPublishSelection(values.vault, scope, "referenced") : {
      documents: readVaultDocuments(values.vault).filter(doc => scope.has(doc.slug)),
      assets: readVaultAssets(values.vault, { referencedBy: scope }),
    };
    const durationMs = Math.round(performance.now() - started);
    const hash = createHash("sha256").update(JSON.stringify(selected)).digest("hex");
    if (digest && hash !== digest) throw Error("Paired outputs differ; vault changed or selection regressed");
    digest = hash;
    samples.push({ iteration: iteration + 1, mode, durationMs, documents: selected.documents.length, assets: selected.assets.length });
  }
}
const medians = Object.fromEntries(["separate", "shared"].map(mode => {
  const times = samples.filter(s => s.mode === mode).map(s => s.durationMs).sort((a,b) => a-b);
  return [mode, times[Math.floor(times.length/2)]];
}));
const result = { mode: "paired-local-only", equivalentOutputs: true, filesystemCache: "uncontrolled; first read is not guaranteed cold; order alternates", medians, samples };
fs.writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
