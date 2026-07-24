"""Tests for /api/preferences/*."""

from __future__ import annotations

import unittest

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
        # Ensure no prior value so we exercise the default path
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

        response = client.get("/api/preferences/verify-captions")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "instruct")
        self.assertEqual(response.json()["context"], "")

    def test_update_settings(self) -> None:
        response = client.put(
            "/api/preferences/verify-captions",
            json={"mode": "thinking", "context": "Outdoor portraits."},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "thinking")
        self.assertEqual(response.json()["context"], "Outdoor portraits.")

        read_back = client.get("/api/preferences/verify-captions")
        self.assertEqual(read_back.json()["mode"], "thinking")
        self.assertEqual(read_back.json()["context"], "Outdoor portraits.")
