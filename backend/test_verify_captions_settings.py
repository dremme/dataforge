"""Unit tests for verify_captions_settings storage."""

from __future__ import annotations

import json
import unittest

from db import get_connection, set_preference
from verify_captions_settings import (
    VERIFY_CAPTIONS_SETTINGS_KEY,
    get_verify_captions_settings,
    preference_folder_key,
    update_verify_captions_settings,
)


class VerifyCaptionsSettingsTests(unittest.TestCase):
    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

    def test_preference_folder_key_normalizes_drive_and_slashes(self) -> None:
        self.assertEqual(preference_folder_key("c:"), "C:\\")
        self.assertEqual(preference_folder_key("C:/"), "C:\\")

    def test_preference_folder_key_keeps_windows_and_posix_paths_stable(self) -> None:
        win_key = preference_folder_key(r"C:\Photos\A")
        self.assertEqual(preference_folder_key(win_key), win_key)
        self.assertTrue(win_key.replace("/", "\\").upper().startswith("C:"))

        from testing_fixtures import TempMediaFolder

        with TempMediaFolder() as root:
            host_key = preference_folder_key(str(root))
            self.assertEqual(preference_folder_key(host_key), host_key)
            self.assertEqual(host_key, str(root.resolve()))

    def test_legacy_global_context_is_not_applied_to_folders(self) -> None:
        set_preference(
            VERIFY_CAPTIONS_SETTINGS_KEY,
            json.dumps({"mode": "thinking", "context": "Old global context."}),
        )

        settings = get_verify_captions_settings(folder_path=r"C:\Photos")
        self.assertEqual(settings.mode, "thinking")
        self.assertEqual(settings.context, "")

    def test_update_and_read_per_folder_context(self) -> None:
        update_verify_captions_settings(
            mode="instruct",
            context="Outdoor.",
            folder_path=r"C:\Photos\A",
        )
        update_verify_captions_settings(
            context="Studio.",
            folder_path=r"C:\Photos\B",
        )

        self.assertEqual(
            get_verify_captions_settings(folder_path=r"C:\Photos\A").context,
            "Outdoor.",
        )
        self.assertEqual(
            get_verify_captions_settings(folder_path=r"C:\Photos\B").context,
            "Studio.",
        )
        self.assertEqual(
            get_verify_captions_settings(folder_path=r"C:\Photos\C").context,
            "",
        )


if __name__ == "__main__":
    unittest.main()
