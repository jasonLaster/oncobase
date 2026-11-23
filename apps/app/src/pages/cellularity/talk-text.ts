import type { CellularityData } from "./types";

const line = (text: string | undefined | null) => (text ?? "").replace(/\s+/g, " ").trim();
const num = (value: number | null | undefined, digits = 1) => (value == null ? "n/a" : value.toFixed(digits));

/** The cellularity explorer as text for "Talk with the page". Headings repeat
 * the page's own so point_to_section can scroll to them. Built from the same
 * data.json the page renders, so the voice sees what the reader sees. */
export function cellularityTalkText(data: CellularityData): string {
  const { header, specimen, anatomy, focus_explorer: focus, blocks_section: blocks, reconcile } = data.report;
  const out: string[] = [];
  const push = (...parts: string[]) => out.push(...parts.filter(Boolean));

  push(`# ${header.title}`, line(header.subtitle), `Context: ${header.eyebrow}. ${header.pills.map((p) => p.text).join("; ")}.`);
  push("## What the page says in short");
  for (const card of header.summary_cards) {
    push(`- ${card.source} (${card.badge}): ${card.stat} ${card.unit}. ${line(card.body)}`);
  }

  push(`## ${specimen.section_title}`, line(specimen.section_subtitle), `Orientation and 3D note: ${line(specimen.orientation_note)}`);
  push(
    `The tumor bed is about ${specimen.bed_length_mm} mm long, ${specimen.bed_width_mm} mm wide and ${specimen.bed_depth_mm} mm deep. ` +
      `The 3D views are: a WebGL tumor model, breadloaf slices, a 2D top-down map and a grid of all bed blocks. ` +
      `Color shows keratin area percent per field on a compressed scale up to 33%, so 1 to 5% stays visible. ` +
      `Solid outlines are real scanned slides and dashed blue outlines are virtual (interpolated) slices.`,
  );
  push(`Focus block: ${specimen.focus_block}. Biopsy cavity block: ${specimen.cavity_block}.`);
  push("### Slices");
  for (const s of data.slices) {
    const st = s.stats;
    push(
      `- ${s.label} (slice ${s.slice_num}, ${s.part}, ${s.scanned ? (s.kind === "virtual" ? "virtual" : "scanned") : "not scanned"}${s.in_bed ? ", in bed" : ""})` +
        (st ? `: whole-area cellularity ${num(st.whole_area)}%, hottest field ${num(st.max1)}%, ${st.n_ge5} fields at or above 5%` : "") +
        (s.report_note ? `. Report note: ${line(s.report_note)}` : ""),
    );
  }
  const pooled = data.summary.pooled_breast;
  push(`Pooled breast blocks: ${num(pooled.whole_area)}% whole-area across ${num(pooled.specimen_mm2, 0)} mm2 of specimen.`);

  push(`## ${anatomy.title}`, line(anatomy.subtitle), line(anatomy.scale_note));
  push(`Lymph nodes: ${anatomy.nodes_box.items.map((i) => line(i.text)).join("; ")}. ${line(anatomy.nodes_box.footer)}`);

  push(`## ${focus.section_title}`, line(focus.section_subtitle), `Slider: ${focus.slider_title}.`);
  push(`Reference lines: ${focus.ref_lines.map((r) => `${r.pct}% ${r.label}`).join("; ")}.`);
  push(`Verdicts by number of fields counted: ${focus.verdicts.map((v) => `up to ${v.max_k}: ${line(v.text)}`).join(" | ")}`);
  push(line(focus.footnote));
  for (const d of [focus.hotfields_drawer, focus.serial_drawer, focus.recount_drawer]) push(`### ${d.title}`, line(d.meta), line(d.body));

  push(`## ${blocks.title}`, line(blocks.subtitle));
  for (const d of [blocks.validation_drawer, blocks.qc_drawer]) push(`### ${d.title}`, line(d.meta), line(d.body));
  push(`### ${blocks.method_drawer.title}`);
  for (const tab of blocks.method_drawer.tabs) push(`- ${tab.label}: ${line(tab.body)} ${(tab.bullets ?? []).map(line).join(" ")}`);

  push(`## ${reconcile.title}`, line(reconcile.subtitle));
  for (const r of reconcile.rows) {
    push(`- Reported ${line(r.reported)} (${line(r.reported_sub)}) describes ${line(r.describes)}; measured ${line(r.measured)}; verdict: ${line(r.verdict)}`);
  }
  push(`Comparison bars: ${reconcile.compare_bars.map((b) => `${b.label} ${b.value}% (${line(b.detail)})`).join("; ")}. ${line(reconcile.compare_footnote)}`);
  const rcb = reconcile.rcb;
  push(
    `### Residual cancer burden sensitivity`,
    `${line(rcb.subtitle)} Inputs: tumor bed ${rcb.d1_mm} by ${rcb.d2_mm} mm, ${rcb.positive_nodes} positive nodes, largest metastasis ${rcb.max_met_mm} mm. The calculator varies overall cellularity (default ${rcb.default_ca}%). Landmarks: ${rcb.landmarks.map((l) => `${l.ca}% ${l.label}`).join("; ")}.`,
  );
  push("### Limits");
  for (const lim of reconcile.limits) push(`- ${lim.title}: ${line(lim.body)}`);

  push(`Footer: ${line(header.footer_note)}`);
  return out.join("\n\n");
}
