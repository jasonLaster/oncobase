import type { BlockGrid, BlockRow, CellularityData, SliceMeta } from "../src/pages/cellularity/types";

// Synthetic numbers only: this repository is public, so nothing here comes from a real specimen.
const BLOCKS = ["B3", "B4", "B5", "B6", "B7", "B8"];
const EMPTY_MESH = { v: [0, 0, 0, 1, 0, 0, 0, 1, 0], f: [0, 1, 2] };

function grid(seed: number): BlockGrid {
  const cols = 10;
  const rows = 8;
  const tissue = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
  const bed = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r > 1 && r < 6 && c > 2 && c < 8 ? 1 : 0)),
  );
  const fields: [number, number, number, number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) fields.push([c, r, ((r * cols + c + seed) % 9) * 1.5, r, c]);
  }
  return {
    cols,
    rows,
    w_mm: cols,
    h_mm: rows,
    plane_w_mm: 20,
    plane_h_mm: 16,
    plane_off_z: 0,
    plane_off_y: 0,
    y0: 0,
    x0: 0,
    n: cols * rows,
    aligned: true,
    align_note: "Synthetic alignment",
    tissue,
    bed,
    fields,
    si_profile: Array.from({ length: cols }, (_, i) => [1, i % 5, i % 3] as [number, number, number]),
    sil_rows: Array.from({ length: 12 }, () => "1".repeat(16)),
    sil_h: 12,
    sil_w: 16,
  };
}

function row(block: string, i: number, part = "breast"): BlockRow {
  return {
    block,
    part,
    method: i % 2 ? "virtual-panck" : "keratin",
    specimen_mm2: 200 + i,
    keratin_mm2: 1 + i,
    n_fields: 80,
    whole_area: 0.5 + i,
    whole_solid: 0.8 + i,
    tight_area: 1 + i,
    tight_solid: 1.5 + i,
    snapped: 1,
    max1: 5 + i,
    max2: 4 + i,
    n_ge5: i,
    bed_mm2: 40,
  };
}

function slice(id: string, i: number): SliceMeta {
  return {
    id,
    label: `${id} slice`,
    slice_num: i + 1,
    part: "breast",
    in_bed: true,
    scanned: true,
    kind: i % 2 ? "virtual" : "keratin",
    x0_mm: i * 5,
    x1_mm: i * 5 + 4,
    report_note: `Synthetic note for ${id}`,
    margins: [],
  };
}

const drawer = (title: string) => ({ title, meta: `${title} meta`, body: `${title} body`, img: "figure.png" });
const total = 40;
const series = (scale: number) => Array.from({ length: total }, (_, i) => scale * (1 + (i % 7)));

