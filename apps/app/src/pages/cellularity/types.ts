export type BlockRow = {
  block: string;
  part: string;
  method: string;
  specimen_mm2: number;
  keratin_mm2: number;
  n_fields: number;
  whole_area: number;
  whole_solid: number;
  tight_area: number | null;
  tight_solid: number | null;
  snapped: number;
  max1: number;
  max2: number;
  n_ge5: number;
  bed_mm2: number;
  virtual_whole_area?: number;
  virtual_max1?: number;
};

export type PooledStats = {
  block: string;
  keratin_mm2: number;
  specimen_mm2: number;
  whole_area: number;
  blocks: string[];
};

export type SliceMeta = {
  id: string;
  label: string;
  slice_num: number;
  part: string;
  in_bed: boolean;
  scanned: boolean;
  kind: "keratin" | "virtual" | null;
  x0_mm: number;
  x1_mm: number;
  report_note: string;
  margins: string[];
  stats?: BlockRow;
};

export type BlockGrid = {
  cols: number;
  rows: number;
  w_mm: number;
  h_mm: number;
  plane_w_mm: number;
  plane_h_mm: number;
  plane_off_z: number;
  plane_off_y: number;
  y0: number;
  x0: number;
  n: number;
  aligned: boolean;
  align_note: string;
  tissue: number[][];
  bed: number[][];
  /** [col, row, pct, gy, gx] */
  fields: [number, number, number, number, number][];
  /** [hasTissue, maxCa, meanCa] per column (Superior -> Inferior) */
  si_profile: [number, number, number][];
  sil_rows: string[];
  sil_h: number;
  sil_w: number;
};

export type PackedMesh = {
  v: number[];
  f: number[];
};

export type SliceContour = {
  x: number;
  pts: [number, number][];
  top_y: number;
};

export type Meshes3D = {
  specimen_hull: PackedMesh;
  dense_core_5: PackedMesh;
  dense_core_12: PackedMesh;
  sparse_halo: PackedMesh;
  biopsy_cavity: PackedMesh;
  slice_contours: Record<string, SliceContour>;
  stats: {
    core5_mm3: number;
    core12_mm3: number;
    halo_mm3: number;
    b6_focus_pos: [number, number, number];
    b3_cav_pos: [number, number, number];
  };
};

export type B6Cumulative = {
  area: number[];
  nlo: number[];
  nmid: number[];
  nhi: number[];
  /** [col, row, ca, tight] */
  order: [number, number, number, number][];
  n_ge5: number;
  n_tight: number;
  total: number;
  N1: [number, number, number];
  N2: [number, number, number];
  focus_mm2: number;
};

export type F33Steps = {
  dab: number;
  brown: number;
  ink: number;
  fill: number;
  final: number;
  ink_px: number;
  solid: number;
  tot: number;
  side_um: number;
  field_mm2: number;
  ker_mm2: number;
  no_ink: number;
};

export type ValidationData = {
  threshold: number;
  held_out: Record<string, { n: number; pearson: number; real_max: number; virt_max: number }>;
  blocks: Record<string, Record<string, number | string | null>>;
  sensitivity: Record<string, Record<string, number>>;
};

export type RcbParams = {
  d1_mm: number;
  d2_mm: number;
  positive_nodes: number;
  max_met_mm: number;
  pct_in_situ?: number;
};

