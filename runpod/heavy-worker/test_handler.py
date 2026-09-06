import os
import unittest

os.environ["RUNPOD_SERVERLESS"] = "0"
from handler import handler


class FaceSearchTests(unittest.TestCase):
    def test_ranks_and_filters_matches(self):
        result = handler({"input": {"task": "face_search", "queryEmbedding": [1, 0], "candidates": [
            {"id": "same", "embedding": [2, 0]},
            {"id": "near", "embedding": [1, 1]},
            {"id": "opposite", "embedding": [-1, 0]},
        ], "threshold": 0.5}})
        self.assertEqual([item["id"] for item in result["matches"]], ["same", "near"])
        self.assertEqual(result["searched"], 3)

    def test_rejects_dimension_mismatch(self):
        result = handler({"input": {"task": "face_search", "queryEmbedding": [1, 0], "candidates": [{"id": "bad", "embedding": [1]}]}})
        self.assertIn("same dimensions", result["error"])


if __name__ == "__main__":
    unittest.main()
