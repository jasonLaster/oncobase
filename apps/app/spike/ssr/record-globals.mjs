// SPIKE: inventory of browser globals touched while rendering on the server.
// Installs recording stand-ins for window/document/localStorage/etc. that
// return inert values, renders each fixture, and prints every distinct
// (global path, first app frame) pair. Inert values can change what renders,
// so this is an inventory, not a correctness check.
import { readFileSync } from "node:fs";

const hits = new Map();
function frame() {
  const stack = new Error().stack.split("\n").slice(3);
  const app = stack.find(line => line.includes(".spike-ssr") && !line.includes("record-globals"));
  return (app ?? stack[0] ?? "").trim().replace(/^at /, "").replace(/\(?file:\/\/.*\.spike-ssr\//, "").replace(/\)$/, "");
}
function stub(path) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => "";
      if (key === "then") return undefined;
      if (typeof key === "symbol") return undefined;
      const p = `${path}.${String(key)}`;
      const where = frame();
      const k = `${p} @ ${where}`;
      hits.set(k, (hits.get(k) ?? 0) + 1);
      return stub(p);
    },
    apply() { return undefined; },
    has() { return false; },
  });
}
for (const name of ["window", "document", "localStorage", "sessionStorage", "matchMedia", "location", "history", "requestAnimationFrame", "getComputedStyle", "ResizeObserver", "IntersectionObserver", "MutationObserver", "HTMLElement", "self"]) {
  Object.defineProperty(globalThis, name, { configurable: true, get() { const k = `${name} @ ${frame()}`; hits.set(k, (hits.get(k) ?? 0) + 1); return stub(name); } });
}
for (const name of ["navigator", "performance"]) {
  const real = globalThis[name];
  Object.defineProperty(globalThis, name, { configurable: true, get() { const where = frame(); if (where.includes("assets/")) { const k = `${name} @ ${where}`; hits.set(k, (hits.get(k) ?? 0) + 1); } return real; } });
}

const mod = await import(new URL("../../.spike-ssr/entry-server.js", import.meta.url));
const { createElement } = await import("react");
for (const name of ["normal", "panel18"]) {
  const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  try {
    const html = mod.renderToString(createElement(mod.ServerFirstFrame, fx));
    console.log(`# ${name}: rendered ${html.length} chars`);
  } catch (error) {
    console.log(`# ${name}: render threw`, error?.stack?.split("\n").slice(0, 4).join(" | "));
  }
}
console.log([...hits.entries()].map(([k, n]) => `${n}\t${k}`).sort().join("\n"));
