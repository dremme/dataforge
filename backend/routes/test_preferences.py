"""Tests for /api/preferences/*."""

from __future__ import annotations

import unittest
from urllib.parse import quote

from db import get_connection
from routes._test_client import client
from ui_settings import UI_SETTINGS_KEY
from verify_captions_settings import VERIFY_CAPTIONS_SETTINGS_KEY


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
