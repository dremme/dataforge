"""Unit tests for Comfy workflow detection cache."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from unittest.mock import patch

from comfy_metadata import clear_comfy_workflow_cache_for_tests, media_has_comfy_workflow
from testing_fixtures import TempMediaFolder, write_media


class ComfyWorkflowCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_comfy_workflow_cache_for_tests()

    def tearDown(self) -> None:
        clear_comfy_workflow_cache_for_tests()

    def test_reuses_cached_probe_until_file_changes(self) -> None:
        with TempMediaFolder() as root:
            workflow = '{"nodes": [], "last_node_id": 1}'
            media = write_media(root, "comfy.png", text_chunks={"workflow": workflow})
            probe_calls = {"count": 0}
            original = media_has_comfy_workflow.__globals__["_probe_comfy_workflow"]

            def counting_probe(file_path):
                probe_calls["count"] += 1
                return original(file_path)

            with patch("comfy_metadata._probe_comfy_workflow", side_effect=counting_probe):
                self.assertTrue(media_has_comfy_workflow(media))
                self.assertTrue(media_has_comfy_workflow(media))

            self.assertEqual(probe_calls["count"], 1)

    def test_invalidates_cache_when_file_content_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(
                root,
                "comfy.png",
                text_chunks={"workflow": '{"nodes": [], "last_node_id": 1}'},
            )
            probe_calls = {"count": 0}
            original = media_has_comfy_workflow.__globals__["_probe_comfy_workflow"]

            def counting_probe(file_path):
                probe_calls["count"] += 1
                return original(file_path)

            with patch("comfy_metadata._probe_comfy_workflow", side_effect=counting_probe):
                self.assertTrue(media_has_comfy_workflow(media))
                write_media(
                    root,
                    "comfy.png",
                    width=96,
                    text_chunks={"workflow": '{"nodes": [{"id": 1}], "last_node_id": 2}'},
                )
                self.assertTrue(media_has_comfy_workflow(media))

            self.assertEqual(probe_calls["count"], 2)


if __name__ == "__main__":
    unittest.main()
