/**
 * MDX-style components in wiki pages, without evaluating page code.
 *
 * A page opts in with top-level ESM imports and uses each import as a block
 * JSX element:
 *
 *   import YieldChart from "./components/yield-chart.html"
 *   import { SlidesViewer } from "@oncobase/wiki-markdown"
 *
 *   <YieldChart height={450} fallback="./images/yield-chart.png" alt="..." />
 *
 * - A default import of a local `.html` file under a `components/` folder
 *   renders as a sandboxed iframe (opaque origin, scripts only).
 * - A named import from `@oncobase/wiki-markdown` resolves against the host's
 *   React component registry.
 * - Props must be literals: strings, numbers, booleans or JSON values. Nothing
 *   in the page is executed.
 * - `fallback` names a static image. Copy-as-markdown and print use it in
 *   place of the live component.
 *
 * This module is dependency-free so hosts can use the portable export without
 * loading the renderer.
 */

export const WIKI_COMPONENT_PACKAGE = "@oncobase/wiki-markdown";
export const WIKI_COMPONENT_SANDBOX = "allow-scripts allow-popups";
export const WIKI_COMPONENT_HEIGHT_MESSAGE = "oncobase:component-height";
const DEFAULT_HEIGHT = 480;

export type WikiComponentImport =
  | { kind: "html"; name: string; source: string }
  | { kind: "react"; name: string; exportName: string; source: string };

export type WikiComponentProps = Record<string, unknown>;

export type WikiComponentUse = {
  name: string;
  props: WikiComponentProps;
  import?: WikiComponentImport;
  error?: string;
  start: number;
  end: number;
};

type Range = [number, number];

