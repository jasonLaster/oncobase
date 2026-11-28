#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["anndata>=0.10", "numpy>=1.26", "pandas>=2.1", "scipy>=1.11", "h5py>=3.10"]
# ///
"""Build the single-cell viewer's data assets from a QC'd snRNA-seq delivery.

Input is one AnnData file per library (the format of a QC'd 10x delivery:
`obsm["X_umap"]`, background-corrected counts in a layer, and per-nucleus
labels in `obs`), plus optional Cell Ranger per-sample outputs for the vendor
QC metrics and graph-based clusters. Sources may be local paths or `s3://`
URIs; S3 objects are copied with the AWS CLI into `--cache`.

Output is a folder of compact JSON files that the app's `/tools/single-cell`
route reads through `/api/file`:

  manifest.json      dataset text, gene panel, libraries and QC summaries
  <library>.json     one per library: quantized UMAP, labels, panel expression
  <library>-genes.json  optional sparse lookup set for genes outside the panel

Binary columns are gzip-compressed and base64-encoded inside the JSON, so the
browser fetches each library in one request whatever the server compresses.
This repository is public: patient-specific text (titles, specimen notes,
per-gene caveats, citations) comes from `--config`, which lives with the data
in the private vault, never in this script.

Example (see the vault page that owns the output for the real arguments):

  uv run apps/app/scripts/prepare-single-cell-viewer.py \
    --config <vault>/sources/diagnostics/single-cell/viewer-config.json \
    --out <vault>/sources/diagnostics/single-cell --cache /tmp/sc-cache
"""
from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

FORMAT_VERSION = 1
# Quantization levels for expression: 0 means "no counts", 1..255 scale to the gene's maximum.
LEVELS = 255
COORD_LEVELS = 65535
# Categorical colour codes are uint8; 255 is reserved for "no label".
MISSING_CODE = 255


# ---------------------------------------------------------------- encoding

def encode_array(values: np.ndarray) -> dict:
    """A typed array as {dtype, length, b64}: base64 of gzip of its little-endian bytes."""
    array = np.ascontiguousarray(values)
    dtype = {np.dtype("uint8"): "u8", np.dtype("uint16"): "u16", np.dtype("uint32"): "u32",
             np.dtype("float32"): "f32"}.get(array.dtype)
    if dtype is None:
        raise ValueError(f"Unsupported dtype {array.dtype}")
    raw = array.astype(array.dtype.newbyteorder("<"), copy=False).tobytes()
    packed = gzip.compress(raw, compresslevel=9, mtime=0)
    return {"dtype": dtype, "length": int(array.size), "b64": base64.b64encode(packed).decode("ascii")}


def decode_array(encoded: dict) -> np.ndarray:
    """Inverse of encode_array (used by tests and by --check)."""
    dtype = {"u8": "<u1", "u16": "<u2", "u32": "<u4", "f32": "<f4"}[encoded["dtype"]]
    raw = gzip.decompress(base64.b64decode(encoded["b64"]))
    array = np.frombuffer(raw, dtype=dtype)
    if array.size != encoded["length"]:
        raise ValueError("Encoded length mismatch")
    return array