export function syntheticCellularityData(): CellularityData {
  const rows = BLOCKS.map((b, i) => row(b, i));
  return {
    summary: {
      rows: [...rows, row("C1", 7, "shave")],
      pooled_breast: {
        block: "pooled",
        keratin_mm2: 10,
        specimen_mm2: 1000,
        whole_area: 1,
        blocks: BLOCKS,
        measured_only: { block: "measured", keratin_mm2: 5, specimen_mm2: 500, whole_area: 1, blocks: BLOCKS },
      },
    },
    slices: BLOCKS.map(slice),
    non_bed_notes: {},
    grids: Object.fromEntries([...BLOCKS, "C1"].map((b, i) => [b, grid(i)])),
    meshes_3d: {
      specimen_hull: EMPTY_MESH,
      dense_core_5: EMPTY_MESH,
      dense_core_12: EMPTY_MESH,
      sparse_halo: EMPTY_MESH,
      biopsy_cavity: EMPTY_MESH,
      slice_contours: {},
      stats: { core5_mm3: 1, core12_mm3: 1, halo_mm3: 1, b6_focus_pos: [0, 0, 0], b3_cav_pos: [0, 0, 0] },
    },
    b6_cum: {
      area: series(1),
      nlo: series(1.5),
      nmid: series(2),
      nhi: series(2.5),
      order: Array.from({ length: total }, (_, i) => [i % 10, Math.floor(i / 10), 3, 1] as [number, number, number, number]),
      n_ge5: 5,
      n_tight: 20,
      total,
      N1: [1, 2, 3],
      N2: [1, 2, 3],
      focus_mm2: 5,
    },
    f33: { dab: 1, brown: 1, ink: 1, fill: 1, final: 30, ink_px: 1, solid: 90, tot: 100, side_um: 1000, field_mm2: 1, ker_mm2: 0.3, no_ink: 32 },
    validation: {
      threshold: 0.05,
      held_out: {},
      blocks: {},
      sensitivity: Object.fromEntries(
        [0.03, 0.05, 0.07, 0.09].map((t) => [String(t), Object.fromEntries(BLOCKS.map((b) => [b, t * 10]))]),
      ),
    },
    rcb_points: {},
    report: {
      header: {
        eyebrow: "Synthetic",
        title: "Synthetic cellularity explorer",
        subtitle: "Fixture data",
        nav_focus_label: "Focus",
        pills: [{ text: "Synthetic pill" }],
        summary_cards: [{ source: "Fixture", badge: "OK", badge_tone: "ok", stat: "1", unit: "%", body: "Card body" }],
        footer_note: "Footer",
      },
      specimen: {
        bed_length_mm: 40,
        bed_width_mm: 20,
        bed_depth_mm: 10,
        focus_block: "B6",
        cavity_block: "B3",
        breast_blocks: BLOCKS,
        extra_blocks: [{ id: "C1", label: "C1 shave" }],
        section_title: "Bed",
        section_subtitle: "Bed subtitle",
        orientation_note: "Orientation",
        ink_drawer: drawer("Ink alignment"),
        box_label: "Box",
        shaves_label: "Shaves",
        lateral_shave_label: "Lateral",
        virtual_badge_label: "virtual",
        real_badge_label: "real",
        legend_virtual_label: "Virtual",
        legend_real_label: "Real",
        model3d: {
          focus_pin_label: "Focus",
          cavity_pin_label: "Cavity",
          cavity_toggle_label: "Biopsy cavity",
          cavity_legend_label: "Cavity",
          focus_preset_label: "Focus",
          medial_axis_label: "Medial",
        },
      },
      anatomy: {
        title: "Anatomy",
        subtitle: "Anatomy subtitle",
        scale_note: "Scale",
        outer_bed: { x0_mm: 0, x1_mm: 30, label: "Outer bed", left_tag: "L", right_tag: "R" },
        superior_shave: { x0_mm: 0, x1_mm: 10, label: "Superior" },
        medial_shave: { lines: ["Medial"] },
        lateral_shave: { block_id: "C1", lines: ["Lateral"] },
        ruler_label: "mm",
        left_ink_label: "Left ink",
        right_ink_label: "Right ink",
        nodes_box: { title: "Nodes", subtitle: "0/1", items: [{ text: "Node 1" }], footer: "Footer" },
      },
      focus_explorer: {
        block_id: "B6",
        section_title: "Focus explorer",
        section_subtitle: "Explorer subtitle",
        slider_title: "Area circled",
        presets: [
          { k: 1, label: "1 field" },
          { k: 5, label: "Dense focus" },
          { k: 40, label: "Whole block" },
        ],
        default_k: 5,
        slider_ticks: ["1", "40"],
        ref_lines: [{ pct: 10, label: "Ten percent" }],
        verdicts: [{ max_k: 40, text: "Matches" }],
        footnote: "Footnote",
        hotfields_drawer: { ...drawer("Hot fields"), rows: [["A", "1 mm", "1%", "2%", "3%"]] },
        serial_drawer: {
          ...drawer("Serial sections"),
          tabs: [
            { key: "a", label: "Section A", img: "a.png" },
            { key: "b", label: "Section B", img: "b.png" },
          ],
        },
        recount_drawer: drawer("Recount"),
      },
      blocks_section: {
        title: "All blocks",
        subtitle: "Blocks subtitle",
        pooled_label: "Pooled",
        measured_label: "Measured",
        sensitivity_blocks: [{ block: "B6", color: "#d9481f" }],
        validation_drawer: { ...drawer("Validation"), footnote: "Validation footnote" },
        qc_drawer: drawer("QC crops"),
        method_drawer: {
          title: "Method",
          meta: "Method meta",
          tabs: [
            { key: "stain", label: "Stain", body: "Stain body" },
            { key: "count", label: "Count", body: "Count body", bullets: ["Count bullet"] },
          ],
        },
      },
      reconcile: {
        title: "Reconcile",
        subtitle: "Reconcile subtitle",
        rows: [{ reported: "1%", reported_sub: "report", describes: "bed", measured: "1%", verdict: "ok" }],
        compare_bars: [{ label: "Report", value: 1, kind: "rep", detail: "detail" }],
        compare_legend: { rep: "Report", foc: "Focus", bed: "Bed" },
        compare_footnote: "Compare footnote",
        rcb: {
          d1_mm: 20,
          d2_mm: 10,
          positive_nodes: 0,
          max_met_mm: 0,
          default_ca: 1,
          subtitle: "RCB subtitle",
          presets: [
            { ca: 0.1, label: "0.1%" },
            { ca: 1, label: "1%" },
            { ca: 10, label: "10%" },
          ],
          landmarks: [],
        },
        limits: [{ title: "Limit", body: "Limit body" }],
      },
    },
  };
}
