#!/usr/bin/env python3
"""Prepare SVS tissue-only Deep Zoom tiles as bounded JPEG packs.

Install openslide-python, openslide-bin and Pillow in an operator venv.
Original SVS and associated label/macro images are never rewritten or uploaded.
The manifest is written last; incomplete output must not be registered.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import math
import re
import threading
from pathlib import Path

import openslide
from openslide.deepzoom import DeepZoomGenerator
from PIL import ImageCms


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def prepare(source, destination, source_prefix, workers):
    sha = digest(source)
    slide_id = "he-" + sha[:20]
    out = destination / slide_id
    out.mkdir(parents=True, exist_ok=True)
    if (out / "prepared.json").exists():
        print(f"Already prepared {slide_id}", flush=True)
        return
    slide = openslide.OpenSlide(str(source))
    props = dict(slide.properties)
    width, height = slide.dimensions
    tile_size, overlap = 1024, 1
    dz = DeepZoomGenerator(slide, tile_size=tile_size, overlap=overlap, limit_bounds=False)
    local = threading.local()

    def render(task):
        level, col, row = task
        if not hasattr(local, "dz"):
            local.slide = openslide.OpenSlide(str(source))
            local.dz = DeepZoomGenerator(local.slide, tile_size=tile_size, overlap=overlap, limit_bounds=False)
            local.transform = None
            if local.slide.color_profile:
                local.transform = ImageCms.buildTransform(local.slide.color_profile, ImageCms.createProfile("sRGB"), "RGB", "RGB")
        tile = local.dz.get_tile(level, (col, row))
        if local.transform:
            ImageCms.applyTransform(tile, local.transform, inPlace=True)
        encoded = io.BytesIO()
        tile.save(encoded, "JPEG", quality=90, subsampling=0)
        return f"{level}/{col}_{row}", encoded.getvalue()

    tasks = ((level, col, row) for level in range(dz.level_count)
             for row in range(dz.level_tiles[level][1]) for col in range(dz.level_tiles[level][0]))
    packs, tiles = [], {}
    pack = None
    pack_bytes = 0
    count = 0
    # Keep only a bounded window of encoded tiles in memory, in deterministic order.
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        iterator = iter(tasks)
        pending = []
        for _ in range(workers * 2):
            task = next(iterator, None)
            if task is not None:
                pending.append(pool.submit(render, task))
        while pending:
            key, data = pending.pop(0).result()
            if pack is None or pack_bytes + len(data) > 64 * 1024 * 1024:
                if pack:
                    pack.close()
                pack_name = f"pack-{len(packs):04d}.bin"
                packs.append({"file": pack_name})
                pack = (out / pack_name).open("wb")
                pack_bytes = 0
            tiles[key] = [len(packs) - 1, pack_bytes, len(data)]
            pack.write(data)
            pack_bytes += len(data)
            count += 1
            if count % 500 == 0:
                print(f"{slide_id}: {count}/{dz.tile_count} tiles", flush=True)
            task = next(iterator, None)
            if task is not None:
                pending.append(pool.submit(render, task))
    if pack:
        pack.close()
    for entry in packs:
        path = out / entry["file"]
        entry.update(sizeBytes=path.stat().st_size, sha256=digest(path))
    thumbnail = slide.get_thumbnail((640, 640)).convert("RGB")
    if slide.color_profile:
        ImageCms.applyTransform(thumbnail, ImageCms.buildTransform(slide.color_profile, ImageCms.createProfile("sRGB"), "RGB", "RGB"), inPlace=True)
    thumbnail.save(out / "thumbnail.jpg", "JPEG", quality=90)
    accession_match = re.search(r"SP-\d{2}-\d+", source.name)
    accession = accession_match.group(0) if accession_match else None

    def numeric(key):
        value = props.get(key)
        return float(value) if value and math.isfinite(float(value)) and float(value) > 0 else None

    record = {
        "slideId": slide_id, "label": accession or source.stem, "stain": "H&E",
        "sourceFileName": source.name, "sourceUri": source_prefix.rstrip("/") + "/" + source.name,
        "sourceBytes": source.stat().st_size, "sourceSha256": sha,
        "width": width, "height": height, "tileSize": tile_size, "overlap": overlap,
        "maxLevel": dz.level_count - 1, "tileCount": dz.tile_count,
        "colorProfile": "sRGB" if slide.color_profile else "source RGB; no embedded ICC profile",
        "scanner": props.get("aperio.ScanScope ID", props.get("openslide.vendor", "Unknown")),
    }
    for name, key in [("mppX", "openslide.mpp-x"), ("mppY", "openslide.mpp-y"), ("objectivePower", "openslide.objective-power")]:
        value = numeric(key)
        if value is not None:
            record[name] = value
    if accession:
        record["accession"] = accession
    if props.get("aperio.Date"):
        record["scanDate"] = props["aperio.Date"]
    manifest = {"version": 1, "slideId": slide_id, "sourceSha256": sha, "width": width, "height": height,
                "tileSize": tile_size, "overlap": overlap, "maxLevel": dz.level_count - 1, "packs": packs, "tiles": tiles}
    (out / "tiles.json").write_text(json.dumps(manifest, separators=(",", ":")))
    (out / "prepared.json").write_text(json.dumps(record, indent=2) + "\n")
    slide.close()
    print(f"Prepared {slide_id}: {width}×{height}, {count} tiles, {len(packs)} packs", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-prefix", required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    sources = sorted(args.source.glob("*.svs")) if args.source.is_dir() else [args.source]
    if not sources:
        raise SystemExit("No SVS files found")
    for source in sources:
        prepare(source, args.output, args.source_prefix, max(1, min(args.workers, 12)))
