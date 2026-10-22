import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location("prepare_pathology", Path(__file__).with_name("prepare-pathology-slides.py"))
preparer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparer)


class SyntheticSlide:
    properties = {"aperio.Date": "10/13/2026", "openslide.objective-power": "20"}
    dimensions = (32, 32)
    color_profile = None

    def get_thumbnail(self, size):
        return Image.new("RGB", (32, 32), "white")

    def close(self):
        pass


class SyntheticPyramid:
    level_count = 1
    level_tiles = [(1, 1)]
    tile_count = 1

    def __init__(self, *args, **kwargs):
        pass

    def get_tile(self, level, position):
        return Image.new("RGB", (32, 32), "white")


class StainPreparationTest(unittest.TestCase):
    def test_protein_stain_round_trips_and_cannot_be_reused_as_he(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "Synthetic HER2.svs"
            source.write_bytes(b"synthetic input")
            with patch.object(preparer.openslide, "OpenSlide", return_value=SyntheticSlide()), patch.object(preparer, "DeepZoomGenerator", SyntheticPyramid):
                preparer.prepare(source, root / "output", "s3://synthetic", 1, "HER2")
                manifest = next((root / "output").glob("*/prepared.json"))
                record = json.loads(manifest.read_text())
                self.assertEqual(record["stain"], "HER2")
                self.assertEqual(record["sourceSha256"], preparer.digest(source))
                self.assertEqual(record["sourceBytes"], source.stat().st_size)
                self.assertEqual(record["scanDate"], "10/13/2026")
                with self.assertRaisesRegex(ValueError, "does not match"):
                    preparer.prepare(source, root / "output", "s3://synthetic", 1, "H&E")
                self.assertEqual(json.loads(manifest.read_text())["stain"], "HER2")


if __name__ == "__main__":
    unittest.main()
