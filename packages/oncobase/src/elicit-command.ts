#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadElicitApiKey } from "./config";
import {
  formatElicitOutput,
  parseElicitArgs,
  searchElicit,
  type ElicitSearchEnvelope,
} from "./elicit";

function usage() {
  console.error(`Usage:
  oncobase elicit papers <query> [options]
  oncobase elicit trials <query> [options]

Common options:
  --query <text>             Alternative to the positional query.
  --max-results <n>          Results to return. Default: 10.
  --search-mode <mode>       semantic (default) or keyword.
  --format <format>          json (default) or markdown.
  --output <file>            Write output to a file instead of stdout.

Paper options:
  --corpus <corpus>          elicit (default) or pubmed.
  --min-year <year>          Earliest publication year.
  --max-year <year>          Latest publication year.
  --max-quartile <1-4>       Highest journal quartile number.
  --include-keyword <text>   Required keyword; repeatable or comma-separated.
  --exclude-keyword <text>   Excluded keyword; repeatable or comma-separated.
  --type-tag <type>          Review, Meta-Analysis, Systematic Review, RCT, or Longitudinal.
  --has-pdf                  Require an available PDF.
  --include-retracted        Include retracted papers.
  --only-retracted           Return only retracted papers.

Trial options:
  --phase <phase>            Trial phase; repeatable or comma-separated.
  --status <status>          Recruitment status; repeatable or comma-separated.
  --has-results              Require posted results.

Authentication:
  Set ELICIT_API_KEY or store the key in ~/.config/oncobase/elicit.token (mode 0600).

Keyword search cannot be combined with filter options.`);
}

function countResults(envelope: ElicitSearchEnvelope) {
  return "papers" in envelope.response
    ? envelope.response.papers.length
    : envelope.response.trials.length;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  try {
    const options = parseElicitArgs(args);
    const envelope = await searchElicit(options, loadElicitApiKey());
    const output = formatElicitOutput(envelope, options.format);
    if (options.output) {
      const outputPath = path.resolve(options.output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, output, { mode: 0o600 });
      console.error(`Wrote ${countResults(envelope)} ${options.kind} to ${outputPath}`);
      return;
    }
    process.stdout.write(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exitCode = 1;
  }
}

await main();
