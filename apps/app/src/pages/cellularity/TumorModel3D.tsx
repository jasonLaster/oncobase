import { useEffect, useMemo, useRef, useState } from "react";
import { usePublishViewState } from "./view-state";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  explodeOffset,
  FACES,
  faceFacing,
  fitOrthoZoom,
  type LabelRequest,
  nearestInkedEdge,
  niceScaleBar,
  placeLabels,
  sceneExtentMm,
  type Slab,
  slabsFromSlices,
  stepScanned,
  TRAY_CELL,
  trayLayout,
  type Vec3,
  VIEW_PRESETS,
  type ViewId,
  type ViewPreset,
} from "./tumorModelGeometry";
import type { BlockGrid, CellularityData, PackedMesh } from "./types";
import { heatColor } from "./utils";

type Props = {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
};

type Layers = ViewPreset["layers"];

type SceneState = {
  view: ViewId;
  selected: string;
  hovered: string | null;
  layers: Layers;
  explode: number;
  deal: number;
  cut: boolean;
  isolate: boolean;
};

type SceneApi = {
  sync: (s: SceneState) => void;
  flyTo: (p: ViewPreset, selected: string) => void;
  lookFrom: (dir: Vec3) => void;
};

const VIEW_HALF_H = 26;
const NEUTRAL_HULL = new THREE.Color("#e9e3d6");
const SELECT_INK = "#161614";
const VIRTUAL_INK = "#2563eb";
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function buildGeometry(packed: PackedMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(packed.v, 3));
  geo.setIndex(packed.f);
  geo.computeVertexNormals();
  return geo;
}

/** Paint one slice face (superior left, anterior up) into a 2D context. */
function paintSlice(ctx: CanvasRenderingContext2D, g: BlockGrid, cw: number, ch: number, tissue = "rgba(214, 206, 188, 0.6)") {
  ctx.clearRect(0, 0, cw, ch);
  const dx = cw / g.sil_w;
  const dy = ch / g.sil_h;
  ctx.fillStyle = tissue;
  for (let r = 0; r < g.sil_h; r++) {
    const rowStr = g.sil_rows[r];
    for (let col = 0; col < g.sil_w; col++) {
      if (rowStr?.[col] === "1") ctx.fillRect(col * dx, r * dy, dx + 0.5, dy + 0.5);
    }
  }
  const fx = cw / g.cols;
  const fy = ch / g.rows;
  for (const [col, row, ca] of g.fields) {
    if (ca < 0.25) continue;
    ctx.fillStyle = heatColor(ca);
    ctx.globalAlpha = Math.min(1, 0.55 + Math.sqrt(ca / 33) * 0.45);
    ctx.fillRect(col * fx, row * fy, fx + 0.5, fy + 0.5);
  }
  ctx.globalAlpha = 1;
}

