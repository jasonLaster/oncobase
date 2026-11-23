import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";
import { Toolbar, ToolbarButton } from "@oncobase/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import { CelCheckbox, CelSlider } from "./controls";
import type { CellularityData, PackedMesh } from "./types";
import { heatColor } from "./utils";

type Props = {
  data: CellularityData;
  selectedBlock: string;
  onSelectBlock: (id: string) => void;
};

type CamMode = "iso" | "ant" | "sup" | "focus";

function buildGeometry(packed: PackedMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(packed.v, 3));
  geo.setIndex(packed.f);
  geo.computeVertexNormals();
  return geo;
}

function makeSliceTexture(data: CellularityData, blockId: string): THREE.CanvasTexture {
  const g = data.grids[blockId];
  const cw = 256;
  const ch = 192;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  if (ctx && g) {
    ctx.clearRect(0, 0, cw, ch);
    const dx = cw / g.sil_w;
    const dy = ch / g.sil_h;
    ctx.fillStyle = "rgba(218, 213, 200, 0.36)";
    for (let r = 0; r < g.sil_h; r++) {
      const rowStr = g.sil_rows[r];
      for (let col = 0; col < g.sil_w; col++) {
        if (rowStr?.[col] === "1") {
          ctx.fillRect(col * dx, r * dy, dx + 0.5, dy + 0.5);
        }
      }
    }
    const fx = cw / g.cols;
    const fy = ch / g.rows;
    for (const [col, row, ca] of g.fields) {
      if (ca < 0.25) continue;
      ctx.fillStyle = heatColor(ca);
      ctx.globalAlpha = Math.min(0.95, 0.45 + Math.sqrt(ca / 33) * 0.55);
      ctx.fillRect(col * fx, row * fy, fx + 0.5, fy + 0.5);
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function TumorModel3D({ data, selectedBlock, onSelectBlock }: Props) {
  const stepOrder = data.report.specimen.breast_blocks;
  const spec = data.report.specimen;
  const m3 = spec.model3d;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelectBlock);
  useEffect(() => {
    onSelectRef.current = onSelectBlock;
  }, [onSelectBlock]);

  const [showSlices, setShowSlices] = useState(true);
  const [spotlight, setSpotlight] = useState(false);
  const [showCore, setShowCore] = useState(true);
  const [showHalo, setShowHalo] = useState(true);
  const [showHull, setShowHull] = useState(true);
  const [showCav, setShowCav] = useState(true);
  const [showMargins, setShowMargins] = useState(true);
  const [hullOpacity, setHullOpacity] = useState(14);
  const [camMode, setCamMode] = useState<CamMode>("iso");
  const [spinning, setSpinning] = useState(false);
  const [slidesOnly, setSlidesOnly] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  const sceneApiRef = useRef<{
    moveCam: (pos: [number, number, number], look: [number, number, number]) => void;
    setAutoRotate: (on: boolean) => void;
    syncSelection: (id: string, spot: boolean) => void;
    syncVisibility: (v: {
      slices: boolean;
      core: boolean;
      halo: boolean;
      hull: boolean;
      cav: boolean;
      margins: boolean;
      hullOpacity: number;
    }) => void;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelsRef.current;
    if (!container || !labelLayer) return;
    // Read specimen geometry from `data` so the scene rebuilds exactly when the dataset changes.
    const spec = data.report.specimen;
    const m3 = spec.model3d;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setWebglError("WebGL is unavailable in this browser. Switch to the Breadloaf Slices or 2D Top-Down tab.");
        }
      });
      return () => {
        active = false;
      };
    }

    const W = container.clientWidth || 720;
    const H = container.clientHeight || 465;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.sortObjects = true;
    container.insertBefore(renderer.domElement, container.firstChild);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 400);
    camera.position.set(-38, 28, 58);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 14;
    controls.maxDistance = 135;
    controls.target.set(0, -0.5, 0);
    controls.autoRotateSpeed = 1.1;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d3c5, 0.96));
    const key = new THREE.DirectionalLight(0xfffaf2, 0.92);
    key.position.set(22, 40, 34);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xdbeafe, 0.52);
    rim.position.set(-32, -12, -28);
    scene.add(rim);

    const M = data.meshes_3d;
    const disposables: Array<{ dispose: () => void }> = [];

    // Specimen outer hull
    const hullGeo = buildGeometry(M.specimen_hull);
    const hullMat = new THREE.MeshPhongMaterial({
      color: 0xe6dfd1,
      specular: 0xffffff,
      shininess: 35,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hullMesh = new THREE.Mesh(hullGeo, hullMat);
    hullMesh.renderOrder = 4;
    const hullEdgeGeo = new THREE.EdgesGeometry(hullGeo, 32);
    const hullEdgeMat = new THREE.LineBasicMaterial({ color: 0xaba596, transparent: true, opacity: 0.11 });
    hullMesh.add(new THREE.LineSegments(hullEdgeGeo, hullEdgeMat));
    scene.add(hullMesh);
    disposables.push(hullGeo, hullMat, hullEdgeGeo, hullEdgeMat);

    // Dense tumor cores
    const coreGroup = new THREE.Group();
    const c12Geo = buildGeometry(M.dense_core_12);
    const c12Mat = new THREE.MeshPhongMaterial({
      color: 0x8a0c12,
      emissive: 0x450608,
      specular: 0xffd1c9,
      shininess: 70,
    });
    const core12Mesh = new THREE.Mesh(c12Geo, c12Mat);
    core12Mesh.renderOrder = 1;
    coreGroup.add(core12Mesh);

    const c5Geo = buildGeometry(M.dense_core_5);
    const c5Mat = new THREE.MeshPhongMaterial({
      color: 0xdc2f1f,
      emissive: 0x4a0b05,
      specular: 0xffc6b8,
      shininess: 65,
      transparent: true,
      opacity: 0.72,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    const core5Mesh = new THREE.Mesh(c5Geo, c5Mat);
    core5Mesh.renderOrder = 2;
    coreGroup.add(core5Mesh);
    scene.add(coreGroup);
    disposables.push(c12Geo, c12Mat, c5Geo, c5Mat);

    // Sparse scatter halo
    const haloGeo = buildGeometry(M.sparse_halo);
    const haloMat = new THREE.MeshPhongMaterial({
      color: 0xee6d38,
      emissive: 0x2a0c02,
      specular: 0xffe4d6,
      shininess: 28,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.renderOrder = 3;
    scene.add(haloMesh);
    disposables.push(haloGeo, haloMat);

    // B3 biopsy cavity
    const cavGeo = buildGeometry(M.biopsy_cavity);
    const cavMat = new THREE.MeshPhongMaterial({
      color: 0x3b82f6,
      emissive: 0x0e244a,
      specular: 0xffffff,
      shininess: 48,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cavMesh = new THREE.Mesh(cavGeo, cavMat);
    cavMesh.renderOrder = 2;
    scene.add(cavMesh);
    disposables.push(cavGeo, cavMat);

    // 6 Scanned slide cross-sections
    const sliceGroup = new THREE.Group();
    const sliceClickables: THREE.Object3D[] = [];
    const sliceFrames: Record<
      string,
      {
        plane: THREE.Mesh;
        border: THREE.LineSegments;
        contourLine: THREE.Line | null;
        tickLine: THREE.Line | null;
        tagEl: HTMLButtonElement | null;
      }
    > = {};
    const pinEls: Array<{ el: HTMLElement; pos: THREE.Vector3; kind: "focus" | "cav" | "axis" | "slide" }> = [];

    labelLayer.innerHTML = "";

    data.slices
      .filter((s) => s.in_bed && s.scanned)
      .forEach((s) => {
        const g = data.grids[s.id];
        if (!g) return;
        const xPos = (s.x0_mm + s.x1_mm) / 2 - 20.5;
        const tex = makeSliceTexture(data, s.id);
        const planeGeo = new THREE.PlaneGeometry(g.plane_w_mm, g.plane_h_mm);
        planeGeo.rotateY(-Math.PI / 2);
        const isVirt = s.kind === "virtual";
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(xPos, g.plane_off_y, g.plane_off_z);
        plane.userData.blockId = s.id;
        plane.renderOrder = 5;
        sliceGroup.add(plane);
        sliceClickables.push(plane);

        const borderGeo = new THREE.EdgesGeometry(planeGeo);
        const borderMat = new THREE.LineBasicMaterial({
          color: isVirt ? 0x2563eb : 0x161614,
          transparent: true,
          opacity: 0,
        });
        const border = new THREE.LineSegments(borderGeo, borderMat);
        border.position.copy(plane.position);
        sliceGroup.add(border);
        disposables.push(tex, planeGeo, planeMat, borderGeo, borderMat);

        let contourLine: THREE.Line | null = null;
        let tickLine: THREE.Line | null = null;
        let tagEl: HTMLButtonElement | null = null;
        const ctrData = M.slice_contours[s.id];
        if (ctrData && ctrData.pts.length > 2) {
          const cPts = ctrData.pts.map(([y, z]) => new THREE.Vector3(xPos, y, z));
          cPts.push(cPts[0].clone());
          const cGeo = new THREE.BufferGeometry().setFromPoints(cPts);
          const cMat = new THREE.LineBasicMaterial({
            color: isVirt ? 0x2563eb : 0x161614,
            transparent: true,
            opacity: 0.56,
          });
          contourLine = new THREE.Line(cGeo, cMat);
          contourLine.renderOrder = 6;
          sliceGroup.add(contourLine);

          const tGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(xPos, ctrData.top_y, 0),
            new THREE.Vector3(xPos, 10.0, 0),
          ]);
          const tMat = new THREE.LineBasicMaterial({
            color: isVirt ? 0x2563eb : 0x161614,
            transparent: true,
            opacity: 0.24,
          });
          tickLine = new THREE.Line(tGeo, tMat);
          sliceGroup.add(tickLine);
          disposables.push(cGeo, cMat, tGeo, tMat);

          tagEl = document.createElement("button");
          tagEl.type = "button";
          tagEl.className = `cel-pin3d slide-tag${isVirt ? " virtual" : ""}`;
          tagEl.textContent = s.id;
          tagEl.title = `Select ${s.id} cross-section`;
          tagEl.onclick = (e) => {
            e.stopPropagation();
            onSelectRef.current(s.id);
          };
          labelLayer.appendChild(tagEl);
          pinEls.push({ el: tagEl, pos: new THREE.Vector3(xPos, 10.6, 0), kind: "slide" });
        }

        sliceFrames[s.id] = { plane, border, contourLine, tickLine, tagEl };
      });
    scene.add(sliceGroup);

    // Margins, perpendicular end-caps, and bed box
    const marginsGroup = new THREE.Group();
    const halfLen = spec.bed_length_mm / 2;
    const bedBoxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(spec.bed_length_mm, spec.bed_depth_mm, spec.bed_width_mm));
    const bedBoxMat = new THREE.LineDashedMaterial({
      color: 0x9b1c1c,
      dashSize: 1.5,
      gapSize: 1.1,
      transparent: true,
      opacity: 0.28,
    });
    const bedBox = new THREE.LineSegments(bedBoxGeo, bedBoxMat);
    bedBox.computeLineDistances();
    marginsGroup.add(bedBox);
    disposables.push(bedBoxGeo, bedBoxMat);

    [
      { x0: -20.5, x1: -15.5, color: 0xd9481f },
      { x0: 13.5, x1: 20.5, color: 0xb48a04 },
    ].forEach((cap) => {
      const w = cap.x1 - cap.x0;
      const cx = (cap.x0 + cap.x1) / 2;
      const capGeo = new THREE.BoxGeometry(w, 13.5, 19);
      const capMat = new THREE.MeshPhongMaterial({ color: 0xcbc6b8, transparent: true, opacity: 0.08, depthWrite: false });
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.set(cx, 0, 0);
      marginsGroup.add(capMesh);
      const wireGeo = new THREE.EdgesGeometry(capGeo);
      const wireMat = new THREE.LineBasicMaterial({ color: cap.color, transparent: true, opacity: 0.28 });
      const capWire = new THREE.LineSegments(wireGeo, wireMat);
      capWire.position.set(cx, 0, 0);
      marginsGroup.add(capWire);
      disposables.push(capGeo, capMat, wireGeo, wireMat);
      [-5, 0, 5].forEach((zDiv) => {
        const dg = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, 13.5));
        const dm = new THREE.LineBasicMaterial({ color: 0x9c988d, transparent: true, opacity: 0.22 });
        const dl = new THREE.LineSegments(dg, dm);
        dl.position.set(cx, 0, zDiv);
        marginsGroup.add(dl);
        disposables.push(dg, dm);
      });
    });

    const shaveMat = new THREE.MeshPhongMaterial({
      color: 0x16a34a,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shaveWireMat = new THREE.LineBasicMaterial({ color: 0x15803d, transparent: true, opacity: 0.42 });
    const cGeo = new THREE.BoxGeometry(18, 9, 1.8);
    const cMesh = new THREE.Mesh(cGeo, shaveMat);
    cMesh.position.set(0, 0, -14.8);
    marginsGroup.add(cMesh);
    const cWire = new THREE.LineSegments(new THREE.EdgesGeometry(cGeo), shaveWireMat);
    cWire.position.copy(cMesh.position);
    marginsGroup.add(cWire);

    const dGeo = new THREE.BoxGeometry(2.0, 11, 14);
    const dMesh = new THREE.Mesh(dGeo, shaveMat);
    dMesh.position.set(24.8, 0, 0);
    marginsGroup.add(dMesh);
    const dWire = new THREE.LineSegments(new THREE.EdgesGeometry(dGeo), shaveWireMat);
    dWire.position.copy(dMesh.position);
    marginsGroup.add(dWire);

    if (spec.lateral_shave_block && data.grids[spec.lateral_shave_block]) {
      const latTex = makeSliceTexture(data, spec.lateral_shave_block);
      const latGeo = new THREE.PlaneGeometry(15, 14);
      latGeo.rotateY(-Math.PI / 2);
      const latMat = new THREE.MeshBasicMaterial({ map: latTex, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
      const latMesh = new THREE.Mesh(latGeo, latMat);
      latMesh.position.set(-(halfLen + 4.3), 0, 0);
      latMesh.userData.blockId = spec.lateral_shave_block;
      marginsGroup.add(latMesh);
      sliceClickables.push(latMesh);
      const latWireMat = new THREE.LineBasicMaterial({ color: 0xd9481f, transparent: true, opacity: 0.45 });
      const latWire = new THREE.LineSegments(new THREE.EdgesGeometry(latGeo), latWireMat);
      latWire.position.copy(latMesh.position);
      marginsGroup.add(latWire);
      disposables.push(latTex, latGeo, latMat, latWireMat);
    }
    disposables.push(shaveMat, shaveWireMat, cGeo, dGeo);

    const addInkBar = (a: [number, number, number], b: [number, number, number], hex: number) => {
      const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const bm = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.7 });
      marginsGroup.add(new THREE.Line(bg, bm));
      disposables.push(bg, bm);
    };
    addInkBar([-20.5, 8.2, -10], [20.5, 8.2, -10], 0xbe185d);
    addInkBar([-20.5, -8.2, 10], [20.5, -8.2, 10], 0x161614);
    addInkBar([-20.5, -8.2, -10.3], [20.5, -8.2, -10.3], 0x2563eb);
    addInkBar([-20.5, 8.2, 10.3], [20.5, 8.2, 10.3], 0x15803d);
    scene.add(marginsGroup);

    // Leader lines to exact centroids
    const focusPos = new THREE.Vector3(...M.stats.b6_focus_pos);
    const focusPinPos = new THREE.Vector3(focusPos.x + 2.5, 13.8, focusPos.z - 6.5);
    const fLineGeo = new THREE.BufferGeometry().setFromPoints([focusPos, focusPinPos]);
    const fLineMat = new THREE.LineBasicMaterial({ color: 0x9b1c1c, transparent: true, opacity: 0.78 });
    coreGroup.add(new THREE.Line(fLineGeo, fLineMat));

    const cavPos = new THREE.Vector3(...M.stats.b3_cav_pos);
    const cavPinPos = new THREE.Vector3(cavPos.x - 2.5, cavPos.y - 10.5, cavPos.z + 5.5);
    const cLineGeo = new THREE.BufferGeometry().setFromPoints([cavPos, cavPinPos]);
    const cLineMat = new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.75 });
    cavMesh.add(new THREE.Line(cLineGeo, cLineMat));
    disposables.push(fLineGeo, fLineMat, cLineGeo, cLineMat);

    const gridHelper = new THREE.GridHelper(64, 16, 0xd8d4c8, 0xe8e5dc);
    gridHelper.position.y = -11.5;
    scene.add(gridHelper);

    const staticPins: Array<{ cls: string; text: string; pos: THREE.Vector3; kind: "focus" | "cav" | "axis" }> = [
      { cls: "cel-pin3d focus", text: m3.focus_pin_label, pos: focusPinPos, kind: "focus" },
      { cls: "cel-pin3d cav", text: m3.cavity_pin_label, pos: cavPinPos, kind: "cav" },
      { cls: "cel-pin3d axis", text: "Lateral (0 mm)", pos: new THREE.Vector3(-(halfLen + 0.5), -11.2, 12.2), kind: "axis" },
      { cls: "cel-pin3d axis", text: m3.medial_axis_label, pos: new THREE.Vector3(halfLen + 0.5, -11.2, 12.2), kind: "axis" },
      { cls: "cel-pin3d axis", text: "↑ Anterior (magenta)", pos: new THREE.Vector3(-19, 10.6, -10.5), kind: "axis" },
      { cls: "cel-pin3d axis", text: "Superior (blue)", pos: new THREE.Vector3(8, 0, -17.5), kind: "axis" },
    ];
    staticPins.forEach((sp) => {
      const el = document.createElement("div");
      el.className = sp.cls;
      el.textContent = sp.text;
      labelLayer.appendChild(el);
      pinEls.push({ el, pos: sp.pos, kind: sp.kind });
    });

    // Raycasting click on cross-sections
    const raycaster = new THREE.Raycaster();
    let downPos: [number, number] | null = null;
    const onPointerDown = (e: PointerEvent) => {
      downPos = [e.clientX, e.clientY];
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(sliceClickables, false);
      const id = hits[0]?.object?.userData?.blockId;
      if (typeof id === "string") onSelectRef.current(id);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let animTarget: {
      fromPos: THREE.Vector3;
      toPos: THREE.Vector3;
      fromLook: THREE.Vector3;
      toLook: THREE.Vector3;
      t: number;
    } | null = null;

    const api = {
      moveCam: (pos: [number, number, number], look: [number, number, number]) => {
        animTarget = {
          fromPos: camera.position.clone(),
          toPos: new THREE.Vector3(...pos),
          fromLook: controls.target.clone(),
          toLook: new THREE.Vector3(...look),
          t: 0,
        };
      },
      setAutoRotate: (on: boolean) => {
        controls.autoRotate = on;
      },
      syncSelection: (id: string, spot: boolean) => {
        Object.entries(sliceFrames).forEach(([k, obj]) => {
          const isSel = k === id;
          obj.plane.visible = !spot || isSel;
          (obj.plane.material as THREE.MeshBasicMaterial).opacity = isSel ? 0.9 : 0.42;
          obj.border.visible = isSel;
          (obj.border.material as THREE.LineBasicMaterial).opacity = isSel ? 0.45 : 0;
          if (obj.contourLine) {
            obj.contourLine.visible = !spot || isSel;
            (obj.contourLine.material as THREE.LineBasicMaterial).opacity = isSel ? 0.98 : 0.56;
          }
          if (obj.tickLine) {
            (obj.tickLine.material as THREE.LineBasicMaterial).opacity = isSel ? 0.85 : 0.24;
          }
          if (obj.tagEl) {
            obj.tagEl.classList.toggle("active", isSel);
          }
        });
      },
      syncVisibility: (v: {
        slices: boolean;
        core: boolean;
        halo: boolean;
        hull: boolean;
        cav: boolean;
        margins: boolean;
        hullOpacity: number;
      }) => {
        sliceGroup.visible = v.slices;
        coreGroup.visible = v.core;
        haloMesh.visible = v.halo;
        hullMesh.visible = v.hull;
        cavMesh.visible = v.cav;
        marginsGroup.visible = v.margins;
        hullMat.opacity = v.hullOpacity / 100;
        pinEls.forEach((p) => {
          if (p.kind === "focus") p.el.style.display = v.core ? "block" : "none";
          if (p.kind === "cav") p.el.style.display = v.cav ? "block" : "none";
          if (p.kind === "slide") p.el.style.display = v.slices ? "block" : "none";
        });
      },
    };
    sceneApiRef.current = api;

    const tmp = new THREE.Vector3();
    const updatePins = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      pinEls.forEach((p) => {
        if (p.el.style.display === "none") return;
        tmp.copy(p.pos).project(camera);
        if (tmp.z > 1) {
          p.el.style.visibility = "hidden";
          return;
        }
        p.el.style.visibility = "visible";
        p.el.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`;
        p.el.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`;
      });
    };

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (animTarget) {
        animTarget.t = Math.min(1, animTarget.t + 0.06);
        const ease = 1 - Math.pow(1 - animTarget.t, 3);
        camera.position.lerpVectors(animTarget.fromPos, animTarget.toPos, ease);
        controls.target.lerpVectors(animTarget.fromLook, animTarget.toLook, ease);
        if (animTarget.t >= 1) animTarget = null;
      }
      controls.update();
      renderer.render(scene, camera);
      updatePins();
    };
    animate();

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw > 0 && nh > 0) {
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      labelLayer.innerHTML = "";
      sceneApiRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    sceneApiRef.current?.syncVisibility({
      slices: showSlices,
      core: showCore,
      halo: showHalo,
      hull: showHull,
      cav: showCav,
      margins: showMargins,
      hullOpacity,
    });
  }, [showSlices, showCore, showHalo, showHull, showCav, showMargins, hullOpacity]);

  useEffect(() => {
    sceneApiRef.current?.syncSelection(selectedBlock, spotlight);
  }, [selectedBlock, spotlight]);

  useEffect(() => {
    sceneApiRef.current?.setAutoRotate(spinning);
  }, [spinning]);

  const handleCam = (mode: CamMode) => {
    setCamMode(mode);
    const focusPos = data.meshes_3d.stats.b6_focus_pos;
    if (mode === "iso") sceneApiRef.current?.moveCam([-38, 28, 58], [0, -0.5, 0]);
    if (mode === "ant") sceneApiRef.current?.moveCam([0, 68, 8], [0, 0, 0]);
    if (mode === "sup") sceneApiRef.current?.moveCam([0, 10, -64], [0, 0, 0]);
    if (mode === "focus") sceneApiRef.current?.moveCam([-10, 12, 18], focusPos);
  };

  const stepSlide = (delta: number) => {
    const cur = stepOrder.indexOf(selectedBlock);
    const defaultIdx = Math.max(0, stepOrder.indexOf(spec.focus_block));
    const nextIdx = cur === -1 ? defaultIdx : (cur + delta + stepOrder.length) % stepOrder.length;
    const next = stepOrder[nextIdx];
    if (next) onSelectBlock(next);
  };

  const setSlidesOnlyMode = (next: boolean) => {
    setSlidesOnly(next);
    setShowCore(!next);
    setShowHalo(!next);
    if (next) setShowSlices(true);
  };

  return (
    <>
      <div className="cel-controls">
        <CelCheckbox checked={showSlices} onCheckedChange={setShowSlices}>
          <strong>Slide cross-sections</strong>
        </CelCheckbox>
        <CelCheckbox checked={spotlight} onCheckedChange={setSpotlight}>
          Spotlight active slide
        </CelCheckbox>
        <CelCheckbox
          checked={showCore}
          onCheckedChange={(checked) => {
            setShowCore(checked);
            if (checked) setSlidesOnly(false);
          }}
        >
          3D core (≥5% / ≥12%)
        </CelCheckbox>
        <CelCheckbox
          checked={showHalo}
          onCheckedChange={(checked) => {
            setShowHalo(checked);
            if (checked) setSlidesOnly(false);
          }}
        >
          3D sparse halo
        </CelCheckbox>
        <CelCheckbox checked={showHull} onCheckedChange={setShowHull}>
          Specimen hull
        </CelCheckbox>
        <CelCheckbox checked={showCav} onCheckedChange={setShowCav}>
          {m3.cavity_toggle_label}
        </CelCheckbox>
        <CelCheckbox checked={showMargins} onCheckedChange={setShowMargins}>
          Shaves &amp; end-caps
        </CelCheckbox>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Hull
          <CelSlider
            label="Hull opacity"
            min={0}
            max={45}
            value={hullOpacity}
            onValueChange={setHullOpacity}
            style={{ width: 64 }}
          />
        </span>
      </div>

      <div className="cel-webgl-wrap" ref={containerRef}>
        {webglError ? (
          <div style={{ padding: 28, color: "#5b5953", fontSize: 13.5 }}>{webglError}</div>
        ) : (
          <>
            <div className="cel-webgl-hud">
              <Toolbar className="cel-cam-bar" aria-label="3D view">
                <ToggleGroup<CamMode>
                  className="cel-cam-group"
                  aria-label="Camera"
                  value={[camMode]}
                  onValueChange={(next) => handleCam(next[0] ?? camMode)}
                >
                  <Toggle value="iso">Isometric</Toggle>
                  <Toggle value="ant">Anterior</Toggle>
                  <Toggle value="sup">Superior</Toggle>
                  <Toggle value="focus">{m3.focus_preset_label}</Toggle>
                </ToggleGroup>
                <Tooltip>
                  <TooltipTrigger
                    render={<Toggle pressed={slidesOnly} onPressedChange={setSlidesOnlyMode} />}
                  >
                    Slides only
                  </TooltipTrigger>
                  <TooltipContent className="cel-tooltip" side="bottom" sideOffset={6}>
                    Hide interpolated 3D shells to inspect raw 4 µm cross-sections
                  </TooltipContent>
                </Tooltip>
                <Tooltip type="label">
                  <TooltipTrigger render={<ToolbarButton onClick={() => stepSlide(-1)} />}>‹</TooltipTrigger>
                  <TooltipContent className="cel-tooltip" side="bottom" sideOffset={6}>
                    Previous slide
                  </TooltipContent>
                </Tooltip>
                <Tooltip type="label">
                  <TooltipTrigger render={<ToolbarButton onClick={() => stepSlide(1)} />}>›</TooltipTrigger>
                  <TooltipContent className="cel-tooltip" side="bottom" sideOffset={6}>
                    Next slide
                  </TooltipContent>
                </Tooltip>
                <Toggle pressed={spinning} onPressedChange={setSpinning}>
                  Spin
                </Toggle>
              </Toolbar>
              <div className="cel-webgl-hint">Click slide to inspect</div>
            </div>
            <div className="cel-webgl-labels" ref={labelsRef} />
            <div className="cel-webgl-legend">
              <span><span className="cel-dot-sw" style={{ background: "#8f1014" }} />Dense core ≥12%</span>
              <span><span className="cel-dot-sw" style={{ background: "#e03c22", opacity: 0.78 }} />Focus ≥5%</span>
              <span><span className="cel-dot-sw" style={{ background: "#f59e6c", opacity: 0.6 }} />Sparse halo ≥1.2%</span>
              <span><span className="cel-dot-sw" style={{ background: "#3b82f6", opacity: 0.7 }} />{m3.cavity_legend_label}</span>
              <span><span className="cel-dot-sw" style={{ background: "#15803d", opacity: 0.6 }} />Benign shaves</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
