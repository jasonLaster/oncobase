import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = { zoom: number; cx: number; cy: number };
const HOME: View = { zoom: 1, cx: 0.5, cy: 0.5 };
const PADDING = 0.04;

const VERTEX = `
attribute vec2 a_pos;
attribute vec4 a_color;
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform float u_size;
varying vec4 v_color;
void main() {
  vec2 p = a_pos * u_scale + u_offset;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = u_size;
  v_color = a_color;
}`;
const FRAGMENT = `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

/** Spatial buckets over the unit square for nearest-point hover lookups. */
function buildGrid(xy: Float32Array, size = 64) {
  const n = xy.length / 2;
  const counts = new Uint32Array(size * size + 1);
  const cell = (i: number) => Math.min(size - 1, Math.floor(xy[i * 2] * size)) + Math.min(size - 1, Math.floor(xy[i * 2 + 1] * size)) * size;
  for (let i = 0; i < n; i++) counts[cell(i) + 1]++;
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const fill = counts.slice();
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) items[fill[cell(i)]++] = i;
  return { size, starts: counts, items };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

export function UmapCanvas({
  xy,
  colors,
  order,
  label,
  onHover,
  background,
}: {
  /** Interleaved unit-square coordinates. */
  xy: Float32Array;
  /** RGBA per point, in point order. */
  colors: Uint8Array;
  /** Draw order (later points paint on top). */
  order: Uint32Array;
  label: string;
  onHover?: (index: number | null) => void;
  /** Repaint trigger when the theme changes. */
  background: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const glState = useRef<{ gl: WebGLRenderingContext; program: WebGLProgram; pos: WebGLBuffer; color: WebGLBuffer } | null>(null);
  const [mode, setMode] = useState<"webgl" | "2d" | null>(null);
  const grid = useMemo(() => buildGrid(xy), [xy]);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const n = xy.length / 2;

  // Reordered buffers so draw order is a plain sequential draw.
  const ordered = useMemo(() => {
    const positions = new Float32Array(n * 2);
    const rgba = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) {
      const i = order[k] ?? k;
      positions[k * 2] = xy[i * 2];
      positions[k * 2 + 1] = xy[i * 2 + 1];
      rgba.set(colors.subarray(i * 4, i * 4 + 4), k * 4);
    }
    return { positions, rgba };
  }, [xy, colors, order, n]);

  // Set up WebGL (or the 2D fallback) once, then size the canvas from the
  // observer, whose first callback also reports the render mode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let resolved: "webgl" | "2d" = "2d";
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (gl) {
      try {
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
        glState.current = { gl, program, pos: gl.createBuffer()!, color: gl.createBuffer()! };
        resolved = "webgl";
      } catch {
        glState.current = null;
      }
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setMode(resolved);
      setSize({ width, height, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Unit square -> clip space, letterboxed to keep UMAP's aspect ratio.
  const transform = useCallback((v: View) => {
    const aspect = size.width && size.height ? size.width / size.height : 1;
    const base = (2 - 2 * PADDING * 2) * v.zoom;
    const sx = aspect >= 1 ? base / aspect : base;
    const sy = aspect >= 1 ? base : base * aspect;
    return { sx, sy, ox: -v.cx * sx, oy: -v.cy * sy };
  }, [size.width, size.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mode || !size.width) return;
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    const { sx, sy, ox, oy } = transform(view);
    // Dots grow slowly with zoom so dense regions separate without blobbing.
    const pointSize = Math.min(9, (n > 20000 ? 2.2 : 3) * Math.sqrt(view.zoom)) * size.dpr;
    if (mode === "webgl" && glState.current) {
      const { gl, program, pos, color } = glState.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const posLoc = gl.getAttribLocation(program, "a_pos");
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, ordered.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      const colorLoc = gl.getAttribLocation(program, "a_color");
      gl.bindBuffer(gl.ARRAY_BUFFER, color);
      gl.bufferData(gl.ARRAY_BUFFER, ordered.rgba, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.uniform2f(gl.getUniformLocation(program, "u_scale"), sx, sy);
      gl.uniform2f(gl.getUniformLocation(program, "u_offset"), ox, oy);
      gl.uniform1f(gl.getUniformLocation(program, "u_size"), pointSize);
      gl.drawArrays(gl.POINTS, 0, n);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const r = pointSize / 2;
    for (let k = 0; k < n; k++) {
      const px = ((ordered.positions[k * 2] * sx + ox + 1) / 2) * canvas.width;
      const py = ((1 - (ordered.positions[k * 2 + 1] * sy + oy)) / 2) * canvas.height;
      const a = ordered.rgba[k * 4 + 3] / 255;
      ctx.fillStyle = `rgba(${ordered.rgba[k * 4]},${ordered.rgba[k * 4 + 1]},${ordered.rgba[k * 4 + 2]},${a})`;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }, [mode, size, view, ordered, n, transform, background]);

  const toUnit = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { sx, sy, ox, oy } = transform(view);
    const clipX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const clipY = 1 - ((clientY - rect.top) / rect.height) * 2;
    return { x: (clipX - ox) / sx, y: (clipY - oy) / sy, pxPerUnit: (sx * rect.width) / 2 };
  }, [transform, view]);

  const nearest = useCallback((clientX: number, clientY: number) => {
    const { x, y, pxPerUnit } = toUnit(clientX, clientY);
    const radius = 8 / pxPerUnit;
    const { size: g, starts, items } = grid;
    let best = -1;
    let bestD = radius * radius;
    const x0 = Math.max(0, Math.floor((x - radius) * g));
    const x1 = Math.min(g - 1, Math.floor((x + radius) * g));
    const y0 = Math.max(0, Math.floor((y - radius) * g));
    const y1 = Math.min(g - 1, Math.floor((y + radius) * g));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const c = gx + gy * g;
        for (let k = starts[c]; k < starts[c + 1]; k++) {
          const i = items[k];
          const dx = xy[i * 2] - x;
          const dy = xy[i * 2 + 1] - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return best >= 0 ? best : null;
  }, [grid, toUnit, xy]);

  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }) => {
    setView((current) => {
      const zoom = Math.max(1, Math.min(24, current.zoom * factor));
      if (!at || zoom === current.zoom) return zoom === 1 ? HOME : { ...current, zoom };
      const k = current.zoom / zoom;
      return { zoom, cx: at.x + (current.cx - at.x) * k, cy: at.y + (current.cy - at.y) * k };
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { x, y } = toUnit(event.clientX, event.clientY);
      zoomBy(Math.exp(-event.deltaY * 0.0015), { x, y });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [toUnit, zoomBy]);

  return (
    <div className="sc-umap">
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="sc-umap-canvas"
        data-test-id="single-cell-umap"
        data-render-mode={mode ?? "pending"}
        data-points={n}
        role="img"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start) {
            const rect = event.currentTarget.getBoundingClientRect();
            const { sx, sy } = transform(start.view);
            const dx = ((event.clientX - start.x) / rect.width) * 2 / sx;
            const dy = ((event.clientY - start.y) / rect.height) * 2 / sy;
            if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 3) start.moved = true;
            setView({ ...start.view, cx: start.view.cx - dx, cy: start.view.cy + dy });
            return;
          }
          onHover?.(nearest(event.clientX, event.clientY));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; onHover?.(null); }}
        onDoubleClick={() => setView(HOME)}
      />
      <div className="sc-umap-controls">
        <button type="button" className="sc-icon-button" aria-label="Zoom in" onClick={() => zoomBy(1.6)}>+</button>
        <button type="button" className="sc-icon-button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>−</button>
        <button type="button" className="sc-icon-button" aria-label="Reset view" disabled={view === HOME} onClick={() => setView(HOME)}>⟲</button>
      </div>
    </div>
  );
}
