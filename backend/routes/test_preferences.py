from __future__ import annotations

import json
import unittest
from urllib.parse import quote

from automation_settings import AUTOMATION_SETTINGS_KEY_PREFIX, JOB_SETTINGS_MODELS
from db import get_connection
from gallery_display_settings import GALLERY_DISPLAY_SETTINGS_KEY
from routes._test_client import client
from ui_settings import UI_SETTINGS_KEY


class UiPreferencesEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        # Reset to clean defaults for isolation from other tests
        with get_connection() as conn:
            conn.execute("DELETE FROM preferences WHERE key = ?", (UI_SETTINGS_KEY,))
            conn.commit()

    def test_read_default_sort(self) -> None:
        response = client.get("/api/preferences/ui")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sort"], "name-asc")

    def test_update_sort(self) -> None:
        response = client.put("/api/preferences/ui", json={"sort": "date-desc"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sort"], "date-desc")

    def test_update_megapixels_sort(self) -> None:
        response = client.put("/api/preferences/ui", json={"sort": "megapixels-desc"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sort"], "megapixels-desc")

    def test_update_duration_sort(self) -> None:
        response = client.put("/api/preferences/ui", json={"sort": "duration-desc"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sort"], "duration-desc")

    def test_invalid_sort_falls_back_to_default(self) -> None:
        response = client.put("/api/preferences/ui", json={"sort": "not-a-real-sort"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sort"], "name-asc")

    def test_read_default_automation_specs_visibility(self) -> None:
        response = client.get("/api/preferences/ui")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["show_automation_specs"])

    def test_update_automation_specs_visibility(self) -> None:
        response = client.put("/api/preferences/ui", json={"show_automation_specs": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["show_automation_specs"])

        read_back = client.get("/api/preferences/ui")
        self.assertTrue(read_back.json()["show_automation_specs"])


class GalleryDisplayPreferencesEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (GALLERY_DISPLAY_SETTINGS_KEY,),
            )
            conn.commit()

    def test_read_default_mode(self) -> None:
        folder = r"C:\Photos"
        response = client.get(f"/api/preferences/gallery-display?path={quote(folder)}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "large")
        self.assertTrue(response.json()["folder_path"])

    def test_path_is_required_on_read(self) -> None:
        response = client.get("/api/preferences/gallery-display")
        self.assertEqual(response.status_code, 422)

    def test_folder_path_is_required_on_write(self) -> None:
        response = client.put("/api/preferences/gallery-display", json={"mode": "list"})
        self.assertEqual(response.status_code, 422)

    def test_unknown_mode_is_rejected(self) -> None:
        response = client.put(
            "/api/preferences/gallery-display",
            json={"mode": "mosaic", "folder_path": r"C:\Photos"},
        )
        self.assertEqual(response.status_code, 422)

    def test_mode_is_stored_per_folder(self) -> None:
        folder_a = r"C:\Photos\A"
        folder_b = r"C:\Photos\B"

        response_a = client.put(
            "/api/preferences/gallery-display",
            json={"mode": "list", "folder_path": folder_a},
        )
        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_a.json()["mode"], "list")

        response_b = client.put(
            "/api/preferences/gallery-display",
            json={"mode": "small", "folder_path": folder_b},
        )
        self.assertEqual(response_b.json()["mode"], "small")

        read_a = client.get(f"/api/preferences/gallery-display?path={quote(folder_a)}")
        self.assertEqual(read_a.json()["mode"], "list")

        read_b = client.get(f"/api/preferences/gallery-display?path={quote(folder_b)}")
        self.assertEqual(read_b.json()["mode"], "small")

        # A folder nobody has chosen a mode for keeps the default.
        read_c = client.get(f"/api/preferences/gallery-display?path={quote(r'C:\Photos\C')}")
        self.assertEqual(read_c.json()["mode"], "large")

    def test_separator_style_hits_the_same_entry(self) -> None:
        client.put(
            "/api/preferences/gallery-display",
            json={"mode": "list", "folder_path": r"C:\Photos\A"},
        )

        read_back = client.get(f"/api/preferences/gallery-display?path={quote('C:/Photos/A')}")
        self.assertEqual(read_back.json()["mode"], "list")

    def test_returning_to_default_drops_the_stored_entry(self) -> None:
        folder = r"C:\Photos\A"
        client.put(
            "/api/preferences/gallery-display",
            json={"mode": "list", "folder_path": folder},
        )
        client.put(
            "/api/preferences/gallery-display",
            json={"mode": "large", "folder_path": folder},
        )

        read_back = client.get(f"/api/preferences/gallery-display?path={quote(folder)}")
        self.assertEqual(read_back.json()["mode"], "large")

        with get_connection() as conn:
            row = conn.execute(
                "SELECT value FROM preferences WHERE key = ?",
                (GALLERY_DISPLAY_SETTINGS_KEY,),
            ).fetchone()

        # The default is what an absent key means, so it must not be written back.
        stored = json.loads(row[0])
        self.assertEqual(stored["mode_by_folder"], {})


class AutomationPreferencesEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key LIKE ?",
                (f"{AUTOMATION_SETTINGS_KEY_PREFIX}.%",),
            )
            conn.commit()

    def test_path_is_required_on_read(self) -> None:
        self.assertEqual(client.get("/api/preferences/automation").status_code, 422)

    def test_read_returns_a_block_for_every_job_with_a_dialog(self) -> None:
        response = client.get(f"/api/preferences/automation?path={quote(r'C:\Photos')}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body) - {"folder_path"}, set(JOB_SETTINGS_MODELS))
        self.assertTrue(body["folder_path"])

    def test_read_returns_the_documented_defaults(self) -> None:
        body = client.get(f"/api/preferences/automation?path={quote(r'C:\Photos')}").json()

        self.assertEqual(body["auto_caption"]["mode"], "thinking")
        self.assertEqual(body["verify_captions"]["mode"], "instruct")
        self.assertEqual(body["find_duplicates"]["threshold"], "near")
        self.assertEqual(
            body["watermark"],
            {
                "text": "",
                "size": "medium",
                "opacity": 50,
                "position": "bottom",
            },
        )

    def test_there_is_no_write_endpoint(self) -> None:
        # Settings are stored by the job-start routes, not a separate write.
        response = client.put("/api/preferences/automation", json={})

        self.assertEqual(response.status_code, 405)