def quantize_coords(xy: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """UMAP coordinates as interleaved uint16 (x0, y0, x1, y1, ...) plus [xmin, xmax, ymin, ymax]."""
    xy = np.asarray(xy, dtype=np.float64)
    if xy.ndim != 2 or xy.shape[1] != 2 or not np.isfinite(xy).all():
        raise ValueError("Coordinates must be a finite n x 2 array")
    lo = xy.min(axis=0)
    hi = xy.max(axis=0)
    span = np.where(hi > lo, hi - lo, 1.0)
    q = np.rint((xy - lo) / span * COORD_LEVELS).astype(np.uint16)
    return q.reshape(-1), [float(lo[0]), float(hi[0]), float(lo[1]), float(hi[1])]


def log_normalize(counts: np.ndarray, totals: np.ndarray, target: float = 1e4) -> np.ndarray:
    """log1p(counts per `target`), the usual scanpy normalize_total + log1p, for one gene."""
    totals = np.asarray(totals, dtype=np.float64)
    safe = np.where(totals > 0, totals, 1.0)
    return np.log1p(np.asarray(counts, dtype=np.float64) / safe * target)


def quantize_expression(values: np.ndarray) -> tuple[np.ndarray, float]:
    """Non-negative values as uint8 where 0 stays 0 and any positive value is at least 1."""
    values = np.asarray(values, dtype=np.float64)
    if (values < 0).any():
        raise ValueError("Expression must be non-negative")
    peak = float(values.max()) if values.size else 0.0
    if peak <= 0:
        return np.zeros(values.shape, dtype=np.uint8), 0.0
    q = np.rint(values / peak * LEVELS)
    q = np.where(values > 0, np.maximum(q, 1), 0)
    return q.astype(np.uint8), peak


def encode_categorical(labels, order: list[str] | None = None, missing: tuple[str, ...] = ("", "nan", "None")) -> dict:
    """Labels as {labels, codes}; codes index `labels`, MISSING_CODE marks no label.

    `order` puts known categories first (in that order); the rest follow by frequency."""
    values = ["" if label is None else str(label) for label in labels]
    present = [value for value in values if value not in missing]
    counts: dict[str, int] = {}
    for value in present:
        counts[value] = counts.get(value, 0) + 1
    ordered = [label for label in (order or []) if label in counts]
    ordered += sorted((label for label in counts if label not in ordered), key=lambda label: (-counts[label], label))
    if len(ordered) >= MISSING_CODE:
        raise ValueError("Too many categories for uint8 codes")
    index = {label: code for code, label in enumerate(ordered)}
    codes = np.array([index.get(value, MISSING_CODE) for value in values], dtype=np.uint8)
    return {"labels": ordered, "codes": encode_array(codes)}


def sparse_gene_block(columns: list[np.ndarray]) -> dict:
    """Quantized gene columns stored sparsely: concatenated nonzero cell indices and levels.

    `offsets[g]..offsets[g+1]` slices gene g out of `indices` (uint32) and `levels` (uint8)."""
    offsets = [0]
    indices: list[np.ndarray] = []
    levels: list[np.ndarray] = []
    for column in columns:
        nonzero = np.flatnonzero(column)
        indices.append(nonzero.astype(np.uint32))
        levels.append(column[nonzero].astype(np.uint8))
        offsets.append(offsets[-1] + nonzero.size)
    return {
        "offsets": encode_array(np.array(offsets, dtype=np.uint32)),
        "indices": encode_array(np.concatenate(indices) if indices else np.zeros(0, np.uint32)),
        "levels": encode_array(np.concatenate(levels) if levels else np.zeros(0, np.uint8)),
    }


# ---------------------------------------------------------------- summaries

def parse_vendor_metrics(text: str) -> dict:
    """Headline numbers from a Cell Ranger multi `metrics_summary.csv`."""
    wanted = {
        "Cells": "cells",
        "Median genes per cell": "medianGenesPerCell",
        "Median UMI counts per cell": "medianUmisPerCell",
        "Total genes detected": "totalGenesDetected",
        "Mean reads per cell": "meanReadsPerCell",
        "Sequencing saturation": "sequencingSaturation",
        "Confidently mapped reads in cells": "readsInCells",
        "Confidently mapped to intronic regions": "intronicFraction",
        "Number of reads": "reads",
    }
    out: dict[str, float] = {}
    for row in csv.DictReader(io.StringIO(text)):
        key = wanted.get((row.get("Metric Name") or "").strip())
        if not key or key in out:
            continue
        raw = (row.get("Metric Value") or "").replace(",", "").replace("%", "").strip()
        try:
            value = float(raw)
        except ValueError:
            continue
        out[key] = int(value) if value.is_integer() else value
    return out


def median(values) -> float | None:
    array = np.asarray(values, dtype=np.float64)
    return float(np.median(array)) if array.size else None


def summarize_qc(obs, shown_mask: np.ndarray) -> dict:
    """Plain counts for the page's QC header, from the delivery's per-nucleus table."""
    shown = obs[shown_mask]
    summary = {
        "nucleiCalled": int(len(obs)),
        "nucleiShown": int(shown_mask.sum()),
        "medianGenes": median(shown["n_genes_raw"]) if "n_genes_raw" in shown else None,
        "medianUmis": median(shown["n_counts_raw"]) if "n_counts_raw" in shown else None,
    }
    if "n_counts_cellbender" in shown:
        summary["medianUmisCorrected"] = median(shown["n_counts_cellbender"])
    if "is_tumour" in shown:
        summary["tumourNuclei"] = int(np.asarray(shown["is_tumour"], dtype=bool).sum())
    if "is_doublet_flagged" in obs:
        summary["doubletsRemoved"] = int((np.asarray(obs["is_doublet_flagged"], dtype=bool) & ~shown_mask).sum())
    if "qc_drop_reason" in obs:
        reasons = obs["qc_drop_reason"].astype(str).replace({"nan": ""})
        summary["droppedByReason"] = {str(k): int(v) for k, v in reasons[reasons != ""].value_counts().items()}
    return summary


# ---------------------------------------------------------------- sources

def fetch(uri: str, cache: Path) -> Path:
    """A local path for `uri`, copying s3:// objects into the cache once."""
    if not uri.startswith("s3://"):
        path = Path(uri).expanduser()
        if not path.exists():
            raise FileNotFoundError(uri)
        return path
    target = cache / hashlib.sha256(uri.encode()).hexdigest()[:16] / uri.rsplit("/", 1)[-1]
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        subprocess.run(["aws", "s3", "cp", "--only-show-errors", uri, str(partial)], check=True)
        partial.rename(target)
    return target


def sha256_file(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def read_text(uri: str | None, cache: Path) -> str | None:
    if not uri:
        return None
    return fetch(uri, cache).read_text()


# ---------------------------------------------------------------- build

def column(matrix, index: int) -> np.ndarray:
    col = matrix[:, index]
    return np.asarray(col.toarray()).ravel() if hasattr(col, "toarray") else np.asarray(col).ravel()


def gene_index(adata) -> dict[str, int]:
    symbols = adata.var["gene_symbol"].astype(str) if "gene_symbol" in adata.var else adata.var_names
    index: dict[str, int] = {}
    for position, symbol in enumerate(symbols):
        index.setdefault(str(symbol), position)
    return index


def marker_genes(symbols, layer_matrix, labels: np.ndarray, per_group: int, exclude: set[str]) -> list[str]:
    """Up to `per_group` genes per label, ranked by detection rate inside minus outside the label."""
    import scipy.sparse as sp

    detected = sp.csr_matrix(layer_matrix > 0, dtype=np.float32)
    symbols = np.asarray(symbols)
    chosen: list[str] = []
    seen = set(exclude)
    for label in [value for value in dict.fromkeys(labels.tolist()) if value and value != "nan"]:
        inside = labels == label
        if inside.sum() < 20 or (~inside).sum() < 20:
            continue
        rate_in = np.asarray(detected[inside].mean(axis=0)).ravel()
        rate_out = np.asarray(detected[~inside].mean(axis=0)).ravel()
        score = rate_in - rate_out
        taken = 0
        for position in np.argsort(-score, kind="stable"):
            if taken >= per_group or score[position] <= 0.05:
                break
            symbol = str(symbols[position])
            if symbol in seen or symbol.startswith(("MT-", "RPL", "RPS", "ENSG", "LINC")) or "." in symbol:
                continue
            chosen.append(symbol)
            seen.add(symbol)
            taken += 1
    return chosen


def build_library(entry: dict, config: dict, cache: Path, out: Path, extended: int) -> dict:
    import anndata as ad
    import pandas as pd

    library = entry["id"]
    source = fetch(entry["h5ad"], cache)
    print(f"[{library}] loading {source.name}", flush=True)
    adata = ad.read_h5ad(source)
    obs = adata.obs
    shown_mask = np.asarray(obs[config.get("analysisSetColumn", "in_analysis_set")], dtype=bool)
    if "X_umap" not in adata.obsm:
        raise ValueError(f"{library}: obsm['X_umap'] is required")
    layer_name = config.get("countsLayer", "cellbender")
    corrected = adata.layers[layer_name] if layer_name else adata.X
    raw = adata.X
    sub_corrected = corrected[shown_mask]
    sub_raw = raw[shown_mask]
    corrected_totals = np.asarray(sub_corrected.sum(axis=1)).ravel()
    raw_totals = np.asarray(sub_raw.sum(axis=1)).ravel()
    n = int(shown_mask.sum())

    coords, bounds = quantize_coords(np.asarray(adata.obsm["X_umap"])[shown_mask])

    categorical = {}
    for spec in config["colorings"]:
        name = spec.get("column", "")
        if spec.get("source") == "vendorClusters":
            text = read_text(entry.get("vendorClusters"), cache)
            if not text:
                continue
            clusters = pd.read_csv(io.StringIO(text), dtype=str).set_index("Barcode")["Cluster"]
            values = [f"Cluster {value}" if isinstance(value, str) else "" for value in clusters.reindex(obs.index[shown_mask]).tolist()]
            order = sorted(set(v for v in values if v), key=lambda v: int(v.split()[-1]))
        else:
            if name not in obs:
                continue
            values = obs[name][shown_mask].astype(str).tolist()
            order = spec.get("order")
        categorical[spec["key"]] = encode_categorical(values, order)

    index = gene_index(adata)
    panel = [gene["symbol"] for gene in config["genes"]]
    missing = [symbol for symbol in panel if symbol not in index]
    if missing:
        print(f"[{library}] panel genes not in the matrix: {', '.join(missing)}", flush=True)
    present = [symbol for symbol in panel if symbol in index]
    corrected_csc = sub_corrected.tocsc() if hasattr(sub_corrected, "tocsc") else sub_corrected
    raw_csc = sub_raw.tocsc() if hasattr(sub_raw, "tocsc") else sub_raw

    def quantized(matrix, totals, symbol):
        counts = column(matrix, index[symbol])
        values, peak = quantize_expression(log_normalize(counts, totals))
        return values, peak

    layers = {}
    for key, matrix, totals in (("corrected", corrected_csc, corrected_totals), ("raw", raw_csc, raw_totals)):
        columns, peaks = [], []
        for symbol in present:
            values, peak = quantized(matrix, totals, symbol)
            columns.append(values)
            peaks.append(round(peak, 5))
        layers[key] = {"max": peaks, "values": encode_array(np.concatenate(columns) if columns else np.zeros(0, np.uint8))}

    payload = {
        "version": FORMAT_VERSION,
        "library": library,
        "n": n,
        "bounds": bounds,
        "coords": encode_array(coords),
        "categorical": categorical,
        "genes": present,
        "layers": layers,
    }
    filename = f"{library.lower()}.json"
    (out / filename).write_text(json.dumps(payload, separators=(",", ":")))

    extended_file = None
    if extended > 0:
        label_column = config.get("markerColumn", "cell_type_broad")
        labels = obs[label_column][shown_mask].astype(str).to_numpy() if label_column in obs else np.array([""] * n)
        symbols = adata.var["gene_symbol"].astype(str) if "gene_symbol" in adata.var else adata.var_names
        lookup_symbols = list(dict.fromkeys(config.get("lookupGenes", []) + marker_genes(symbols, sub_corrected, labels, extended, set(present))))
        lookup_symbols = [symbol for symbol in lookup_symbols if symbol in index and symbol not in present]
        columns, peaks = [], []
        for symbol in lookup_symbols:
            values, peak = quantized(corrected_csc, corrected_totals, symbol)
            columns.append(values)
            peaks.append(round(peak, 5))
        extended_file = f"{library.lower()}-genes.json"
        (out / extended_file).write_text(json.dumps({
            "version": FORMAT_VERSION, "library": library, "n": n, "layer": "corrected",
            "genes": lookup_symbols, "max": peaks, **sparse_gene_block(columns),
        }, separators=(",", ":")))

    vendor_text = read_text(entry.get("vendorMetrics"), cache)
    qc = summarize_qc(obs, shown_mask)
    result = {
        "id": library,
        "label": entry.get("label", library),
        "description": entry.get("description", ""),
        "file": filename,
        "lookupFile": extended_file,
        "sourceSha256": sha256_file(source),
        "qc": qc,
        "vendorQc": parse_vendor_metrics(vendor_text) if vendor_text else None,
    }
    print(f"[{library}] {n} nuclei, {len(present)} panel genes, files {filename}"
          + (f", {extended_file}" if extended_file else ""), flush=True)
    return result


def build(config_path: Path, out: Path, cache: Path, extended: int) -> dict:
    config = json.loads(config_path.read_text())
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    libraries = [build_library(entry, config, cache, out, extended) for entry in config["libraries"]]
    manifest = {
        "version": FORMAT_VERSION,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "dataset": config["dataset"],
        "countsLayer": config.get("countsLayer", "cellbender"),
        "colorings": [{k: v for k, v in spec.items() if k not in {"column", "source", "order"}} for spec in config["colorings"]],
        "genes": config["genes"],
        "glossary": config.get("glossary", []),
        "libraries": libraries,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True, type=Path, help="Private viewer config JSON (dataset text, libraries, gene panel)")
    parser.add_argument("--out", required=True, type=Path, help="Output folder (the vault folder that owns the assets)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache" / "oncobase-single-cell", help="Where s3:// inputs are copied")
    parser.add_argument("--lookup-genes-per-type", type=int, default=12, help="Marker genes per cell type in the lookup set (0 disables it)")
    args = parser.parse_args(argv)
    if not shutil.which("aws") and "s3://" in args.config.read_text():
        print("The AWS CLI is required for s3:// inputs", file=sys.stderr)
        return 1
    manifest = build(args.config, args.out, args.cache, args.lookup_genes_per_type)
    for library in manifest["libraries"]:
        for name in [library["file"], library["lookupFile"]]:
            if name:
                print(f"{name}: {(args.out / name).stat().st_size / 1e6:.2f} MB")
    print(f"manifest.json: {(args.out / 'manifest.json').stat().st_size / 1e3:.1f} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