export type ReportContent = {
  header: {
    eyebrow: string;
    title: string;
    subtitle: string;
    nav_focus_label: string;
    report_link?: { label: string; to: string };
    pills: { text: string; tone?: "keratin" | "virtual" | "warn" }[];
    summary_cards: {
      source: string;
      badge: string;
      badge_tone: "ok" | "blue" | "red";
      stat: string;
      unit: string;
      body: string;
    }[];
    footer_note: string;
  };
  specimen: {
    bed_length_mm: number;
    bed_width_mm: number;
    bed_depth_mm: number;
    focus_block: string;
    cavity_block: string;
    lateral_shave_block?: string;
    breast_blocks: string[];
    extra_blocks: { id: string; label: string }[];
    section_title: string;
    section_subtitle: string;
    orientation_note: string;
    ink_drawer: { title: string; meta: string; body: string; img: string };
    box_label: string;
    shaves_label: string;
    lateral_shave_label: string;
    virtual_badge_label: string;
    real_badge_label: string;
    legend_virtual_label: string;
    legend_real_label: string;
    model3d: {
      focus_pin_label: string;
      cavity_pin_label: string;
      cavity_toggle_label: string;
      cavity_legend_label: string;
      focus_preset_label: string;
      medial_axis_label: string;
    };
  };
  anatomy: {
    title: string;
    subtitle: string;
    scale_note: string;
    outer_bed: { x0_mm: number; x1_mm: number; label: string; left_tag: string; right_tag: string };
    superior_shave: { x0_mm: number; x1_mm: number; label: string };
    medial_shave: { lines: string[] };
    lateral_shave: { block_id: string; lines: string[] };
    ruler_label: string;
    left_ink_label: string;
    right_ink_label: string;
    nodes_box: {
      title: string;
      subtitle: string;
      items: { text: string; block_id?: string }[];
      footer: string;
    };
  };
  focus_explorer: {
    block_id: string;
    section_title: string;
    section_subtitle: string;
    slider_title: string;
    presets: { k: number; label: string }[];
    default_k: number;
    slider_ticks: string[];
    ref_lines: { pct: number; label: string; strong?: boolean }[];
    verdicts: { max_k: number; text: string }[];
    footnote: string;
    hotfields_drawer: {
      title: string;
      meta: string;
      body: string;
      img: string;
      rows: [string, string, string, string, string][];
    };
    serial_drawer: {
      title: string;
      meta: string;
      body: string;
      tabs: { key: string; label: string; img: string }[];
    };
    recount_drawer: {
      title: string;
      meta: string;
      body: string;
      img: string;
    };
  };
  blocks_section: {
    title: string;
    subtitle: string;
    pooled_label: string;
    measured_label: string;
    sensitivity_blocks: { block: string; color: string; dashed?: boolean }[];
    validation_drawer: {
      title: string;
      meta: string;
      body: string;
      img: string;
      footnote: string;
    };
    qc_drawer: {
      title: string;
      meta: string;
      body: string;
      img: string;
    };
    method_drawer: {
      title: string;
      meta: string;
      tabs: { key: string; label: string; body: string; img?: string; bullets?: string[] }[];
    };
  };
  reconcile: {
    title: string;
    subtitle: string;
    rows: {
      reported: string;
      reported_sub: string;
      describes: string;
      measured: string;
      verdict: string;
      verdict_tone?: "ok" | "blue" | "red";
    }[];
    compare_bars: { label: string; value: number; kind: "rep" | "foc" | "bed"; detail: string }[];
    compare_legend: { rep: string; foc: string; bed: string };
    compare_footnote: string;
    rcb: RcbParams & {
      default_ca: number;
      subtitle: string;
      presets: { ca: number; label: string }[];
      landmarks: { ca: number; label: string; dx: number; dy: number; anchor: "start" | "end" }[];
    };
    limits: { title: string; body: string }[];
  };
};

export type CellularityData = {
  summary: {
    rows: BlockRow[];
    pooled_breast: PooledStats & { measured_only: PooledStats };
  };
  slices: SliceMeta[];
  non_bed_notes: Record<string, string>;
  grids: Record<string, BlockGrid>;
  meshes_3d: Meshes3D;
  b6_cum: B6Cumulative;
  f33: F33Steps;
  validation: ValidationData;
  rcb_points: Record<string, number>;
  report: ReportContent;
};

/** A 1 mm field hovered in either the 2D inspector or the 3D model (linked brushing). */
export type FieldRef = { block: string; col: number; row: number };
