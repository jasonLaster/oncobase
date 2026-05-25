#!/usr/bin/env node
import { readFlag } from "./cli";
import { syncSkills } from "./skills";

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
if (!site) {
  console.error("Usage: oncobase skills --site <slug>");
  process.exit(1);
}

syncSkills(site);
