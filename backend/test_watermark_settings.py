"""Unit tests for watermark settings storage."""

from __future__ import annotations

import json
import unittest

from db import get_connection, set_preference
from watermark_settings import (
    WATERMARK_SETTINGS_KEY,
    get_watermark_settings,
    update_watermark_settings,
)


class WatermarkSettingsTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute("DELETE FROM preferences WHERE key = ?", (WATERMARK_SETTINGS_KEY,))
            conn.commit()

    def test_defaults_when_nothing_is_stored(self) -> None:
        settings = get_watermark_settings()

        self.assertEqual(settings.text, "")
        self.assertEqual(settings.size, "medium")
        self.assertEqual(settings.opacity, 50)
        self.assertEqual(settings.position, "bottom")

    def test_round_trips_every_field(self) -> None:
        update_watermark_settings(text="Sample Studio", size="large", opacity=75, position="top")

        settings = get_watermark_settings()

        self.assertEqual(settings.text, "Sample Studio")
        self.assertEqual(settings.size, "large")
        self.assertEqual(settings.opacity, 75)
        self.assertEqual(settings.position, "top")

    def test_partial_update_leaves_the_other_fields_alone(self) -> None:
        update_watermark_settings(text="Sample Studio", size="large", opacity=75, position="center")

        update_watermark_settings(text="Sample Archive")

        settings = get_watermark_settings()
        self.assertEqual(settings.text, "Sample Archive")
        self.assertEqual(settings.size, "large")
        self.assertEqual(settings.opacity, 75)
        self.assertEqual(settings.position, "center")

    def test_a_corrupt_field_falls_back_without_losing_the_others(self) -> None:
        set_preference(
            WATERMARK_SETTINGS_KEY,
            json.dumps(
                {
                    "text": "Sample Studio",
                    "size": "huge",
                    "opacity": 75,
                    "position": "side",
                }
            ),
        )

        settings = get_watermark_settings()

        self.assertEqual(settings.text, "Sample Studio")
        self.assertEqual(settings.size, "medium")
        self.assertEqual(settings.opacity, 75)
        self.assertEqual(settings.position, "bottom")


if __name__ == "__main__":
    unittest.main()
