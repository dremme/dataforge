"""Tests for /api/preferences/*."""

from __future__ import annotations

import json
import unittest
from urllib.parse import quote

from db import get_connection
from gallery_display_settings import GALLERY_DISPLAY_SETTINGS_KEY
from routes._test_client import client
from ui_settings import UI_SETTINGS_KEY
from verify_captions_settings import VERIFY_CAPTIONS_SETTINGS_KEY
from watermark_settings import WATERMARK_SETTINGS_KEY


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


class VerifyCaptionsPreferencesEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

    def test_read_default_settings(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

        folder = r"C:\Photos"
        response = client.get(f"/api/preferences/verify-captions?path={quote(folder)}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "instruct")
        self.assertEqual(response.json()["reasoning_effort"], "medium")
        self.assertIs(response.json()["preserve_thinking"], True)
        self.assertEqual(response.json()["context"], "")
        self.assertTrue(response.json()["folder_path"])

    def test_path_is_required_on_read(self) -> None:
        response = client.get("/api/preferences/verify-captions")
        self.assertEqual(response.status_code, 422)

    def test_folder_path_is_required_on_write(self) -> None:
        response = client.put(
            "/api/preferences/verify-captions",
            json={"mode": "thinking", "context": "Notes."},
        )
        self.assertEqual(response.status_code, 422)

    def test_context_is_stored_per_folder(self) -> None:
        folder_a = r"C:\Photos\A"
        folder_b = r"C:\Photos\B"

        response_a = client.put(
            "/api/preferences/verify-captions",
            json={
                "mode": "thinking",
                "context": "Outdoor portraits.",
                "folder_path": folder_a,
            },
        )
        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_a.json()["mode"], "thinking")
        self.assertEqual(response_a.json()["context"], "Outdoor portraits.")

        response_b = client.put(
            "/api/preferences/verify-captions",
            json={
                "mode": "thinking",
                "context": "Studio product shots.",
                "folder_path": folder_b,
            },
        )
        self.assertEqual(response_b.status_code, 200)
        self.assertEqual(response_b.json()["context"], "Studio product shots.")

        read_a = client.get(f"/api/preferences/verify-captions?path={quote(folder_a)}")
        self.assertEqual(read_a.status_code, 200)
        self.assertEqual(read_a.json()["mode"], "thinking")
        self.assertEqual(read_a.json()["context"], "Outdoor portraits.")

        read_b = client.get(f"/api/preferences/verify-captions?path={quote(folder_b)}")
        self.assertEqual(read_b.json()["context"], "Studio product shots.")

        folder_c = r"C:\Photos\C"
        read_c = client.get(f"/api/preferences/verify-captions?path={quote(folder_c)}")
        self.assertEqual(read_c.json()["mode"], "thinking")
        self.assertEqual(read_c.json()["context"], "")

    def test_empty_context_clears_folder_entry(self) -> None:
        folder = r"C:\Photos\A"
        client.put(
            "/api/preferences/verify-captions",
            json={"context": "Notes.", "folder_path": folder},
        )
        client.put(
            "/api/preferences/verify-captions",
            json={"context": "  ", "folder_path": folder},
        )

        read_back = client.get(f"/api/preferences/verify-captions?path={quote(folder)}")
        self.assertEqual(read_back.json()["context"], "")

    def test_reasoning_knobs_are_stored_globally(self) -> None:
        folder_a = r"C:\Photos\A"
        folder_b = r"C:\Photos\B"

        written = client.put(
            "/api/preferences/verify-captions",
            json={
                "reasoning_effort": "xhigh",
                "preserve_thinking": False,
                "folder_path": folder_a,
            },
        )
        self.assertEqual(written.status_code, 200)
        self.assertEqual(written.json()["reasoning_effort"], "xhigh")
        self.assertIs(written.json()["preserve_thinking"], False)

        # Global, not folder-keyed: another folder reads back the same choice.
        read_b = client.get(f"/api/preferences/verify-captions?path={quote(folder_b)}")
        self.assertEqual(read_b.json()["reasoning_effort"], "xhigh")
        self.assertIs(read_b.json()["preserve_thinking"], False)

    def test_rejects_an_unknown_reasoning_effort(self) -> None:
        """``high`` is the plausible wrong value: the template raises on it."""
        response = client.put(
            "/api/preferences/verify-captions",
            json={"reasoning_effort": "high", "folder_path": r"C:\Photos\A"},
        )
        self.assertEqual(response.status_code, 422)


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


class WatermarkPreferencesEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute("DELETE FROM preferences WHERE key = ?", (WATERMARK_SETTINGS_KEY,))
            conn.commit()

    def test_read_default_settings(self) -> None:
        response = client.get("/api/preferences/watermark")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"text": "", "size": "medium", "opacity": 50, "position": "bottom"},
        )

    def test_settings_survive_a_read_back(self) -> None:
        response = client.put(
            "/api/preferences/watermark",
            json={
                "text": "Sample Studio",
                "size": "large",
                "opacity": 75,
                "position": "top",
            },
        )

        self.assertEqual(response.status_code, 200)
        read_back = client.get("/api/preferences/watermark")
        self.assertEqual(
            read_back.json(),
            {
                "text": "Sample Studio",
                "size": "large",
                "opacity": 75,
                "position": "top",
            },
        )

    def test_rejects_an_unknown_size_opacity_or_position(self) -> None:
        for body in ({"size": "huge"}, {"opacity": 33}, {"position": "side"}):
            with self.subTest(body=body):
                response = client.put("/api/preferences/watermark", json=body)
                self.assertEqual(response.status_code, 422)
