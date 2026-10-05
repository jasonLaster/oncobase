#!/usr/bin/env bun
// Writes the agent-readable files from the same data the features page renders.
//   bun scripts/build-llms-txt.ts
import { writeFileSync } from "node:fs";
import { renderLlmsFullTxt, renderLlmsTxt } from "../src/pages/features-data";

const publicDir = new URL("../public/", import.meta.url);
writeFileSync(new URL("llms.txt", publicDir), renderLlmsTxt());
writeFileSync(new URL("llms-full.txt", publicDir), renderLlmsFullTxt());
console.log("Wrote public/llms.txt and public/llms-full.txt");
