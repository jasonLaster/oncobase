import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { adoptStyles } from "../../lazy-styles";
import { assetHref } from "../../wiki-assets";
import { usePageAccess } from "../tools/tool-access";
import {
  EXPRESSION_GRADIENT_CSS,
  MISSING_CODE,
  SINGLE_CELL_MANIFEST_PATH,
  SINGLE_CELL_OWNER_SLUG,
  categoryColor,
  decodeLibrary,
  decodeLookup,
  drawOrder,
  formatCount,
  groupStats,
  labelCounts,
  levelToValue,
  panelGene,
  pointColors,
  rgbCss,
  searchGenes,
  singleCellAssetPath,
  validateManifest,
  type CountsLayer,
  type GeneValues,
  type SingleCellGene,
  type SingleCellLibrary,
  type SingleCellLibraryFile,
  type SingleCellLookup,
  type SingleCellLookupFile,
  type SingleCellManifest,
} from "./data";
import { SINGLE_CELL_GLOSSARY } from "./glossary";
import { UmapCanvas } from "./UmapCanvas";
import { usePublishSingleCellView } from "./view-state";
import singleCellCss from "./single-cell.css?inline";

adoptStyles("single-cell", singleCellCss);

const GENE_MODE = "gene";

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

class RestrictedError extends Error {}

/** Data files are unlisted in the reader manifest, so their URLs are unversioned. */
async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(assetHref(path), { credentials: "same-origin", signal });
  if (response.status === 404) throw new RestrictedError("This dataset is not available to your account.");
  if (!response.ok) throw new Error(`The dataset could not load (${response.status}). Retry in a moment.`);
  return response.json() as Promise<T>;
}

type Load<T> = { status: "idle" | "loading" } | { status: "ready"; value: T } | { status: "error"; error: string; restricted: boolean };

function useAsync<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [state, setState] = useState<{ key: string | null; load: Load<T> }>({ key: null, load: { status: "idle" } });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setState({ key, load: { status: "ready", value } }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ key, load: { status: "error", error: error instanceof Error ? error.message : "Load failed", restricted: error instanceof RestrictedError } });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key names the request
  }, [key]);
  return state.key === key ? state.load : { status: key ? "loading" : "idle" };
}

export function SingleCellPage() {
  const access = usePageAccess(SINGLE_CELL_OWNER_SLUG);
  if (access === "pending") return <PageShell><p className="sc-muted" role="status">Checking access…</p></PageShell>;
  if (access === "denied") return <RestrictedNotice />;
  return <SingleCellViewer />;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <article className="sc-page" data-test-id="single-cell-page">{children}</article>;
}

function RestrictedNotice() {
  return (
    <PageShell>
      <h1 className="sc-h1">Single-cell viewer</h1>
      <div className="sc-card sc-restricted" role="note" data-test-id="single-cell-restricted">
        <h2>This dataset is restricted</h2>
        <p>It holds private genomic data. Only accounts with access to Diana&apos;s private diagnostics can open it. If you should have access, sign in with that account, or ask Jason to grant it.</p>
        <p><Link to="/tools">See all tools</Link> · <a href="/sign-in?redirect=%2Ftools%2Fsingle-cell">Sign in</a></p>
      </div>
    </PageShell>
  );
}

function SingleCellViewer() {
  const manifest = useAsync<SingleCellManifest>("manifest", async (signal) =>
    validateManifest(await fetchJson(SINGLE_CELL_MANIFEST_PATH, signal)));

  if (manifest.status === "error" && manifest.restricted) return <RestrictedNotice />;
  if (manifest.status === "error") {
    return <PageShell><h1 className="sc-h1">Single-cell viewer</h1><p className="sc-muted" role="alert">{manifest.error}</p></PageShell>;
  }
  if (manifest.status !== "ready") return <PageShell><p className="sc-muted" role="status">Loading dataset…</p></PageShell>;
  return <ViewerBody manifest={manifest.value} />;
}

