#!/usr/bin/env node
import { readFlag } from "./cli";
import { runSync } from "./sync";

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
if (!site) {
  console.error("Usage: oncobase sync --site <slug>");
  process.exit(1);
}

await runSync({ site });
