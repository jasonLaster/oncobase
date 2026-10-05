#!/usr/bin/env bun
// Writes the agent-readable files (llms.txt, the features.md twin of /features, and the compare.md twin of /compare) from the same data the pages render.
//   bun scripts/build-llms-txt.ts
import { writeFileSync } from "node:fs";
import { renderCompareMd } from "../src/pages/compare-data";
import { renderFeaturesMd, renderLlmsTxt } from "../src/pages/features-data";

const publicDir = new URL("../public/", import.meta.url);
writeFileSync(new URL("llms.txt", publicDir), renderLlmsTxt());
writeFileSync(new URL("features.md", publicDir), renderFeaturesMd());
writeFileSync(new URL("compare.md", publicDir), renderCompareMd());
console.log("Wrote public/llms.txt, public/features.md, and public/compare.md");