const IMPORT_RE = /^import[ \t]+(.+?)[ \t]+from[ \t]+(["'])([^"'\n]+)\2[ \t]*;?[ \t]*$/gm;
const IDENT = "[A-Z][A-Za-z0-9_]*";

function fencedRanges(md: string): Range[] {
  const ranges: Range[] = [];
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*$/gm;
  let open: { start: number; marker: string } | null = null;
  for (const match of md.matchAll(fence)) {
    const marker = match[2];
    if (!open) open = { start: match.index!, marker };
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && !match[0].trim().slice(marker.length).trim()) {
      ranges.push([open.start, match.index! + match[0].length]);
      open = null;
    }
  }
  if (open) ranges.push([open.start, md.length]);
  return ranges;
}

const inRanges = (index: number, ranges: Range[]) => ranges.some(([a, b]) => index >= a && index < b);

function parseImportClause(clause: string, source: string): WikiComponentImport[] | string {
  const local = /^(?:\.\.?\/)/.test(source);
  const trimmed = clause.trim();
  const named = trimmed.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}$/);
  const single = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
  if (local) {
    if (!single) return `Import a local component as a default import: import Name from "${source}"`;
    if (!/\.html$/i.test(source.split(/[?#]/)[0])) return `Local component imports must be .html files: ${source}`;
    if (!new RegExp(`^${IDENT}$`).test(single[1])) return `Component names must start with a capital letter: ${single[1]}`;
    return [{ kind: "html", name: single[1], source }];
  }
  if (source !== WIKI_COMPONENT_PACKAGE) return `Unsupported import source "${source}". Use a local ./components/*.html file or ${WIKI_COMPONENT_PACKAGE}.`;
  if (!named || named[1]) return `Import React components by name: import { Name } from "${WIKI_COMPONENT_PACKAGE}"`;
  const imports: WikiComponentImport[] = [];
  for (const part of named[2].split(",").map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (!m) return `Invalid import specifier: ${part}`;
    imports.push({ kind: "react", exportName: m[1], name: m[2] ?? m[1], source });
  }
  return imports;
}

/** Scan an opening JSX tag from `start` (at `<`). Returns attribute source and end index. */
function scanTag(md: string, start: number, name: string): { attrs: string; end: number; selfClosing: boolean } | null {
  let i = start + 1 + name.length;
  let quote: string | null = null;
  let depth = 0;
  for (; i < md.length; i++) {
    const c = md[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; continue; }
    if (depth > 0) continue;
    if (c === "/" && md[i + 1] === ">") return { attrs: md.slice(start + 1 + name.length, i), end: i + 2, selfClosing: true };
    if (c === ">") return { attrs: md.slice(start + 1 + name.length, i), end: i + 1, selfClosing: false };
  }
  return null;
}

function parseLiteral(source: string): unknown {
  const s = source.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^'(?:[^'\\]|\\.)*'$/.test(s)) return s.slice(1, -1).replace(/\\(.)/g, "$1");
  if (/^[["{]/.test(s)) return JSON.parse(s);
  throw new Error(`Only literal props are supported, not {${s}}`);
}

export function parseComponentAttributes(attrs: string): WikiComponentProps {
  const props: WikiComponentProps = {};
  let i = 0;
  const ws = () => { while (i < attrs.length && /\s/.test(attrs[i])) i++; };
  while (true) {
    ws();
    if (i >= attrs.length) return props;
    const key = attrs.slice(i).match(/^[A-Za-z_][\w-]*/)?.[0];
    if (!key) throw new Error(`Unexpected "${attrs.slice(i, i + 12)}" in component props`);
    i += key.length;
    ws();
    if (attrs[i] !== "=") { props[key] = true; continue; }
    i++;
    ws();
    const c = attrs[i];
    if (c === '"' || c === "'") {
      const close = attrs.indexOf(c, i + 1);
      if (close < 0) throw new Error(`Unterminated string for ${key}`);
      props[key] = attrs.slice(i + 1, close);
      i = close + 1;
    } else if (c === "{") {
      let depth = 0, j = i, quote: string | null = null;
      for (; j < attrs.length; j++) {
        const d = attrs[j];
        if (quote) { if (d === "\\") j++; else if (d === quote) quote = null; continue; }
        if (d === '"' || d === "'") quote = d;
        else if (d === "{") depth++;
        else if (d === "}" && --depth === 0) break;
      }
      if (depth !== 0) throw new Error(`Unterminated expression for ${key}`);
      props[key] = parseLiteral(attrs.slice(i + 1, j));
      i = j + 1;
    } else throw new Error(`Prop ${key} needs a quoted string or {literal}`);
  }
}

export type ParsedWikiMdx = {
  imports: Map<string, WikiComponentImport>;
  importRanges: Range[];
  importErrors: Array<{ start: number; end: number; error: string }>;
  uses: WikiComponentUse[];
};

/** Find component imports and their block-level uses. Returns null for plain markdown. */
export function parseWikiMdx(md: string): ParsedWikiMdx | null {
  if (!md.includes("import")) return null;
  const fences = fencedRanges(md);
  const imports = new Map<string, WikiComponentImport>();
  const importRanges: Range[] = [];
  const importErrors: ParsedWikiMdx["importErrors"] = [];
  for (const match of md.matchAll(IMPORT_RE)) {
    const start = match.index!;
    if (inRanges(start, fences)) continue;
    const end = start + match[0].length + (md[start + match[0].length] === "\n" ? 1 : 0);
    importRanges.push([start, end]);
    const parsed = parseImportClause(match[1], match[3]);
    if (typeof parsed === "string") importErrors.push({ start, end, error: parsed });
    else for (const item of parsed) imports.set(item.name, item);
  }
  if (!importRanges.length) return null;
  const uses: WikiComponentUse[] = [];
  if (imports.size) {
    const names = [...imports.keys()].map(n => n.replace(/\$/g, "\\$")).join("|");
    const tagRe = new RegExp(`^[ \\t]*<(${names})(?=[\\s/>])`, "gm");
    for (const match of md.matchAll(tagRe)) {
      const name = match[1];
      const start = match.index! + match[0].indexOf("<");
      if (inRanges(start, fences)) continue;
      const tag = scanTag(md, start, name);
      if (!tag) { uses.push({ name, props: {}, start, end: start + match[0].length, error: `Unclosed <${name}> tag` }); continue; }
      let end = tag.end;
      let error: string | undefined;
      if (!tag.selfClosing) {
        const close = md.slice(end).match(new RegExp(`^\\s*</${name}>`));
        if (close) end += close[0].length;
        else error = `<${name}> takes no children; close it with />`;
      }
      let props: WikiComponentProps = {};
      try { props = parseComponentAttributes(tag.attrs); } catch (e) { error ??= (e as Error).message; }
      uses.push({ name, props, import: imports.get(name), error, start, end });
    }
  }
  return { imports, importRanges, importErrors, uses };
}

type Replacement = { start: number; end: number; text: string };

function rewrite(md: string, parsed: ParsedWikiMdx, use: (u: WikiComponentUse) => string, importError: (error: string) => string) {
  const edits: Replacement[] = [
    ...parsed.importRanges.map(([start, end]) => {
      const failure = parsed.importErrors.find(e => e.start === start);
      return { start, end, text: failure ? importError(failure.error) : "" };
    }),
    ...parsed.uses.map(u => ({ start: u.start, end: u.end, text: use(u) })),
  ].sort((a, b) => b.start - a.start);
  let out = md;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const str = (value: unknown) => typeof value === "string" ? value : undefined;

export function componentHeight(props: WikiComponentProps) {
  const height = Number(props.height);
  return Number.isFinite(height) && height >= 80 && height <= 4000 ? Math.round(height) : DEFAULT_HEIGHT;
}

function errorBlock(message: string) {
  return `\n<div class="wiki-component-error" role="note">Component error: ${escapeHtml(message)}</div>\n`;
}

/**
 * Replace imports and component uses with raw-HTML placeholders the renderers
 * understand. The fallback image (if any) stays in the placeholder so print
 * and non-interactive renders keep a static picture.
 */
export function expandWikiMdx(md: string): string {
  const parsed = parseWikiMdx(md);
  if (!parsed) return md;
  return rewrite(md, parsed, (u) => {
    if (u.error) return errorBlock(u.error);
    const imp = u.import!;
    const title = str(u.props.title) ?? str(u.props.alt) ?? u.name;
    const fallback = str(u.props.fallback);
    const alt = str(u.props.alt) ?? title;
    const attrs = [
      `data-wiki-component="${escapeHtml(u.name)}"`,
      `data-wiki-component-kind="${imp.kind}"`,
      imp.kind === "html"
        ? `data-wiki-component-src="${escapeHtml(imp.source)}" data-wiki-component-height="${componentHeight(u.props)}"`
        : `data-wiki-component-export="${escapeHtml(imp.exportName)}" data-wiki-component-props="${escapeHtml(JSON.stringify(u.props))}"`,
      `data-wiki-component-title="${escapeHtml(title)}"`,
    ].join(" ");
    const image = fallback ? `<img src="${escapeHtml(fallback)}" alt="${escapeHtml(alt)}" data-wiki-component-fallback>` : "";
    return `\n<figure class="wiki-component" ${attrs}>${image}</figure>\n`;
  }, errorBlock);
}

/**
 * Markdown that reads correctly outside the wiki: imports removed, each
 * component replaced by its fallback image, or by a link to its HTML source
 * when it has none.
 */
export function toPortableMarkdown(md: string): string {
  const parsed = parseWikiMdx(md);
  if (!parsed) return md;
  return rewrite(md, parsed, (u) => {
    const fallback = str(u.props.fallback);
    const alt = (str(u.props.alt) ?? str(u.props.title) ?? u.name).replace(/[[\]]/g, "");
    if (fallback) return `![${alt}](${fallback})`;
    if (u.import?.kind === "html") return `[${alt}](${u.import.source})`;
    return "";
  }, () => "");
}

/** Every asset path an MDX page depends on: component sources and fallbacks. */
export function wikiMdxReferences(md: string): string[] {
  const parsed = parseWikiMdx(md);
  if (!parsed) return [];
  return [
    ...[...parsed.imports.values()].filter(i => i.kind === "html").map(i => i.source),
    ...parsed.uses.map(u => str(u.props.fallback)).filter((v): v is string => Boolean(v)),
  ];
}

/** Resolve a component's `.html` source to the file API. Only `components/` folders may hold executable HTML. */
export function resolveWikiComponentSrc(src: string | undefined, currentSlug?: string, apiBasePath = ""): string {
  const invalid = (): never => { throw Error(`Component source must be a local .html file in a components/ folder: ${src}`); };
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src) || /[\\?\u0000-\u001f]/.test(src)) return invalid();
  const [rawPath, ...hash] = src.split("#");
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return invalid(); }
  const directory = currentSlug?.split("/").slice(0, -1).join("/") ?? "";
  const joined = decoded.startsWith("/") ? decoded.slice(1) : directory ? `${directory}/${decoded}` : decoded;
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") { if (!parts.length) return invalid(); parts.pop(); } else parts.push(part);
  }
  const asset = parts.join("/");
  if (!isWikiComponentAssetPath(asset)) return invalid();
  return `${apiBasePath}/api/file?path=${encodeURIComponent(asset)}${hash.length ? `#${hash.join("#")}` : ""}`;
}

/** The vault paths allowed to serve executable component HTML. */
export function isWikiComponentAssetPath(relativePath: string) {
  const parts = relativePath.split("/");
  return /\.html$/i.test(relativePath) && parts.slice(0, -1).includes("components") &&
    !parts.some(p => !p || p === "." || p === "..") && !/[\\%:\u0000-\u001f]/.test(relativePath);
}
