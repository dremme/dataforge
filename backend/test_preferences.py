"""Unit tests for the JSON preference wrappers."""

from __future__ import annotations

import unittest

from pydantic import BaseModel

from db import get_connection, set_preference
from preferences import FolderScopedPreference, JsonPreference

TEST_KEY = "test_preferences_settings"


class Sample(BaseModel):
    name: str = ""
    size: int = 1
    flag: bool = False


def _clear() -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM preferences WHERE key = ?", (TEST_KEY,))
        conn.commit()


class JsonPreferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear()

    def tearDown(self) -> None:
        _clear()

    def test_a_missing_row_reads_as_the_defaults(self) -> None:
        self.assertEqual(JsonPreference(TEST_KEY, Sample).get(), Sample())

    def test_an_unparseable_row_reads_as_the_defaults(self) -> None:
        for raw in ("not json at all", "[1, 2, 3]", '"a string"'):
            with self.subTest(raw=raw):
                set_preference(TEST_KEY, raw)

                self.assertEqual(JsonPreference(TEST_KEY, Sample).get(), Sample())

    def test_a_bad_field_falls_back_without_losing_the_good_ones(self) -> None:
        set_preference(TEST_KEY, '{"name": "kept", "size": "not a number"}')

        settings = JsonPreference(TEST_KEY, Sample).get()

        self.assertEqual(settings.name, "kept")
        self.assertEqual(settings.size, 1)

    def test_a_saved_value_survives_a_read_back(self) -> None:
        store: JsonPreference[Sample] = JsonPreference(TEST_KEY, Sample)
        store.save(Sample(name="kept", size=9, flag=True))

        self.assertEqual(store.get(), Sample(name="kept", size=9, flag=True))


class FolderScopedPreferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear()
        self.store: FolderScopedPreference[Sample] = FolderScopedPreference(TEST_KEY, Sample)

    def tearDown(self) -> None:
        _clear()

    def test_an_unsaved_folder_reads_as_the_defaults(self) -> None:
        self.assertEqual(self.store.get(r"C:\Photos"), Sample())

    def test_a_saved_folder_survives_a_read_back(self) -> None:
        self.store.save(r"C:\Photos", Sample(name="lake", size=4, flag=True))

        self.assertEqual(self.store.get(r"C:\Photos"), Sample(name="lake", size=4, flag=True))

    def test_a_folder_with_no_save_reads_the_most_recent_one(self) -> None:
        self.store.save(r"C:\Photos", Sample(name="lake", size=4))

        # The whole point of the fallback: a folder you have never run in starts from
        # what you last used rather than from stock defaults.
        self.assertEqual(self.store.get(r"C:\Renders"), Sample(name="lake", size=4))

    def test_saving_one_folder_leaves_the_others_alone(self) -> None:
        self.store.save(r"C:\Photos", Sample(name="lake"))
        self.store.save(r"C:\Renders", Sample(name="city"))

        self.assertEqual(self.store.get(r"C:\Photos").name, "lake")
        self.assertEqual(self.store.get(r"C:\Renders").name, "city")

    def test_the_newest_save_becomes_the_fallback(self) -> None:
        self.store.save(r"C:\Photos", Sample(name="lake"))
        self.store.save(r"C:\Renders", Sample(name="city"))

        self.assertEqual(self.store.latest().name, "city")
        self.assertEqual(self.store.get(r"C:\Untouched").name, "city")

    def test_separator_style_hits_the_same_entry(self) -> None:
        # Callers key through ``preference_folder_key``; this pins that an already
        # canonical key round-trips unchanged rather than being re-normalised here.
        self.store.save("C:/Photos/A", Sample(name="lake"))

        self.assertEqual(self.store.get("C:/Photos/A").name, "lake")

    def test_a_corrupt_folder_entry_costs_only_that_folder(self) -> None:
        set_preference(
            TEST_KEY,
            '{"latest": {"name": "fallback"},'
            ' "by_folder": {"A": {"name": "good"}, "B": {"name": 17, "size": 3}}}',
        )

        self.assertEqual(self.store.get("A").name, "good")
        self.assertEqual(self.store.latest().name, "fallback")
        # B's bad name defaults, but its valid size is still kept.
        self.assertEqual(self.store.get("B"), Sample(name="", size=3))

    def test_an_unusable_envelope_reads_as_the_defaults(self) -> None:
        set_preference(TEST_KEY, '{"by_folder": "not a map"}')

        self.assertEqual(self.store.get(r"C:\Photos"), Sample())

    def test_unknown_stored_keys_are_ignored(self) -> None:
        set_preference(TEST_KEY, '{"by_folder": {"A": {"name": "kept", "gone": 1}}}')

        self.assertEqual(self.store.get("A"), Sample(name="kept"))


if __name__ == "__main__":
    unittest.main()
