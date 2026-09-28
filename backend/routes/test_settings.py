from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from routes._test_client import client
from testing_fixtures import CacheFolderTestCase, forget_saved_settings


class AppSettingsEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_reads_every_setting_with_its_source(self) -> None:
        with patch.dict(os.environ, {"COMFY_BASE_URL": "http://gpu-box:8188"}):
            body = client.get("/api/settings").json()

        self.assertEqual(body["comfy_base_url"]["source"], "env")
        self.assertEqual(body["ai_toolkit_base_url"]["value"], "http://127.0.0.1:8675")
        self.assertEqual(body["database_path"], os.environ["DATAFORGE_DB_PATH"])

    def test_saves_and_resets_a_setting(self) -> None:
        saved = client.put("/api/settings", json={"vision_model": "model-b"})

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(
            saved.json()["vision_model"],
            {
                "value": "model-b",
                "source": "saved",
                "fallback": "qwen38",
                "fallback_source": "default",
            },
        )

        reset = client.put("/api/settings", json={"reset": ["vision_model"]})

        self.assertEqual(reset.json()["vision_model"]["source"], "default")

    def test_whole_number_settings_stay_whole_on_the_wire(self) -> None:
        body = client.put("/api/settings", json={"draft_caption_threshold": 300}).json()

        self.assertEqual(json.dumps(body["draft_caption_threshold"]["value"]), "300")
        self.assertEqual(json.dumps(body["thumbnail_cache_max_mb"]["fallback"]), "2048")
        self.assertEqual(json.dumps(body["vision_timeout_seconds"]["value"]), "600.0")

    def test_an_unusable_value_is_refused_with_a_readable_reason(self) -> None:
        response = client.put("/api/settings", json={"comfy_base_url": "gpu-box:8188"})

        self.assertEqual(response.status_code, 422)
        self.assertIn("ComfyUI URL", response.json()["detail"])

    def test_an_unknown_reset_key_is_refused(self) -> None:
        response = client.put("/api/settings", json={"reset": ["log_level"]})

        self.assertEqual(response.status_code, 422)


class ThumbnailCacheEndpointTests(CacheFolderTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.write_thumbnail("ab" * 32, 64, used_at=1_000)

    def test_reports_the_cache_size(self) -> None:
        body = client.get("/api/thumbnails/cache").json()

        self.assertEqual(body["file_count"], 1)
        self.assertEqual(body["size_bytes"], 64)
        self.assertEqual(body["directory"], str(self.cache_dir))

    def test_clears_the_cache(self) -> None:
        body = client.delete("/api/thumbnails/cache").json()

        self.assertEqual(body, {"removed_files": 1, "freed_bytes": 64})
        self.assertEqual(client.get("/api/thumbnails/cache").json()["file_count"], 0)


if __name__ == "__main__":
    unittest.main()
