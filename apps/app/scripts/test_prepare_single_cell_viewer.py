"""Unit tests for prepare-single-cell-viewer.py. Synthetic data only (this repository is public).

Run: uv run --with numpy --with pandas --with scipy python -m unittest apps/app/scripts/test_prepare_single_cell_viewer.py
"""
import importlib.util
import json
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

spec = importlib.util.spec_from_file_location("prepare_single_cell", Path(__file__).with_name("prepare-single-cell-viewer.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class EncodingTests(unittest.TestCase):
    def test_arrays_round_trip_through_gzip_base64(self):
        for values in [np.arange(300, dtype=np.uint8), np.array([0, 65535, 7], dtype=np.uint16),
                       np.array([1, 2**31], dtype=np.uint32), np.array([0.5, -1.25], dtype=np.float32)]:
            encoded = builder.encode_array(values)
            self.assertEqual(encoded["length"], values.size)
            np.testing.assert_array_equal(builder.decode_array(encoded), values)

    def test_encoding_is_deterministic(self):
        values = np.arange(1000, dtype=np.uint16)
        self.assertEqual(builder.encode_array(values)["b64"], builder.encode_array(values)["b64"])

    def test_rejects_unsupported_dtypes(self):
        with self.assertRaises(ValueError):
            builder.encode_array(np.array([1.0]))


class CoordinateTests(unittest.TestCase):
    def test_quantizes_to_full_uint16_range_and_reports_bounds(self):
        q, bounds = builder.quantize_coords(np.array([[0.0, 10.0], [2.0, 20.0], [1.0, 15.0]]))
        self.assertEqual(bounds, [0.0, 2.0, 10.0, 20.0])
        self.assertEqual(q.dtype, np.uint16)
        np.testing.assert_array_equal(q, [0, 0, 65535, 65535, 32768, 32768])

    def test_degenerate_axis_does_not_divide_by_zero(self):
        q, _ = builder.quantize_coords(np.array([[1.0, 1.0], [1.0, 2.0]]))
        np.testing.assert_array_equal(q[0::2], [0, 0])

    def test_rejects_non_finite_coordinates(self):
        with self.assertRaises(ValueError):
            builder.quantize_coords(np.array([[np.nan, 0.0]]))


class ExpressionTests(unittest.TestCase):
    def test_log_normalize_matches_normalize_total_then_log1p(self):
        values = builder.log_normalize(np.array([0, 5, 10]), np.array([100, 1000, 0]))
        np.testing.assert_allclose(values, [0.0, np.log1p(50.0), np.log1p(100000.0)])

    def test_zero_stays_zero_and_small_positive_values_stay_visible(self):
        q, peak = builder.quantize_expression(np.array([0.0, 1e-6, 2.0, 4.0]))
        self.assertEqual(peak, 4.0)
        np.testing.assert_array_equal(q, [0, 1, 128, 255])

    def test_all_zero_gene(self):
        q, peak = builder.quantize_expression(np.zeros(4))
        self.assertEqual(peak, 0.0)
        self.assertFalse(q.any())

    def test_sparse_block_slices_each_gene(self):
        block = builder.sparse_gene_block([np.array([0, 3, 0, 9], np.uint8), np.array([0, 0, 0, 0], np.uint8), np.array([1, 0, 0, 0], np.uint8)])
        offsets = builder.decode_array(block["offsets"])
        indices = builder.decode_array(block["indices"])
        levels = builder.decode_array(block["levels"])
        np.testing.assert_array_equal(offsets, [0, 2, 2, 3])
        np.testing.assert_array_equal(indices, [1, 3, 0])
        np.testing.assert_array_equal(levels, [3, 9, 1])


class CategoricalTests(unittest.TestCase):
    def test_known_order_first_then_frequency_and_missing_code(self):
        encoded = builder.encode_categorical(["b", "a", "c", "c", "", None, "nan"], order=["a", "z"])
        self.assertEqual(encoded["labels"], ["a", "c", "b"])
        np.testing.assert_array_equal(builder.decode_array(encoded["codes"]), [2, 0, 1, 1, 255, 255, 255])


class SummaryTests(unittest.TestCase):
    def test_vendor_metrics(self):
        text = "\n".join([
            "Category,Library Type,Grouped By,Group Name,Metric Name,Metric Value",
            "Cells,Gene Expression,,,Cells,100",
            "Cells,Gene Expression,,,Median genes per cell,\"2,400\"",
            "Cells,Gene Expression,,,Median UMI counts per cell,4190",
            "Library,Gene Expression,Physical library ID,GEX_1,Sequencing saturation,0.25",
            "Library,Gene Expression,Physical library ID,GEX_1,Cells,999",
        ])
        self.assertEqual(builder.parse_vendor_metrics(text), {
            "cells": 100, "medianGenesPerCell": 2400, "medianUmisPerCell": 4190, "sequencingSaturation": 0.25,
        })

    def test_qc_summary_counts_the_shown_set(self):
        obs = pd.DataFrame({
            "n_genes_raw": [100, 200, 300, 400],
            "n_counts_raw": [1000, 2000, 3000, 4000],
            "is_tumour": [True, False, True, False],
            "is_doublet_flagged": [False, False, True, True],
            "qc_drop_reason": ["", "", "", "background_only_droplet"],
        })
        shown = np.array([True, True, False, False])
        summary = builder.summarize_qc(obs, shown)
        self.assertEqual(summary["nucleiCalled"], 4)
        self.assertEqual(summary["nucleiShown"], 2)
        self.assertEqual(summary["medianGenes"], 150.0)
        self.assertEqual(summary["medianUmis"], 1500.0)
        self.assertEqual(summary["tumourNuclei"], 1)
        self.assertEqual(summary["doubletsRemoved"], 2)
        self.assertEqual(summary["droppedByReason"], {"background_only_droplet": 1})
        json.dumps(summary)


class MarkerTests(unittest.TestCase):
    def test_picks_genes_detected_inside_a_label(self):
        from scipy import sparse
        counts = np.zeros((40, 3))
        counts[:20, 0] = 1  # gene A marks label x
        counts[20:, 1] = 1  # gene B marks label y
        counts[:, 2] = 1    # gene C is everywhere
        labels = np.array(["x"] * 20 + ["y"] * 20)
        chosen = builder.marker_genes(["A", "B", "C"], sparse.csr_matrix(counts), labels, per_group=2, exclude=set())
        self.assertEqual(chosen, ["A", "B"])


if __name__ == "__main__":
    unittest.main()
