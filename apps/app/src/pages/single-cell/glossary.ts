/** Plain-language terms the viewer uses. Generic: dataset-specific entries come from the manifest. */
export const SINGLE_CELL_GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Nucleus", meaning: "The command center of a cell. This test reads RNA from nuclei (frozen tissue keeps nuclei better than whole cells), so each dot is one nucleus." },
  { term: "RNA and genes", meaning: "A gene is an instruction; RNA is the working copy a cell makes when it uses that instruction. More RNA for a gene usually means the cell is using it more, but it is not a direct measure of protein." },
  { term: "UMI", meaning: "One counted RNA molecule. \"Median UMIs\" is how many molecules a typical nucleus gave; more means a richer read." },
  { term: "Map (UMAP)", meaning: "A flattening of thousands of gene readings into two dimensions. Nuclei with similar activity land near each other; distance between islands is not meaningful." },
  { term: "Cluster and cell type", meaning: "A cluster is a group the computer found automatically. A cell type is a name given to a group from known marker genes." },
  { term: "Tumor call", meaning: "Cancer cells have extra or missing pieces of chromosomes. Nuclei whose RNA shows that copy-number pattern are called tumor." },
  { term: "Background RNA", meaning: "RNA from broken cells floats in the sample and is picked up by other nuclei. Correction (CellBender) subtracts it; it can also remove some real signal." },
  { term: "% expressing", meaning: "Share of nuclei in a group with at least one RNA molecule of the gene. Low numbers in small immune nuclei can be background." },
  { term: "Mean expression", meaning: "Average of log-normalized counts (RNA per 10,000 molecules, log-scaled) across all nuclei in the group. Compare groups with it, not genes." },
  { term: "Library", meaning: "One run of the test on part of the sample. Two libraries from the same suspension are technical replicates and should agree." },
];