function ViewerBody({ manifest }: { manifest: SingleCellManifest }) {
  const [params, setParams] = useSearchParams();
  const libraryMeta = manifest.libraries.find((library) => library.id === params.get("lib")) ?? manifest.libraries[0];
  const colorings = manifest.colorings;
  const requestedColor = params.get("color");
  const gene = params.get("gene");
  const colorBy = gene ? GENE_MODE : colorings.find((c) => c.key === requestedColor)?.key ?? colorings[0]?.key ?? GENE_MODE;
  const groupBy = colorings.find((c) => c.key === params.get("group"))?.key ?? colorings[0]?.key;
  const layer: CountsLayer = params.get("counts") === "raw" ? "raw" : "corrected";
  const [highlight, setHighlight] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const libraryPath = singleCellAssetPath(libraryMeta.file);
  const library = useAsync<SingleCellLibrary>(`lib:${libraryPath}`, async (signal) =>
    decodeLibrary(await fetchJson<SingleCellLibraryFile>(libraryPath, signal)));
  const panelSymbols = useMemo(() => new Set(manifest.genes.map((g) => g.symbol)), [manifest.genes]);
  const needsLookup = Boolean(gene && !panelSymbols.has(gene));
  const [lookupWanted, setLookupWanted] = useState(false);
  const lookupPath = libraryMeta.lookupFile ? singleCellAssetPath(libraryMeta.lookupFile) : null;
  const lookup = useAsync<SingleCellLookup>((needsLookup || lookupWanted) && lookupPath ? `lookup:${lookupPath}` : null, async (signal) =>
    decodeLookup(await fetchJson<SingleCellLookupFile>(lookupPath!, signal)));

  const ready = library.status === "ready" ? library.value : null;
  const geneValues: GeneValues | null = useMemo(() => {
    if (!ready || !gene) return null;
    if (panelSymbols.has(gene)) return panelGene(ready, gene, layer);
    return lookup.status === "ready" ? lookup.value.gene(gene) : null;
  }, [ready, gene, layer, panelSymbols, lookup]);
  const geneMeta = manifest.genes.find((g) => g.symbol === gene);

  const theme = useMemo(() => (dark
    ? { zero: [72, 76, 86] as [number, number, number], missing: [92, 96, 106] as [number, number, number] }
    : { zero: [214, 216, 222] as [number, number, number], missing: [200, 202, 208] as [number, number, number] }), [dark]);
  const category = ready && colorBy !== GENE_MODE ? ready.categories[colorBy] : null;
  const colors = useMemo(() => {
    if (!ready) return null;
    if (colorBy === GENE_MODE) return geneValues ? pointColors(ready.n, { kind: "gene", levels: geneValues.levels }, theme) : null;
    return category ? pointColors(ready.n, { kind: "category", codes: category.codes, highlight }, theme) : null;
  }, [ready, colorBy, geneValues, category, highlight, theme]);
  const order = useMemo(() => {
    if (!ready) return new Uint32Array(0);
    if (colorBy === GENE_MODE) return drawOrder(geneValues?.levels ?? null, ready.n);
    if (category && highlight != null) {
      const highlighted = new Uint8Array(ready.n);
      for (let i = 0; i < ready.n; i++) highlighted[i] = category.codes[i] === highlight ? 1 : 0;
      return drawOrder(highlighted, ready.n);
    }
    return drawOrder(null, ready.n);
  }, [ready, colorBy, geneValues, category, highlight]);

  const groupCategory = ready && groupBy ? ready.categories[groupBy] : null;
  const stats = useMemo(() => (groupCategory && geneValues ? groupStats(groupCategory.codes, groupCategory.labels, geneValues) : []),
    [groupCategory, geneValues]);
  const groupLabel = colorings.find((c) => c.key === groupBy)?.label ?? "group";

  usePublishSingleCellView({
    library: libraryMeta.label,
    colorBy: colorBy === GENE_MODE ? "gene expression" : colorings.find((c) => c.key === colorBy)?.label,
    gene: gene ?? undefined,
    geneName: geneMeta?.name,
    layer,
    groupBy: groupLabel,
    rows: stats.map(({ label, nuclei, pctExpressing, mean }) => ({ label, nuclei, pctExpressing, mean })),
    highlight: category && highlight != null ? category.labels[highlight] ?? null : null,
  });

  const qc = libraryMeta.qc;
  const groups = useMemo(() => {
    const map = new Map<string, SingleCellGene[]>();
    for (const g of manifest.genes) map.set(g.group, [...(map.get(g.group) ?? []), g]);
    return [...map.entries()];
  }, [manifest.genes]);

  return (
    <PageShell>
      <header className="sc-header">
        <p className="sc-eyebrow">Single-nucleus RNA · private research data</p>
        <h1 className="sc-h1">{manifest.dataset.title}</h1>
        {manifest.dataset.summary ? <p className="sc-lede">{manifest.dataset.summary}</p> : null}
      </header>

      <section aria-label="Quality summary" className="sc-qc" data-test-id="single-cell-qc">
        <QcStat label="Nuclei shown" value={formatCount(qc.nucleiShown)} detail={`of ${formatCount(qc.nucleiCalled)} called; the rest failed QC or looked like two nuclei`} />
        <QcStat label="Median genes" value={formatCount(qc.medianGenes)} detail="different genes read per nucleus" />
        <QcStat label="Median UMIs" value={formatCount(qc.medianUmis)} detail="RNA molecules counted per nucleus" />
        {qc.tumourNuclei != null ? <QcStat label="Tumor nuclei" value={formatCount(qc.tumourNuclei)} detail={`${((100 * qc.tumourNuclei) / Math.max(1, qc.nucleiShown)).toFixed(0)}% of nuclei shown`} /> : null}
      </section>

      <div className="sc-toolbar">
        {manifest.libraries.length > 1 ? (
          <div className="sc-field">
            <span className="sc-field-label" id="sc-library-label">Library</span>
            <div className="sc-segmented" role="radiogroup" aria-labelledby="sc-library-label">
              {manifest.libraries.map((lib) => (
                <button key={lib.id} type="button" role="radio" aria-checked={lib.id === libraryMeta.id}
                  className={lib.id === libraryMeta.id ? "active" : ""}
                  onClick={() => { setHighlight(null); update({ lib: lib.id === manifest.libraries[0].id ? null : lib.id }); }}>
                  {lib.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <label className="sc-field">
          <span className="sc-field-label">Color by</span>
          <select className="sc-select" value={colorBy} onChange={(event) => {
            setHighlight(null);
            const value = event.target.value;
            if (value === GENE_MODE) update({ gene: gene ?? manifest.genes[0]?.symbol ?? null, color: null });
            else update({ color: value === colorings[0]?.key ? null : value, gene: null });
          }}>
            {colorings.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            <option value={GENE_MODE}>Gene expression</option>
          </select>
        </label>
        <GeneSearch genes={manifest.genes} lookupGenes={lookup.status === "ready" ? lookup.value.genes : []}
          hasLookup={Boolean(lookupPath)} onFocus={() => setLookupWanted(true)}
          onPick={(symbol) => { setHighlight(null); update({ gene: symbol, color: null }); }} />
        {gene && panelSymbols.has(gene) ? (
          <div className="sc-field">
            <span className="sc-field-label" id="sc-counts-label">Counts</span>
            <div className="sc-segmented" role="radiogroup" aria-labelledby="sc-counts-label">
              <button type="button" role="radio" aria-checked={layer === "corrected"} className={layer === "corrected" ? "active" : ""} onClick={() => update({ counts: null })}>Background-corrected</button>
              <button type="button" role="radio" aria-checked={layer === "raw"} className={layer === "raw" ? "active" : ""} onClick={() => update({ counts: "raw" })}>Raw</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="sc-main">
        <div className="sc-card sc-plot">
          {library.status === "error" ? <p className="sc-muted" role="alert">{library.error}</p>
            : !ready || !colors ? (
              <p className="sc-muted sc-plot-status" role="status">{gene && needsLookup && lookup.status === "ready" && !geneValues ? `${gene} is not in this dataset's gene set.` : "Loading nuclei…"}</p>
            ) : (
              <UmapCanvas
                xy={ready.xy}
                colors={colors}
                order={order}
                background={dark ? "dark" : "light"}
                label={`Map of ${formatCount(ready.n)} nuclei from ${libraryMeta.label}, colored by ${colorBy === GENE_MODE ? `${gene} expression` : colorings.find((c) => c.key === colorBy)?.label}`}
                onHover={setHover}
              />
            )}
          {ready && hover != null ? <HoverCard library={ready} index={hover} manifest={manifest} gene={gene} values={geneValues} /> : null}
        </div>
        <aside className="sc-card sc-legend" aria-label="Legend">
          {colorBy === GENE_MODE && gene ? (
            <GeneLegend gene={gene} meta={geneMeta} values={geneValues} layer={layer} lookup={!panelSymbols.has(gene)} />
          ) : category ? (
            <CategoryLegend
              title={colorings.find((c) => c.key === colorBy)?.label ?? ""}
              description={colorings.find((c) => c.key === colorBy)?.description}
              labels={category.labels}
              counts={labelCounts(category.codes, category.labels)}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          ) : <p className="sc-muted">Loading…</p>}
        </aside>
      </div>

      <section className="sc-section" aria-labelledby="sc-panel-title">
        <h2 className="sc-h2" id="sc-panel-title">Gene panel</h2>
        <p className="sc-muted">Genes chosen for treatment and vaccine planning. Pick one to color the map and fill the table below.</p>
        <div className="sc-panel">
          {groups.map(([group, genes]) => (
            <div key={group} className="sc-panel-group">
              <h3>{group}</h3>
              <div className="sc-chips">
                {genes.map((g) => (
                  <button key={g.symbol} type="button" aria-pressed={g.symbol === gene}
                    className={`sc-chip${g.symbol === gene ? " active" : ""}${g.reliability === "caution" ? " caution" : ""}`}
                    title={g.why}
                    onClick={() => { setHighlight(null); update({ gene: g.symbol, color: null }); }}>
                    {g.symbol}{g.name && g.name !== g.symbol ? <span className="sc-chip-name"> {g.name}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sc-section" aria-labelledby="sc-table-title" data-test-id="single-cell-table">
        <div className="sc-table-head">
          <h2 className="sc-h2" id="sc-table-title">{gene ? `${gene} by ${groupLabel.toLowerCase()}` : "Expression by group"}</h2>
          <label className="sc-field sc-field-inline">
            <span className="sc-field-label">Group by</span>
            <select className="sc-select" value={groupBy} onChange={(event) => update({ group: event.target.value === colorings[0]?.key ? null : event.target.value })}>
              {colorings.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>
        {!gene ? <p className="sc-muted">Pick a gene to see what share of each group makes its RNA.</p>
          : !geneValues ? <p className="sc-muted" role="status">Loading {gene}…</p>
          : <StatsTable rows={stats} label={groupLabel} />}
      </section>

      <section className="sc-section" aria-labelledby="sc-about-title">
        <h2 className="sc-h2" id="sc-about-title">About this sample</h2>
        <div className="sc-prose">
          {libraryMeta.description ? <p><strong>{libraryMeta.label}:</strong> {libraryMeta.description}</p> : null}
          {manifest.dataset.specimen ? <p>{manifest.dataset.specimen}</p> : null}
          {manifest.dataset.labelSource ? <p><strong>Labels used.</strong> {manifest.dataset.labelSource}</p> : null}
          {manifest.dataset.countsNote ? <p><strong>Counts.</strong> {manifest.dataset.countsNote}</p> : null}
          {manifest.dataset.caveats?.length ? <ul>{manifest.dataset.caveats.map((c) => <li key={c}>{c}</li>)}</ul> : null}
          {libraryMeta.vendorQc ? <VendorQc qc={libraryMeta.vendorQc} /> : null}
        </div>
      </section>

      <section className="sc-section" aria-labelledby="sc-glossary-title">
        <h2 className="sc-h2" id="sc-glossary-title">What the words mean</h2>
        <dl className="sc-glossary">
          {[...SINGLE_CELL_GLOSSARY, ...(manifest.glossary ?? [])].map((g) => (
            <div key={g.term}><dt>{g.term}</dt><dd>{g.meaning}</dd></div>
          ))}
        </dl>
      </section>

      {manifest.dataset.sources?.length ? (
        <section className="sc-section" aria-labelledby="sc-sources-title">
          <h2 className="sc-h2" id="sc-sources-title">Sources</h2>
          <ul className="sc-sources">
            {manifest.dataset.sources.map((s) => <li key={s.href}><Link to={s.href}>{s.label}</Link></li>)}
          </ul>
          <p className="sc-muted sc-small">Data built {new Date(manifest.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.</p>
        </section>
      ) : null}
    </PageShell>
  );
}

function QcStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="sc-stat">
      <span className="sc-stat-label">{label}</span>
      <span className="sc-stat-value">{value}</span>
      <span className="sc-stat-detail">{detail}</span>
    </div>
  );
}

function VendorQc({ qc }: { qc: NonNullable<SingleCellLibraryMeta["vendorQc"]> }) {
  const pct = (v?: number) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  return (
    <p className="sc-small sc-muted">
      Sequencing lab&apos;s report for this library: {formatCount(qc.cells)} nuclei called, {formatCount(qc.meanReadsPerCell)} reads per nucleus,
      sequencing saturation {pct(qc.sequencingSaturation)}, {pct(qc.intronicFraction)} of reads from introns (expected for nuclei).
    </p>
  );
}
type SingleCellLibraryMeta = SingleCellManifest["libraries"][number];

function GeneSearch({ genes, lookupGenes, hasLookup, onPick, onFocus }: {
  genes: SingleCellGene[]; lookupGenes: string[]; hasLookup: boolean; onPick: (symbol: string) => void; onFocus: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchGenes(query, genes, lookupGenes), [query, genes, lookupGenes]);
  const pick = (symbol: string) => { onPick(symbol); setQuery(""); setOpen(false); };
  return (
    <div className="sc-field sc-search">
      <label className="sc-field-label" htmlFor="sc-gene-search">Find a gene</label>
      <input
        id="sc-gene-search"
        className="sc-input"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="sc-gene-results"
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={hasLookup ? "e.g. TROP-2, HER3, CD8A" : "e.g. TROP-2, HER3"}
        value={query}
        onFocus={() => { setOpen(true); onFocus(); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (event.key === "Enter" && hits[active]) { event.preventDefault(); pick(hits[active].symbol); }
          else if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 ? (
        <ul id="sc-gene-results" role="listbox" className="sc-results">
          {hits.map((hit, i) => (
            <li key={hit.symbol} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
              onMouseDown={(event) => { event.preventDefault(); pick(hit.symbol); }}>
              <strong>{hit.symbol}</strong>{hit.name && hit.name !== hit.symbol ? <span> {hit.name}</span> : null}
              {!hit.inPanel ? <em> extra gene</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CategoryLegend({ title, description, labels, counts, highlight, onHighlight }: {
  title: string; description?: string; labels: string[]; counts: number[]; highlight: number | null; onHighlight: (code: number | null) => void;
}) {
  return (
    <div>
      <h2 className="sc-legend-title">{title}</h2>
      {description ? <p className="sc-small sc-muted">{description}</p> : null}
      <ul className="sc-legend-list" aria-label={`${title} groups`}>
        {labels.map((label, code) => (
          <li key={label}>
            <button type="button" aria-pressed={highlight === code} className={highlight === code ? "active" : ""}
              onClick={() => onHighlight(highlight === code ? null : code)}>
              <span className="sc-swatch" style={{ background: rgbCss(categoryColor(code)) }} />
              <span className="sc-legend-label">{label}</span>
              <span className="sc-legend-count">{formatCount(counts[code])}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="sc-small sc-muted">Click a group to highlight it. Drag to pan, scroll or use + to zoom, double-click to reset.</p>
    </div>
  );
}

function GeneLegend({ gene, meta, values, layer, lookup }: { gene: string; meta?: SingleCellGene; values: GeneValues | null; layer: CountsLayer; lookup: boolean }) {
  return (
    <div data-test-id="single-cell-gene-card">
      <h2 className="sc-legend-title">{gene}{meta?.name && meta.name !== gene ? <span className="sc-muted"> · {meta.name}</span> : null}</h2>
      {meta?.reliability ? (
        <span className={`sc-badge ${meta.reliability}`}>{meta.reliability === "interpretable" ? "Reads reliably in nuclei" : "Read with caution"}</span>
      ) : lookup ? <span className="sc-badge">Extra gene · not reviewed</span> : <span className="sc-badge">Not reviewed</span>}
      {meta?.why ? <p className="sc-small">{meta.why}</p> : null}
      {meta?.note ? <p className="sc-small sc-muted">{meta.note}</p> : null}
      <div className="sc-gradient" style={{ background: EXPRESSION_GRADIENT_CSS }} aria-hidden="true" />
      <div className="sc-gradient-scale sc-small sc-muted">
        <span>low</span>
        <span>{values ? `high (${values.max.toFixed(1)} log-normalized)` : "high"}</span>
      </div>
      <p className="sc-small sc-muted"><span className="sc-swatch sc-swatch-zero" /> grey = no {gene} RNA counted. {layer === "raw" ? "Raw counts, before background removal." : "Background-corrected counts."}</p>
    </div>
  );
}

function StatsTable({ rows, label }: { rows: ReturnType<typeof groupStats>; label: string }) {
  const maxMean = Math.max(...rows.map((r) => r.mean), 1e-9);
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <thead>
          <tr><th scope="col">{label}</th><th scope="col">Nuclei</th><th scope="col">% expressing</th><th scope="col">Mean expression</th><th scope="col">Mean when expressed</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row"><span className="sc-swatch" style={{ background: rgbCss(categoryColor(row.code)) }} />{row.label}</th>
              <td className="sc-num">{formatCount(row.nuclei)}</td>
              <td className="sc-num"><span className="sc-bar-track" aria-hidden="true"><span className="sc-bar" style={{ width: `${Math.max(1, row.pctExpressing)}%` }} /></span>{row.pctExpressing.toFixed(row.pctExpressing < 10 ? 1 : 0)}%</td>
              <td className="sc-num"><span className="sc-bar-track" aria-hidden="true"><span className="sc-bar sc-bar-mean" style={{ width: `${Math.max(1, (100 * row.mean) / maxMean)}%` }} /></span>{row.mean.toFixed(2)}</td>
              <td className="sc-num">{row.expressing ? row.meanExpressing.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoverCard({ library, index, manifest, gene, values }: { library: SingleCellLibrary; index: number; manifest: SingleCellManifest; gene: string | null; values: GeneValues | null }) {
  return (
    <div className="sc-hover" role="status" aria-live="off">
      {manifest.colorings.slice(0, 3).map((c) => {
        const cat = library.categories[c.key];
        const code = cat?.codes[index];
        return cat && code !== undefined && code !== MISSING_CODE ? <div key={c.key}><span className="sc-muted">{c.label}:</span> {cat.labels[code]}</div> : null;
      })}
      {gene && values ? <div><span className="sc-muted">{gene}:</span> {values.levels[index] ? levelToValue(values.levels[index], values.max).toFixed(2) : "none counted"}</div> : null}
    </div>
  );
}
