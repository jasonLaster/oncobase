import { formatCount, type SingleCellManifest } from "./data";
import { SINGLE_CELL_GLOSSARY } from "./glossary";

const line = (text: string | undefined | null) => (text ?? "").replace(/\s+/g, " ").trim();

/** The single-cell viewer as text for "Talk with the page". Headings repeat
 * the page's own so point_to_section can scroll to them. Built from the same
 * manifest the page renders. */
export function singleCellTalkText(manifest: SingleCellManifest): string {
  const { dataset } = manifest;
  const out: string[] = [`# ${dataset.title}`, line(dataset.summary)];
  out.push("## Quality summary");
  for (const library of manifest.libraries) {
    const { qc } = library;
    out.push(`- ${library.label}: ${formatCount(qc.nucleiShown)} nuclei shown of ${formatCount(qc.nucleiCalled)} called; median ${formatCount(qc.medianGenes)} genes and ${formatCount(qc.medianUmis)} RNA molecules (UMIs) per nucleus` +
      (qc.tumourNuclei != null ? `; ${formatCount(qc.tumourNuclei)} called tumor.` : "."));
  }
  out.push("## About this sample", line(dataset.specimen), line(dataset.labelSource), line(dataset.countsNote));
  if (dataset.caveats?.length) out.push(...dataset.caveats.map((c) => `- ${line(c)}`));
  out.push("## Gene panel");
  const groups = new Map<string, string[]>();
  for (const gene of manifest.genes) {
    const text = `${gene.symbol}${gene.name && gene.name !== gene.symbol ? ` (${gene.name})` : ""}: ${line(gene.why)}` +
      (gene.reliability === "caution" ? ` Caution: ${line(gene.note)}` : gene.note ? ` ${line(gene.note)}` : "");
    groups.set(gene.group, [...(groups.get(gene.group) ?? []), text]);
  }
  for (const [group, genes] of groups) out.push(`### ${group}`, ...genes.map((g) => `- ${g}`));
  out.push("## What the words mean", ...[...SINGLE_CELL_GLOSSARY, ...(manifest.glossary ?? [])].map((g) => `- ${g.term}: ${g.meaning}`));
  if (dataset.sources?.length) out.push("## Sources", ...dataset.sources.map((s) => `- ${s.label}`));
  return out.filter(Boolean).join("\n");
}