function makeSliceTexture(g: BlockGrid): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = g.cols * 12;
  c.height = g.rows * 12;
  const ctx = c.getContext("2d");
  if (ctx) paintSlice(ctx, g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Per-vertex hull colors: neutral tissue, or the six margin inks blended by surface normal. */
function hullColors(geo: THREE.BufferGeometry, inks: boolean): Float32Array {
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  const out = new Float32Array(n.count * 3);
  const inkCols = FACES.map((f) => new THREE.Color(f.ink).lerp(new THREE.Color("#ffffff"), 0.06));
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    if (!inks) {
      c.copy(NEUTRAL_HULL);
    } else {
      const nx = n.getX(i);
      const ny = n.getY(i);
      const nz = n.getZ(i);
      c.setRGB(0, 0, 0);
      let sum = 0;
      FACES.forEach((f, k) => {
        // Sharp weighting so each face reads as one ink, like a real inked specimen.
        const w = Math.max(0, f.normal[0] * nx + f.normal[1] * ny + f.normal[2] * nz) ** 10;
        sum += w;
        c.r += inkCols[k].r * w;
        c.g += inkCols[k].g * w;
        c.b += inkCols[k].b * w;
      });
      if (sum > 0) c.multiplyScalar(1 / sum);
      else c.copy(NEUTRAL_HULL);
    }
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

function SliceThumb({ g, active }: { g: BlockGrid; active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(g.cols * 3 * dpr);
    c.height = Math.round(g.rows * 3 * dpr);
    const ctx = c.getContext("2d");
    if (ctx) paintSlice(ctx, g, c.width, c.height, active ? "rgba(205, 196, 176, 0.9)" : "rgba(214, 206, 188, 0.75)");
  }, [g, active]);
  return <canvas ref={ref} style={{ width: g.cols * 3, height: g.rows * 3 }} aria-hidden="true" />;
}

export function TumorModel3D({ data, selectedBlock, onSelectBlock }: Props) {
  const spec = data.report.specimen;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelectBlock);
  const hoverRef = useRef<(id: string | null) => void>(() => {});
  const sceneApiRef = useRef<SceneApi | null>(null);

  const initial = VIEW_PRESETS[0];
  const [view, setView] = useState<ViewId>(initial.id);
  const [layers, setLayers] = useState<Layers>(initial.layers);
  const [explode, setExplode] = useState(initial.explode);
  const [deal, setDeal] = useState(initial.deal);
  const [cut, setCut] = useState(initial.cut);
  const [isolate, setIsolate] = useState(initial.isolate);
  const [hovered, setHovered] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const activePreset = VIEW_PRESETS.find((p) => p.id === view) ?? VIEW_PRESETS[0];
  usePublishViewState("model", {
    view: activePreset.label,
    question: activePreset.question,
    hidden: [
      !layers.shells && "interpolated core",
      !layers.halo && "interpolated scatter",
      !layers.cavity && "biopsy cavity",
      !layers.inks && "margin inks",
      !layers.shaves && "extra margin shaves",
      !layers.ruler && "focus-to-edge ruler",
    ].filter((x): x is string => Boolean(x)),
    laidOut: deal > 0.5,
    cut,
    separated: explode,
  });

  useEffect(() => {
    onSelectRef.current = onSelectBlock;
    hoverRef.current = setHovered;
  }, [onSelectBlock]);

  const slabs = useMemo(() => slabsFromSlices(data.slices, spec.bed_length_mm), [data.slices, spec.bed_length_mm]);
  const focusEdge = useMemo(() => {
    const g = data.grids[spec.focus_block];
    return g ? nearestInkedEdge(g, 5) : null;
  }, [data.grids, spec.focus_block]);

  // ------------------------------------------------------------------ scene
  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelsRef.current;
    const svg = svgRef.current;
    const scaleEl = scaleRef.current;
    if (!container || !labelLayer || !svg || !scaleEl) return;
    const specimen = data.report.specimen;
    const M = data.meshes_3d;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      let active = true;
      queueMicrotask(() => {
        if (active) setWebglError("WebGL is unavailable in this browser. Switch to the Breadloaf Slices or 2D Top-Down tab.");
      });
      return () => {
        active = false;
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.autoClear = false;
    const W0 = container.clientWidth || 720;
    const H0 = container.clientHeight || 465;
    renderer.setSize(W0, H0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.insertBefore(renderer.domElement, container.firstChild);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-VIEW_HALF_H * (W0 / H0), VIEW_HALF_H * (W0 / H0), VIEW_HALF_H, -VIEW_HALF_H, 0.1, 1000);
    camera.position.set(-60, 60, 90);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minZoom = 0.3;
    controls.maxZoom = 8;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d0c2, 1.05));
    const key = new THREE.DirectionalLight(0xfffaf2, 1.0);
    key.position.set(-20, 50, 40);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xdbe6ff, 0.45);
    rim.position.set(30, -20, -40);
    scene.add(rim);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(d: T): T => {
      disposables.push(d);
      return d;
    };

    const hullGeo = track(buildGeometry(M.specimen_hull));
    hullGeo.computeBoundingBox();
    const bb = hullGeo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-20, -8, -12), new THREE.Vector3(20, 8, 12));
    const neutralCols = hullColors(hullGeo, false);
    const inkCols = hullColors(hullGeo, true);
    const colorAttr = new THREE.BufferAttribute(neutralCols.slice(), 3);
    hullGeo.setAttribute("color", colorAttr);
    let inksOn = false;

    const core12Geo = track(buildGeometry(M.dense_core_12));
    const core5Geo = track(buildGeometry(M.dense_core_5));
    const haloGeo = track(buildGeometry(M.sparse_halo));
    const cavGeo = track(buildGeometry(M.biopsy_cavity));

    // ---------------------------------------------------------------- slabs
    type SlabObj = {
      slab: Slab;
      group: THREE.Group;
      /** Clip planes in the slab's rest frame, and their world copies (updated every frame). */
      localPlanes: [THREE.Plane, THREE.Plane];
      planes: [THREE.Plane, THREE.Plane];
      hullMat: THREE.MeshPhongMaterial;
      shells: THREE.Mesh[];
      halo: THREE.Mesh;
      cav: THREE.Mesh;
      slicePlane: THREE.Mesh | null;
      sliceMat: THREE.MeshBasicMaterial | null;
      contour: THREE.LineLoop | null;
      contourMat: THREE.LineBasicMaterial | null;
      tag: HTMLButtonElement;
      /** Rest-frame extents of the slice face, for anchoring labels. */
      face: { yMin: number; yMax: number; zMin: number; zMax: number };
    };
    const slabObjs: SlabObj[] = [];
    const clickables: THREE.Object3D[] = [];
    labelLayer.innerHTML = "";

    type Lbl = {
      id: string;
      el: HTMLElement;
      anchor: () => THREE.Vector3;
      priority: number;
      movable: boolean | "y";
      /** Offset (px) from the anchor, for labels pulled out on a leader line. */
      offset?: [number, number] | ((l: { w: number; h: number }) => [number, number]);
      leader?: string;
      show: () => boolean;
      w: number;
      h: number;
    };
    const labels: Lbl[] = [];
    const addLabel = (l: Omit<Lbl, "w" | "h">) => {
      labelLayer.appendChild(l.el);
      labels.push({ ...l, w: 0, h: 0 });
    };
    /** Measure visible labels; hidden ones keep their last size (offsetWidth would read 0). */
    const measureLabels = () => {
      labels.forEach((l) => {
        if (l.el.style.display === "none") return;
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      });
    };

    let state: SceneState = {
      view: VIEW_PRESETS[0].id,
      selected: "",
      hovered: null,
      layers: VIEW_PRESETS[0].layers,
      explode: 0,
      deal: 0,
      cut: false,
      isolate: false,
    };
    let explodeCur = 0;
    let dealCur = 0;
    const aspect = () => (container.clientWidth || 1) / (container.clientHeight || 1);
    let tray = trayLayout(slabs.length, aspect());

    slabs.forEach((slab) => {
      const group = new THREE.Group();
      const localPlanes: [THREE.Plane, THREE.Plane] = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -slab.x0),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), slab.x1),
      ];
      const planes: [THREE.Plane, THREE.Plane] = [localPlanes[0].clone(), localPlanes[1].clone()];
      const hullMat = track(
        new THREE.MeshPhongMaterial({
          vertexColors: true,
          specular: 0xffffff,
          shininess: 30,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          // Front faces only where a slide face sits inside (the back wall doubled the haze);
          // unscanned end slabs have no slide, and their open cut face needs the inside drawn.
          side: slab.scanned ? THREE.FrontSide : THREE.DoubleSide,
          clippingPlanes: planes,
        }),
      );
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.renderOrder = 6;
      hull.userData.blockId = slab.id;
      group.add(hull);
      clickables.push(hull);

      const c12 = new THREE.Mesh(core12Geo, track(new THREE.MeshPhongMaterial({ color: 0x7f0d12, emissive: 0x3a0507, shininess: 60, clippingPlanes: planes })));
      c12.renderOrder = 1;
      const c5 = new THREE.Mesh(
        core5Geo,
        track(new THREE.MeshPhongMaterial({ color: 0xd8341f, emissive: 0x3a0a04, shininess: 50, transparent: true, opacity: 0.62, depthWrite: false, clippingPlanes: planes })),
      );
      c5.renderOrder = 2;
      const halo = new THREE.Mesh(
        haloGeo,
        track(new THREE.MeshPhongMaterial({ color: 0xf08a5d, emissive: 0x200a02, shininess: 10, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: planes })),
      );
      halo.renderOrder = 3;
      const cav = new THREE.Mesh(
        cavGeo,
        track(new THREE.MeshPhongMaterial({ color: 0x64748b, emissive: 0x111827, shininess: 40, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: planes })),
      );
      cav.renderOrder = 3;
      group.add(c12, c5, halo, cav);

      let slicePlane: THREE.Mesh | null = null;
      let sliceMat: THREE.MeshBasicMaterial | null = null;
      let contour: THREE.LineLoop | null = null;
      let contourMat: THREE.LineBasicMaterial | null = null;
      const face = { yMin: bb.min.y, yMax: bb.max.y, zMin: bb.min.z, zMax: bb.max.z };
      const g = data.grids[slab.id];
      if (slab.scanned && g) {
        const tex = track(makeSliceTexture(g));
        const pg = track(new THREE.PlaneGeometry(g.plane_w_mm, g.plane_h_mm));
        pg.rotateY(-Math.PI / 2);
        sliceMat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
        slicePlane = new THREE.Mesh(pg, sliceMat);
        slicePlane.position.set(slab.xc, g.plane_off_y, g.plane_off_z);
        slicePlane.renderOrder = 5;
        slicePlane.userData.blockId = slab.id;
        group.add(slicePlane);
        clickables.push(slicePlane);
        const ctr = M.slice_contours[slab.id];
        if (ctr && ctr.pts.length > 2) {
          const cg = track(new THREE.BufferGeometry().setFromPoints(ctr.pts.map(([y, z]) => new THREE.Vector3(slab.xc, y, z))));
          contourMat = track(new THREE.LineBasicMaterial({ color: slab.kind === "virtual" ? VIRTUAL_INK : SELECT_INK, transparent: true, opacity: 0.5 }));
          contour = new THREE.LineLoop(cg, contourMat);
          contour.renderOrder = 7;
          group.add(contour);
          face.yMin = Math.min(...ctr.pts.map((p) => p[0]));
          face.yMax = Math.max(...ctr.pts.map((p) => p[0]));
          face.zMin = Math.min(...ctr.pts.map((p) => p[1]));
          face.zMax = Math.max(...ctr.pts.map((p) => p[1]));
        }
      }

      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = `cel-m3d-tag${slab.kind === "virtual" ? " virtual" : ""}${slab.scanned ? "" : " unscanned"}`;
      tag.textContent = slab.label;
      tag.title = slab.scanned ? `Select ${slab.label}` : `${slab.label} (end slab, not scanned)`;
      tag.dataset.block = slab.id;
      tag.onclick = (e) => {
        e.stopPropagation();
        onSelectRef.current(slab.id);
      };
      tag.onpointerenter = () => hoverRef.current(slab.id);
      tag.onpointerleave = () => hoverRef.current(null);
      const idx = slab.index;
      addLabel({
        id: `tag-${slab.id}`,
        el: tag,
        // Loaf: under its front-bottom edge, clear of the callouts above. Tray: under the face.
        anchor: () =>
          dealCur > 0.5
            ? toWorld(idx, slab.xc, face.yMin - 2, (face.zMin + face.zMax) / 2)
            : toWorld(idx, slab.xc, bb.min.y - 1, bb.max.z + 1),
        // Above the callouts: tags barely move, so callouts route around them.
        priority: slab.scanned ? 110 : 105,
        movable: "y",
        show: () => !(state.isolate && dealCur > 0.5) || slab.id === state.selected,
      });

      scene.add(group);
      slabObjs.push({ slab, group, localPlanes, planes, hullMat, shells: [c12, c5], halo, cav, slicePlane, sliceMat, contour, contourMat, tag, face });
    });

    /** Rest-frame point (as built, before explode/deal) → current world position via the slab's transform. */
    function toWorld(idx: number, x: number, y: number, z: number): THREE.Vector3 {
      const o = slabObjs[idx];
      const v = new THREE.Vector3(x, y, z);
      return o ? v.applyMatrix4(o.group.matrix) : v;
    }

    const slabIdx = (id: string) => slabs.findIndex((s) => s.id === id);
    const focusIdx = slabIdx(specimen.focus_block);
    const cavIdx = slabIdx(specimen.cavity_block);
    const focusPos = new THREE.Vector3(...M.stats.b6_focus_pos);
    const cavPos = new THREE.Vector3(...M.stats.b3_cav_pos);

    /** Slab pose for given explode/deal values: position + rotation about the slab's own center. */
    const slabQuat = new THREE.Quaternion();
    const poseSlab = (o: SlabObj, ex: number, dl: number, target: THREE.Matrix4) => {
      const i = o.slab.index;
      const loafCenter = new THREE.Vector3(o.slab.xc + explodeOffset(i, slabs.length, ex), 0, 0);
      const [tx, ty] = tray.pos[i] ?? [0, 0];
      const trayCenter = new THREE.Vector3(tx, ty, 0);
      // Ease the path so slabs lift out of the loaf before turning.
      const e = dl * dl * (3 - 2 * dl);
      const center = loafCenter.lerp(trayCenter, e);
      center.z += Math.sin(Math.PI * e) * 10;
      slabQuat.setFromAxisAngle(Y_AXIS, (Math.PI / 2) * e);
      const restCenter = new THREE.Vector3(o.slab.xc, 0, 0).applyQuaternion(slabQuat);
      target.compose(new THREE.Vector3().subVectors(center, restCenter), slabQuat, new THREE.Vector3(1, 1, 1));
    };
    const applyPoses = () => {
      const m = new THREE.Matrix4();
      slabObjs.forEach((o) => {
        poseSlab(o, explodeCur, dealCur, m);
        o.group.matrix.copy(m);
        o.group.matrix.decompose(o.group.position, o.group.quaternion, o.group.scale);
        o.group.updateMatrixWorld(true);
        o.planes[0].copy(o.localPlanes[0]).applyMatrix4(o.group.matrixWorld);
        o.planes[1].copy(o.localPlanes[1]).applyMatrix4(o.group.matrixWorld);
      });
    };
    /** World position of a rest-frame point of slab idx at the given (target) explode/deal. */
    const restToPose = (idx: number, p: THREE.Vector3, ex: number, dl: number) => {
      const o = slabObjs[idx];
      if (!o) return p.clone();
      const m = new THREE.Matrix4();
      poseSlab(o, ex, dl, m);
      return p.clone().applyMatrix4(m);
    };

    // ---------------------------------------------------------------- annotations
    const mk = (cls: string, html: string) => {
      const el = document.createElement("div");
      el.className = cls;
      el.innerHTML = html;
      return el;
    };
    const fmt = (v: number, d = 1) => v.toFixed(d);
    const focusRow = data.summary.rows.find((r) => r.block === specimen.focus_block);
    const inTray = () => dealCur > 0.5;

    addLabel({
      id: "focus",
      el: mk(
        "cel-m3d-callout focus",
        `<strong>${specimen.focus_block} dense focus</strong><span>up to ${fmt(focusRow?.max1 ?? 0, 0)}% per 1 mm field</span><span class="interp">3D shape interpolated between slides</span>`,
      ),
      anchor: () => (inTray() ? toWorld(focusIdx, slabs[focusIdx]?.xc ?? 0, focusPos.y, focusPos.z) : toWorld(focusIdx, focusPos.x, focusPos.y, focusPos.z)),
      // Single-slab view: beside the focus, so the ruler and the hot fields stay clear.
      offset: (l) => (inTray() && state.isolate ? [l.w / 2 + 36, l.h + 24] : [70, -64]),
      leader: "#7f0d12",
      priority: 100,
      movable: true,
      show: () => (state.layers.shells || inTray()) && (!state.isolate || state.selected === specimen.focus_block || !inTray()),
    });
    addLabel({
      id: "cavity",
      el: mk("cel-m3d-callout cav", `<strong>${specimen.cavity_block} biopsy cavity</strong><span>clip site, 12 × 8 × 3 mm</span>`),
      anchor: () => toWorld(cavIdx, cavPos.x, cavPos.y, cavPos.z),
      offset: [-40, 70],
      leader: "#475569",
      priority: 70,
      movable: true,
      show: () => state.layers.cavity && !inTray(),
    });

    // Ruler: dense-focus fields → nearest inked edge, measured on the focus slide (rest frame, slide plane).
    const edge = data.grids[specimen.focus_block] ? nearestInkedEdge(data.grids[specimen.focus_block], 5) : null;
    const focusSlab = slabs[focusIdx];
    // In the tray the slab is turned face-on; nudge the ruler just in front of the slide face.
    const rulerX = () => (focusSlab ? focusSlab.xc - 0.3 : 0);
    const rulerFrom = () => (edge ? toWorld(focusIdx, rulerX(), edge.from[0], edge.from[1]) : new THREE.Vector3());
    const rulerTo = () => (edge ? toWorld(focusIdx, rulerX(), edge.to[0], edge.to[1]) : new THREE.Vector3());
    const rulerOn = () => !!edge && state.layers.ruler && (!state.isolate || state.selected === specimen.focus_block);
    if (edge) {
      const face = FACES.find((f) => f.key === edge.direction);
      addLabel({
        id: "ruler",
        el: mk("cel-m3d-callout ruler", `<strong>≈${fmt(edge.mm)} mm</strong><span>to ${edge.direction} (${face?.inkName ?? ""}) ink</span>`),
        anchor: () => rulerTo(),
        // Continue outward past the inked edge, along the ruler, so the label never covers the tissue it measures.
        offset: (l) => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const [x1, y1] = project(rulerFrom(), w, h);
          const [x2, y2] = project(rulerTo(), w, h);
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const ux = (x2 - x1) / len;
          const uy = (y2 - y1) / len;
          return [ux * (l.w / 2 + 22), uy * (l.h / 2 + 22)];
        },
        leader: "#161614",
        priority: 98,
        movable: true,
        show: rulerOn,
      });
    }

    // Face labels: anatomical name + ink swatch. Loaf: just outside each face of the specimen.
    // Tray: around the selected slab's slice face (lateral/medial then point at/away from the viewer).
    const camDir = new THREE.Vector3();
    const faceAnchor = (key: string): THREE.Vector3 => {
      if (inTray()) {
        const i = Math.max(0, slabIdx(state.selected));
        const o = slabObjs[i];
        const f = o?.face ?? { yMin: bb.min.y, yMax: bb.max.y, zMin: bb.min.z, zMax: bb.max.z };
        const xc = o?.slab.xc ?? 0;
        const ym = (f.yMin + f.yMax) / 2;
        const zm = (f.zMin + f.zMax) / 2;
        if (key === "anterior") return toWorld(i, xc, f.yMax + 2.4, zm);
        if (key === "posterior") return toWorld(i, xc, f.yMin - 4.5, zm);
        if (key === "superior") return toWorld(i, xc, ym, f.zMin - 2.5);
        if (key === "inferior") return toWorld(i, xc, ym, f.zMax + 2.5);
        return toWorld(i, xc, ym, zm);
      }
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      const first = explodeOffset(0, slabs.length, explodeCur);
      const last = explodeOffset(slabs.length - 1, slabs.length, explodeCur);
      switch (key) {
        case "anterior":
          return new THREE.Vector3(cx - 8, bb.max.y + 0.5, cz + 4);
        case "posterior":
          return new THREE.Vector3(cx + 8, bb.min.y - 0.5, cz);
        case "superior":
          return new THREE.Vector3(cx + 6, cy, bb.min.z - 1);
        case "inferior":
          return new THREE.Vector3(cx + 4, cy - 3, bb.max.z + 1);
        case "lateral":
          return new THREE.Vector3(bb.min.x + first - 1.5, cy - 2, cz + 4);
        default:
          return new THREE.Vector3(bb.max.x + last + 1.5, cy - 2, cz + 4);
      }
    };
    const worldNormal = new THREE.Vector3();
    FACES.forEach((f) => {
      const el = mk(`cel-m3d-face face-${f.key}`, `<i style="background:${f.ink}"></i>${f.key[0].toUpperCase()}${f.key.slice(1)}`);
      addLabel({
        id: `face-${f.key}`,
        el,
        anchor: () => faceAnchor(f.key),
        priority: 40,
        movable: true,
        show: () => {
          if (inTray()) {
            // Only the four rim faces are meaningful on a face-on slab, and only for one slab at a time.
            return state.isolate && (f.key === "anterior" || f.key === "posterior" || f.key === "superior" || f.key === "inferior");
          }
          worldNormal.set(...f.normal);
          return faceFacing([worldNormal.x, worldNormal.y, worldNormal.z], [camDir.x, camDir.y, camDir.z]) > 0.18;
        },
      });
    });

    // ---------------------------------------------------------------- shaves (separate margin specimens)
    const shaveGroup = new THREE.Group();
    const shaveMat = track(new THREE.MeshPhongMaterial({ color: 0x86efac, transparent: true, opacity: 0.35, depthWrite: false }));
    const shaveEdge = track(new THREE.LineBasicMaterial({ color: 0x15803d, transparent: true, opacity: 0.8 }));
    const addShaveBox = (size: Vec3, pos: () => THREE.Vector3) => {
      const geo = track(new THREE.BoxGeometry(...size));
      const m = new THREE.Mesh(geo, shaveMat);
      const e = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), shaveEdge);
      m.add(e);
      shaveGroup.add(m);
      return { m, pos };
    };
    const supShave = addShaveBox([18, 9, 2], () => new THREE.Vector3(0, 0, bb.min.z - 5));
    const medShave = addShaveBox([2, 11, 14], () => new THREE.Vector3(bb.max.x + explodeOffset(slabs.length - 1, slabs.length, explodeCur) + 6, 0, 0));
    const shaves = [supShave, medShave];
    const anat = data.report.anatomy;
    const showShaves = () => state.layers.shaves && !inTray();
    addLabel({
      id: "shave-sup",
      el: mk("cel-m3d-callout shave", `<strong>${anat.superior_shave.label.split(":")[0]}</strong><span>${anat.superior_shave.label.split(":")[1]?.trim() ?? ""}</span>`),
      anchor: () => supShave.pos(),
      offset: [40, -40],
      leader: "#15803d",
      priority: 65,
      movable: true,
      show: showShaves,
    });
    addLabel({
      id: "shave-med",
      el: mk("cel-m3d-callout shave", `<strong>${anat.medial_shave.lines.slice(0, 2).join(" · ")}</strong><span>${anat.medial_shave.lines.slice(2).join(" ")}</span>`),
      anchor: () => medShave.pos(),
      offset: [10, 56],
      leader: "#15803d",
      priority: 64,
      movable: true,
      show: showShaves,
    });
    const latId = specimen.lateral_shave_block;
    let latPlane: THREE.Mesh | null = null;
    if (latId && data.grids[latId]) {
      const g = data.grids[latId];
      const pg = track(new THREE.PlaneGeometry(g.plane_w_mm, g.plane_h_mm));
      pg.rotateY(-Math.PI / 2);
      latPlane = new THREE.Mesh(pg, track(new THREE.MeshBasicMaterial({ map: track(makeSliceTexture(g)), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })));
      latPlane.userData.blockId = latId;
      const frame = new THREE.LineSegments(track(new THREE.EdgesGeometry(pg)), track(new THREE.LineBasicMaterial({ color: 0xd9481f })));
      latPlane.add(frame);
      shaveGroup.add(latPlane);
      clickables.push(latPlane);
      addLabel({
        id: "shave-lat",
        el: mk("cel-m3d-callout shave pos", `<strong>${anat.lateral_shave.lines.slice(0, 2).join(" · ")}</strong><span>${anat.lateral_shave.lines.slice(2).join(" ")}</span>`),
        anchor: () => latPlane?.position.clone() ?? new THREE.Vector3(),
        offset: [-20, -70],
        leader: "#d9481f",
        priority: 66,
        movable: true,
        show: showShaves,
      });
    }
    scene.add(shaveGroup);

    // ---------------------------------------------------------------- orientation gizmo
    // Shows the anatomical frame of the tissue: it turns with the slabs when they are dealt out.
    const gScene = new THREE.Scene();
    const gCam = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10);
    const gizmoRoot = new THREE.Group();
    gScene.add(gizmoRoot);
    const gizmoSizeFor = (w: number) => (w < 480 ? 66 : 92);
    let gizmoSize = gizmoSizeFor(W0);
    const gizmoEls: Array<{ el: HTMLButtonElement; n: THREE.Vector3 }> = [];
    FACES.forEach((f) => {
      const n = new THREE.Vector3(...f.normal);
      const lg = track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), n.clone().multiplyScalar(0.95)]));
      gizmoRoot.add(new THREE.Line(lg, track(new THREE.LineBasicMaterial({ color: f.ink }))));
      const sg = track(new THREE.SphereGeometry(0.2, 16, 12));
      const s = new THREE.Mesh(sg, track(new THREE.MeshBasicMaterial({ color: f.ink })));
      s.position.copy(n);
      gizmoRoot.add(s);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cel-m3d-gizmo-lbl";
      el.textContent = f.short;
      el.title = `View from ${f.key}`;
      el.setAttribute("aria-label", `View from ${f.key}`);
      el.style.color = f.ink;
      el.onclick = () => api.lookFrom(f.normal);
      labelLayer.appendChild(el);
      gizmoEls.push({ el, n });
    });
    const gizmoBox = mk("cel-m3d-gizmo-box", "");
    labelLayer.appendChild(gizmoBox);

    measureLabels();

    // ---------------------------------------------------------------- interaction
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos: [number, number] | null = null;
    const pick = (e: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(
        clickables.filter((o) => o.visible && o.parent?.visible !== false),
        false,
      );
      // Prefer slide planes over hull shells: the planes are the measured data.
      const plane = hits.find((h) => h.object instanceof THREE.Mesh && h.object.geometry.type === "PlaneGeometry");
      const id = (plane ?? hits[0])?.object?.userData?.blockId;
      return typeof id === "string" ? id : null;
    };
    const onPointerDown = (e: PointerEvent) => {
      downPos = [e.clientX, e.clientY];
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
      const id = pick(e);
      if (id && (data.grids[id] || slabs.some((s) => s.id === id))) onSelectRef.current(id);
    };
    let lastHover: string | null = null;
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const id = pick(e);
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      if (id !== lastHover) {
        lastHover = id;
        hoverRef.current(id);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // ---------------------------------------------------------------- camera moves
    let tween: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; z0: number; z1: number; k: number } | null = null;
    const startTween = (target: THREE.Vector3, dir: THREE.Vector3, zoom: number) => {
      tween = {
        p0: camera.position.clone(),
        p1: target.clone().add(dir.clone().normalize().multiplyScalar(160)),
        t0: controls.target.clone(),
        t1: target.clone(),
        z0: camera.zoom,
        z1: zoom,
        k: 0,
      };
    };
    let lastPreset: ViewPreset = VIEW_PRESETS[0];
    const frame = (p: ViewPreset, selected: string) => {
      const d = new THREE.Vector3(...p.dir).normalize();
      const a = aspect();
      if (p.deal > 0.5) {
        tray = trayLayout(slabs.length, a);
        if (p.isolate) {
          const i = Math.max(0, slabIdx(selected));
          const o = slabObjs[i];
          const target = o ? restToPose(i, new THREE.Vector3(o.slab.xc, (o.face.yMin + o.face.yMax) / 2, (o.face.zMin + o.face.zMax) / 2), p.explode, 1) : new THREE.Vector3();
          // One slab, filling the view; rim labels and callouts may overlap the ghosted neighbours.
          return { target, d, zoom: fitOrthoZoom(a, VIEW_HALF_H, TRAY_CELL.w + (a < 1 ? 2 : 14), TRAY_CELL.h + 2) * p.zoom };
        }
        return { target: new THREE.Vector3(0, -1, 0), d, zoom: fitOrthoZoom(a, VIEW_HALF_H, tray.cols * TRAY_CELL.w, tray.rows * TRAY_CELL.h + 6) * p.zoom };
      }
      const ext = sceneExtentMm(specimen.bed_length_mm, slabs.length, p.explode, p.layers.shaves);
      // The camera is oblique, so the loaf's projected length is shorter than its true length.
      const projW = ext.w * Math.sqrt(1 - d.x * d.x) + Math.abs(d.x) * 24;
      let target = new THREE.Vector3(0, -1, 0);
      if (p.aimAtFocus && focusIdx >= 0) target = restToPose(focusIdx, focusPos, p.explode, 0);
      return { target, d, zoom: fitOrthoZoom(a, VIEW_HALF_H, projW, ext.h) * p.zoom };
    };
    const api: SceneApi = {
      sync: (s) => {
        const prev = state;
        state = s;
        if (s.layers.inks !== inksOn) {
          inksOn = s.layers.inks;
          colorAttr.copyArray(inksOn ? inkCols : neutralCols);
          colorAttr.needsUpdate = true;
        }
        const selIdx = slabIdx(s.selected);
        slabObjs.forEach((o) => {
          const isSel = o.slab.id === s.selected;
          const isHover = o.slab.id === s.hovered;
          const ghost = (s.cut && s.deal < 0.5 && selIdx >= 0 && o.slab.index < selIdx) || (s.isolate && s.deal > 0.5 && !isSel);
          o.hullMat.opacity = ghost ? 0.035 : s.layers.inks ? (s.deal > 0.5 ? 0.6 : 0.5) : s.deal > 0.5 ? 0.3 : 0.17;
          // Fully hide neighbours in the single-slab view; keep a faint ghost when cutting the loaf.
          o.group.visible = !(ghost && s.isolate);
          o.shells.forEach((m) => (m.visible = s.layers.shells && !ghost));
          o.halo.visible = s.layers.halo && !ghost;
          o.cav.visible = s.layers.cavity && !ghost;
          if (o.sliceMat && o.slicePlane) {
            o.slicePlane.visible = !ghost;
            o.sliceMat.opacity = isSel ? 0.97 : isHover ? 0.92 : s.deal > 0.5 ? 0.9 : s.layers.shells ? 0.72 : 0.85;
          }
          if (o.contour && o.contourMat) {
            o.contour.visible = !ghost || isSel;
            o.contourMat.opacity = isSel ? 1 : isHover ? 0.85 : s.deal > 0.5 ? 0.45 : 0.22;
            o.contourMat.color.set(isSel ? SELECT_INK : o.slab.kind === "virtual" ? VIRTUAL_INK : "#57534e");
          }
          o.tag.classList.toggle("active", isSel);
          o.tag.classList.toggle("hover", isHover && !isSel);
          o.tag.setAttribute("aria-pressed", String(isSel));
        });
        shaveGroup.visible = s.layers.shaves && s.deal < 0.5;
        if (prev.deal !== s.deal) measureLabels();
        if (prev.selected !== s.selected) {
          measureLabels();
          // In the single-slab view the camera follows the selection.
          if (s.isolate && s.deal > 0.5 && prev.selected) {
            const f = frame(lastPreset, s.selected);
            startTween(f.target, f.d, camera.zoom);
          }
        }
      },
      flyTo: (p, selected) => {
        lastPreset = p;
        const f = frame(p, selected);
        startTween(f.target, f.d, f.zoom);
      },
      lookFrom: (dir) => {
        // Gizmo axes are in the tissue frame; turn them into world directions first.
        const d = new THREE.Vector3(...dir).applyQuaternion(slabObjs[0]?.group.quaternion ?? new THREE.Quaternion());
        // Avoid a degenerate up-vector when looking straight along ±Y.
        if (Math.abs(d.y) > 0.99) d.z += 0.02;
        startTween(controls.target.clone(), d, camera.zoom);
      },
    };
    sceneApiRef.current = api;

    // ---------------------------------------------------------------- per-frame layout
    const tmp = new THREE.Vector3();
    const project = (p: THREE.Vector3, w: number, h: number): [number, number, boolean] => {
      tmp.copy(p).project(camera);
      return [(tmp.x * 0.5 + 0.5) * w, (-tmp.y * 0.5 + 0.5) * h, tmp.z < 1];
    };
    const leaderEls = new Map<string, SVGLineElement>();
    const rulerLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    rulerLine.setAttribute("class", "cel-m3d-ruler");
    svg.appendChild(rulerLine);
    const rulerDots = [0, 1].map(() => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", "3");
      c.setAttribute("class", "cel-m3d-ruler-dot");
      svg.appendChild(c);
      return c;
    });

    const gizmoQuat = new THREE.Quaternion();
    const layout = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camDir.subVectors(camera.position, controls.target).normalize();
      const reqs: LabelRequest[] = [
        // Reserve the gizmo and scale-bar corners.
        { id: "__gizmo", x: w - gizmoSize / 2 - 6, y: h - gizmoSize / 2 - 6, w: gizmoSize, h: gizmoSize, priority: 1000 },
        { id: "__scale", x: 70, y: h - 18, w: 130, h: 26, priority: 999 },
      ];
      const anchors = new Map<string, [number, number]>();
      labels.forEach((l) => {
        const visible = l.show();
        l.el.style.display = visible ? "" : "none";
        if (!visible) return;
        if (!l.w) {
          l.w = l.el.offsetWidth;
          l.h = l.el.offsetHeight;
        }
        const [ax, ay, front] = project(l.anchor(), w, h);
        if (!front) return;
        anchors.set(l.id, [ax, ay]);
        const [ox, oy] = typeof l.offset === "function" ? l.offset(l) : (l.offset ?? [0, 0]);
        reqs.push({ id: l.id, x: ax + ox, y: ay + oy, w: l.w, h: l.h, priority: l.priority, movable: l.movable });
      });
      const placed = new Map(placeLabels(reqs, { w, h }).map((p) => [p.id, p]));
      labels.forEach((l) => {
        const p = placed.get(l.id);
        const a = anchors.get(l.id);
        const line = leaderEls.get(l.id);
        if (!p || !p.visible || !a) {
          if (l.el.style.display !== "none") l.el.style.visibility = "hidden";
          if (line) line.style.display = "none";
          return;
        }
        l.el.style.visibility = "visible";
        l.el.style.transform = `translate(${(p.x - l.w / 2).toFixed(1)}px, ${(p.y - l.h / 2).toFixed(1)}px)`;
        if (l.leader) {
          let ln = line;
          if (!ln) {
            ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
            ln.setAttribute("class", "cel-m3d-leader");
            ln.style.stroke = l.leader;
            svg.appendChild(ln);
            leaderEls.set(l.id, ln);
          }
          // End the leader at the label's nearest edge.
          const ex = Math.min(Math.max(a[0], p.x - l.w / 2), p.x + l.w / 2);
          const ey = Math.min(Math.max(a[1], p.y - l.h / 2), p.y + l.h / 2);
          ln.style.display = "";
          ln.setAttribute("x1", a[0].toFixed(1));
          ln.setAttribute("y1", a[1].toFixed(1));
          ln.setAttribute("x2", ex.toFixed(1));
          ln.setAttribute("y2", ey.toFixed(1));
        }
      });

      // Ruler segment, drawn in screen space so it stays crisp at any zoom.
      const showRuler = rulerOn();
      [rulerLine, ...rulerDots].forEach((el) => (el.style.display = showRuler ? "" : "none"));
      if (showRuler) {
        const [x1, y1] = project(rulerFrom(), w, h);
        const [x2, y2] = project(rulerTo(), w, h);
        rulerLine.setAttribute("x1", x1.toFixed(1));
        rulerLine.setAttribute("y1", y1.toFixed(1));
        rulerLine.setAttribute("x2", x2.toFixed(1));
        rulerLine.setAttribute("y2", y2.toFixed(1));
        rulerDots[0].setAttribute("cx", x1.toFixed(1));
        rulerDots[0].setAttribute("cy", y1.toFixed(1));
        rulerDots[1].setAttribute("cx", x2.toFixed(1));
        rulerDots[1].setAttribute("cy", y2.toFixed(1));
      }

      // Scale bar (orthographic: px per mm is uniform).
      const pxPerMm = (h * camera.zoom) / (camera.top - camera.bottom);
      const sb = niceScaleBar(pxPerMm, 110);
      scaleEl.style.setProperty("--bar", `${sb.px.toFixed(1)}px`);
      scaleEl.dataset.mm = String(sb.mm);
      const txt = scaleEl.querySelector("span");
      if (txt) txt.textContent = `${sb.mm} mm`;

      // Gizmo labels, in the tissue frame.
      gizmoQuat.copy(slabObjs[0]?.group.quaternion ?? new THREE.Quaternion());
      gizmoEls.forEach(({ el, n }) => {
        tmp.copy(n).applyQuaternion(gizmoQuat).multiplyScalar(1.32).project(gCam);
        const gx = w - gizmoSize - 6 + (tmp.x * 0.5 + 0.5) * gizmoSize;
        const gy = h - gizmoSize - 6 + (-tmp.y * 0.5 + 0.5) * gizmoSize;
        el.style.transform = `translate(${(gx - 8).toFixed(1)}px, ${(gy - 8).toFixed(1)}px)`;
        const facing = n.clone().applyQuaternion(gizmoQuat).dot(camDir);
        el.style.opacity = facing < -0.3 ? "0.45" : "1";
      });
      gizmoBox.style.transform = `translate(${w - gizmoSize - 6}px, ${h - gizmoSize - 6}px)`;
    };

    // ---------------------------------------------------------------- loop
    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (tween) {
        tween.k = Math.min(1, tween.k + 0.045);
        const e = 1 - Math.pow(1 - tween.k, 3);
        camera.position.lerpVectors(tween.p0, tween.p1, e);
        controls.target.lerpVectors(tween.t0, tween.t1, e);
        camera.zoom = tween.z0 + (tween.z1 - tween.z0) * e;
        camera.updateProjectionMatrix();
        if (tween.k >= 1) tween = null;
      }
      const step = (cur: number, target: number) => {
        if (Math.abs(cur - target) < 2e-3) return target;
        return cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), 0.035);
      };
      explodeCur = step(explodeCur, state.explode);
      dealCur = step(dealCur, state.deal);
      applyPoses();
      shaves.forEach((s) => s.m.position.copy(s.pos()));
      if (latPlane) latPlane.position.set(bb.min.x + explodeOffset(0, slabs.length, explodeCur) - 7, 0, 0);
      controls.update();

      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
      // Gizmo in the bottom-right corner, following the main camera's rotation.
      gizmoRoot.quaternion.copy(slabObjs[0]?.group.quaternion ?? new THREE.Quaternion());
      gCam.position.set(0, 0, 4).applyQuaternion(camera.quaternion);
      gCam.quaternion.copy(camera.quaternion);
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(w - gizmoSize - 6, 6, gizmoSize, gizmoSize);
      renderer.setViewport(w - gizmoSize - 6, 6, gizmoSize, gizmoSize);
      renderer.render(gScene, gCam);
      renderer.setScissorTest(false);
      layout();
    };

    const resize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw <= 0 || nh <= 0) return;
      const a = nw / nh;
      camera.left = -VIEW_HALF_H * a;
      camera.right = VIEW_HALF_H * a;
      camera.top = VIEW_HALF_H;
      camera.bottom = -VIEW_HALF_H;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      svg.setAttribute("viewBox", `0 0 ${nw} ${nh}`);
      tray = trayLayout(slabs.length, a);
      gizmoSize = gizmoSizeFor(nw);
      gizmoBox.style.width = `${gizmoSize}px`;
      gizmoBox.style.height = `${gizmoSize}px`;
      measureLabels();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    applyPoses();
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
      labelLayer.innerHTML = "";
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      sceneApiRef.current = null;
    };
  }, [data, slabs]);

  // Push React state into the scene.
  useEffect(() => {
    sceneApiRef.current?.sync({ view, selected: selectedBlock, hovered, layers, explode, deal, cut, isolate });
  }, [view, selectedBlock, hovered, layers, explode, deal, cut, isolate, webglError]);

  // Initial camera.
  useEffect(() => {
    const id = requestAnimationFrame(() => sceneApiRef.current?.flyTo(VIEW_PRESETS[0], spec.focus_block));
    return () => cancelAnimationFrame(id);
  }, [data, spec.focus_block]);

  const applyView = (id: ViewId) => {
    const p = VIEW_PRESETS.find((v) => v.id === id);
    if (!p) return;
    const sel = p.id === "focus" ? spec.focus_block : selectedBlock;
    setView(id);
    setLayers(p.layers);
    setExplode(p.explode);
    setDeal(p.deal);
    setCut(p.cut);
    setIsolate(p.isolate);
    if (sel !== selectedBlock) onSelectBlock(sel);
    sceneApiRef.current?.flyTo(p, sel);
  };

  const toggleLayer = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  // ------------------------------------------------------------------ captions (all numbers from data)
  const focusRow = data.summary.rows.find((r) => r.block === spec.focus_block);
  const breastSet = new Set(spec.breast_blocks);
  const others = data.summary.rows.filter((r) => breastSet.has(r.block) && r.block !== spec.focus_block);
  const otherMax = others.reduce((m, r) => Math.max(m, r.virtual_max1 ?? r.max1), 0);
  const focusSlice = data.slices.find((s) => s.id === spec.focus_block);
  const m3stats = data.meshes_3d.stats;
  const focusInk = focusEdge ? FACES.find((f) => f.key === focusEdge.direction)?.inkName : "";
  const caption: Record<ViewId, { q: string; a: string }> = {
    overview: {
      q: VIEW_PRESETS[0].question,
      a: `One small dense focus in ${spec.focus_block} (up to ${(focusRow?.max1 ?? 0).toFixed(0)}% of a 1 mm field). Every other slide stays at or below ${otherMax.toFixed(1)}% per field: scattered single cells. The red shape is interpolated between slides (≈${m3stats.core5_mm3.toFixed(0)} mm³ at ≥5%); the flat slide faces are what was measured.`,
    },
    slices: {
      q: VIEW_PRESETS[1].question,
      a: `The ${spec.bed_length_mm} mm specimen was cut lateral → medial into slabs about 4.8 mm thick, laid out here face-up in order (superior left, anterior up). One 4 µm section of each of ${spec.breast_blocks.join(", ")} was scanned: solid outlines are real PanKeratin, dashed blue are Strand virtual PanCK from H&E. The two end slabs were cut perpendicular and not scanned.`,
    },
    focus: {
      q: VIEW_PRESETS[2].question,
      a: focusEdge
        ? `On ${spec.focus_block}, the ${focusEdge.nHot} fields at ≥5% sit about ${focusEdge.mm.toFixed(1)} mm from the ${focusEdge.direction} (${focusInk}) inked surface, measured on 1 mm fields (±0.5 mm). Pathology note for this slice: ${(focusSlice?.margins ?? []).join(" · ") || "none"}. Use ‹ › to step to the neighboring slabs.`
        : `No ≥5% fields on ${spec.focus_block}.`,
    },
    margins: {
      q: VIEW_PRESETS[3].question,
      a: `Inks: ${FACES.map((f) => `${f.key} ${f.inkName}`).join(", ")}. Green boxes are the extra shaves taken from the cavity wall; the ${data.report.anatomy.lateral_shave.block_id} lateral shave was scanned and had focal tumor.`,
    },
  };
  const ariaSummary = `3D model of the ${spec.bed_length_mm} by ${spec.bed_width_mm} by ${spec.bed_depth_mm} mm lumpectomy, lateral on the left. ${caption.overview.a}`;

  const stepSlide = (delta: number) => onSelectBlock(stepScanned(slabs, selectedBlock, delta));
  const rowsById = useMemo(() => new Map(data.summary.rows.map((r) => [r.block, r])), [data.summary.rows]);

  return (
    <div className="cel-m3d" data-tray={deal > 0.5 ? "1" : "0"}>
      <div className="cel-m3d-bar">
        <div className="cel-seg cel-m3d-views" role="group" aria-label="Guided 3D views">
          {VIEW_PRESETS.map((p) => (
            <button key={p.id} type="button" className={view === p.id ? "active" : ""} aria-pressed={view === p.id} onClick={() => applyView(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <details className="cel-m3d-layers">
          <summary>Layers</summary>
          <div className="cel-m3d-layers-pop">
            <label><input type="checkbox" checked={layers.shells} onChange={() => toggleLayer("shells")} /> Interpolated core (≥5%, ≥12%)</label>
            <label><input type="checkbox" checked={layers.halo} onChange={() => toggleLayer("halo")} /> Interpolated scatter (≥1.2%)</label>
            <label><input type="checkbox" checked={layers.cavity} onChange={() => toggleLayer("cavity")} /> {spec.model3d.cavity_toggle_label}</label>
            <label><input type="checkbox" checked={layers.inks} onChange={() => toggleLayer("inks")} /> Margin inks on surface</label>
            <label><input type="checkbox" checked={layers.shaves} onChange={() => toggleLayer("shaves")} /> Extra margin shaves</label>
            <label><input type="checkbox" checked={layers.ruler} onChange={() => toggleLayer("ruler")} /> Focus-to-edge ruler</label>
            <label><input type="checkbox" checked={deal > 0.5} onChange={() => setDeal((d) => (d > 0.5 ? 0 : 1))} /> Lay slabs out face-up</label>
            <label><input type="checkbox" checked={cut} onChange={() => setCut((c) => !c)} /> Cut away slabs lateral to the selected slide</label>
            <label className="cel-m3d-range">
              Separate slabs
              <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} aria-label="Separate slabs" />
            </label>
          </div>
        </details>
      </div>

      <div
        className="cel-webgl-wrap cel-m3d-canvas"
        ref={containerRef}
        role="img"
        aria-label={ariaSummary}
        data-view={view}
      >
        {webglError ? <div style={{ padding: 28, color: "#5b5953", fontSize: 13.5 }}>{webglError}</div> : null}
        <svg ref={svgRef} className="cel-m3d-svg" aria-hidden="true" />
        <div className="cel-m3d-labels" ref={labelsRef} />
        <div className="cel-m3d-scale" ref={scaleRef} aria-hidden="true">
          <i />
          <span />
        </div>
      </div>

      <div className="cel-m3d-caption" aria-live="polite">
        <strong>{caption[view].q}</strong> {caption[view].a}
      </div>

      <div className="cel-m3d-strip" role="group" aria-label="Slides, lateral to medial">
        <button type="button" className="cel-m3d-step" onClick={() => stepSlide(-1)} aria-label="Previous slide">‹</button>
        {slabs.map((s) => {
          const g = data.grids[s.id];
          const row = rowsById.get(s.id);
          const max = row ? (row.method.startsWith("virtual") ? row.virtual_max1 ?? row.max1 : row.max1) : null;
          return (
            <button
              key={s.id}
              type="button"
              data-block={s.id}
              className={`cel-m3d-thumb${s.id === selectedBlock ? " active" : ""}${s.id === hovered ? " hover" : ""}${s.kind === "virtual" ? " virtual" : ""}${s.scanned ? "" : " unscanned"}`}
              aria-pressed={s.id === selectedBlock}
              aria-label={`${s.label}${max != null ? `, highest 1 mm field ${max.toFixed(1)}%` : ", not scanned"}`}
              onClick={() => onSelectBlock(s.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const next = stepScanned(slabs, s.id, e.key === "ArrowRight" ? 1 : -1);
                onSelectBlock(next);
                const strip = e.currentTarget.parentElement;
                strip?.querySelector<HTMLButtonElement>(`[data-block="${next}"]`)?.focus();
              }}
              onPointerEnter={() => setHovered(s.id)}
              onPointerLeave={() => setHovered(null)}
            >
              {g && s.scanned ? <SliceThumb g={g} active={s.id === selectedBlock} /> : <span className="cel-m3d-thumb-empty">not scanned</span>}
              <span className="cel-m3d-thumb-lbl">
                <b>{s.label}</b>
                {max != null ? <em>{max.toFixed(max >= 10 ? 0 : 1)}%</em> : null}
              </span>
            </button>
          );
        })}
        <button type="button" className="cel-m3d-step" onClick={() => stepSlide(1)} aria-label="Next slide">›</button>
      </div>
      <div className="cel-m3d-legend">
        <span><i className="sw core" />Dense core ≥12% <small>(interpolated)</small></span>
        <span><i className="sw focus" />≥5% <small>(interpolated)</small></span>
        <span><i className="sw halo" />Scatter ≥1.2% <small>(interpolated)</small></span>
        <span><i className="sw slide" />Slide face: measured 1 mm fields</span>
        <span className="cel-m3d-legend-note">Thumbnails: superior left, anterior up, as seen from the lateral side · max field %</span>
      </div>
    </div>
  );
}
