// Lints the current workspace with the root eslint.config.mjs and ratchets
// warnings against <workspace>/eslint-baseline.json ({ rule: count }, no file
// or no entry means zero).
//
// Fails when: any error is reported; a rule has more warnings than its baseline
// (new backlog); or a rule has fewer warnings than its baseline (stale baseline,
// so the cap is lowered as soon as warnings are fixed). Counts are per rule
// rather than one --max-warnings number per workspace, so fixing one kind of
// warning cannot make room for another, and per workspace rather than per file,
// so moving code between files (several refactors are in flight) does not
// break the ratchet.
//
//   bun run lint            check (each workspace's `lint` script)
//   bun run lint:baseline   rewrite this workspace's baseline after fixing warnings
//
// Unused eslint-disable directives have no rule id and are counted as
// "unused-disable-directive".
import { ESLint } from "eslint";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const UNUSED_DIRECTIVE = "unused-disable-directive";
const cwd = process.cwd();
const update = process.argv.includes("--update");
const baselinePath = path.join(cwd, "eslint-baseline.json");
const workspace = path.relative(path.resolve(import.meta.dir, ".."), cwd) || ".";

const eslint = new ESLint({ cwd, errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(["."]);
const stylish = await eslint.loadFormatter("stylish");

const errors = ESLint.getErrorResults(results);
if (errors.length > 0) {
  process.stdout.write(await stylish.format(errors));
  console.error(`lint ${workspace}: fix the errors above${update ? " before updating the baseline" : ""}.`);
  process.exit(1);
}

const counts: Record<string, number> = {};
for (const result of results) {
  for (const message of result.messages) {
    const rule = message.ruleId ?? UNUSED_DIRECTIVE;
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
}
const sorted = (record: Record<string, number>) =>
  Object.fromEntries(Object.entries(record).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)));

if (update) {
  const next = sorted(counts);
  if (Object.keys(next).length === 0) {
    if (existsSync(baselinePath)) rmSync(baselinePath);
  } else {
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  }
  console.log(`lint ${workspace}: baseline ${JSON.stringify(next)}`);
  process.exit(0);
}

const baseline: Record<string, number> = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : {};
const grown: string[] = [];
const shrunk: string[] = [];
for (const rule of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const actual = counts[rule] ?? 0;
  const allowed = baseline[rule] ?? 0;
  if (actual > allowed) grown.push(`${rule}: ${actual} (baseline ${allowed})`);
  if (actual < allowed) shrunk.push(`${rule}: ${actual} (baseline ${allowed})`);
}

if (grown.length > 0) {
  const grownRules = new Set(grown.map(line => line.slice(0, line.indexOf(":"))));
  const relevant = results
    .map(result => ({
      ...result,
      messages: result.messages.filter(message => grownRules.has(message.ruleId ?? UNUSED_DIRECTIVE)),
    }))
    .filter(result => result.messages.length > 0)
    .map(result => ({ ...result, warningCount: result.messages.length, errorCount: 0, fatalErrorCount: 0 }));
  process.stdout.write(await stylish.format(relevant));
  console.error(`lint ${workspace}: new warnings above the checked-in baseline (${path.relative(cwd, baselinePath)}):`);
  for (const line of grown) console.error(`  ${line}`);
  console.error("Fix the new warnings; the baseline only goes down.");
}
if (shrunk.length > 0) {
  console.error(`lint ${workspace}: fewer warnings than the baseline. Lower it with \`bun run lint:baseline\` in ${workspace} and commit eslint-baseline.json:`);
  for (const line of shrunk) console.error(`  ${line}`);
}
if (grown.length > 0 || shrunk.length > 0) process.exit(1);

const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(`lint ${workspace}: ${results.length} files, no errors${total ? `, ${total} baselined warnings` : ""}.`);
