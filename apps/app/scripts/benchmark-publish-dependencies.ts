/** Read-only vault comparison. Cache state is isolated and removed afterward. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { readPublishScope, readPublishSelection } from "../../../packages/oncobase/src/publish-scope";
const { values } = parseArgs({ options: { vault: { type: "string" }, "files-from": { type: "string" }, output: { type: "string" }, repeat: { type: "string", default: "7" }, assets: { type: "string", default: "referenced" } } });
const repeat = Number(values.repeat);
if (!values.vault || !values["files-from"] || !values.output || !Number.isInteger(repeat) || repeat < 3 || repeat > 20) throw Error("Provide --vault --files-from --output [--repeat 3..20]");
if (fs.existsSync(values.output)) throw Error("Choose a new output");
if (values.assets !== "none" && values.assets !== "referenced") throw Error("--assets must be none or referenced");
const scope = readPublishScope(values["files-from"]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "publish-dependencies-"));
const modes = ["off", "content", "metadata"] as const;
const samples: Array<{ iteration: number; mode: string; durationMs: number; documents: number; assets: number }> = [];
try {
  for (let iteration = 0; iteration <= repeat; iteration++) {
    let expected: string | undefined;
    for (const mode of [...modes.slice(iteration % 3), ...modes.slice(0, iteration % 3)]) {
      const started = performance.now();
      const result = readPublishSelection(values.vault, scope, values.assets, mode, path.join(directory, mode));
      const durationMs = Math.round(performance.now() - started);
      const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
      if (expected && expected !== digest) throw Error("Outputs differ; vault changed or strategy regressed");
      expected = digest;
      samples.push({ iteration, mode, durationMs, documents: result.documents.length, assets: result.assets.length });
    }
  }
  const medians = Object.fromEntries(modes.map(mode => {
    const times = samples.filter(s => s.mode === mode && s.iteration > 0).map(s => s.durationMs).sort((a,b) => a-b);
    return [mode, times[Math.floor(times.length / 2)]];
  }));
  const result = { mode: "local-dependency-strategies", equivalentOutputs: true, assets: values.assets, cacheColdIteration: 0,
    filesystemCache: "uncontrolled; rotated strategy order; zero remote calls", medians, samples };
  fs.writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
