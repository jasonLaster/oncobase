/** Compare emitted server modules in fresh Node processes. Import only: no
 * network requests, production credentials, or handler invocations. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readerServerModules } from "./reader-server-budget";

const [baseline, candidate, output] = process.argv.slice(2);
if (!baseline || !candidate || !output) throw new Error("Pass baseline directory, candidate directory and JSON output path");
const builds = Object.fromEntries(Object.entries({ baseline, candidate }).map(([mode, directory]) => {
  const resolved = path.resolve(directory);
  return [mode, { directory: resolved, ...readerServerModules(resolved) }];
}));
const samples: Array<{ mode: string; run: number; node: string; importMs: number }> = [];
for (let run = 1; run <= 5; run++) {
  for (const mode of run % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
    const build = builds[mode];
    const result = Bun.spawnSync(["node", "--input-type=module", "--eval",
      "const start=performance.now();await import(process.argv[1]);console.log(JSON.stringify({node:process.version,importMs:performance.now()-start}));",
      pathToFileURL(path.join(build.directory, build.handler)).href],
    { stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    if (result.exitCode !== 0) throw new Error(`Module import failed for ${mode}: ${result.stderr.toString()}`);
    const sample = { mode, run, ...JSON.parse(result.stdout.toString()) };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
}
await writeFile(output, JSON.stringify({ conditions: "Fresh local Node processes; emitted HTML handler import only; no network or handler invocation",
  builds: Object.fromEntries(Object.entries(builds).map(([mode, build]) => [mode, { bytes: build.bytes, modules: build.files.length }])), samples }, null, 2));
