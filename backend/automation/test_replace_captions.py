"""Unit tests for automation.replace_captions."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.replace_captions import (
    build_caption_replacer,
    preview_caption_replacements,
    run_replace_captions_job,
    validate_replace_captions_folder,
)
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_txt_caption,
)


class CaptionReplacerTests(unittest.TestCase):
    def test_literal_search_ignores_regex_metacharacters(self) -> None:
        replace = build_caption_replacer(search="a.b", replacement="X")

        self.assertIsNone(replace("axb"))
        self.assertEqual(replace("a.b c"), "X c")

    def test_regex_search_supports_backreferences(self) -> None:
        replace = build_caption_replacer(
            search=r"(\w+) dog",
            replacement=r"\1 cat",
            use_regex=True,
        )

        self.assertEqual(replace("a brown dog runs"), "a brown cat runs")

    def test_matching_is_case_insensitive_by_default(self) -> None:
        insensitive = build_caption_replacer(search="Dog", replacement="cat")
        sensitive = build_caption_replacer(search="Dog", replacement="cat", case_sensitive=True)

        self.assertEqual(insensitive("a dog"), "a cat")
        self.assertIsNone(sensitive("a dog"))

    def test_unchanged_caption_reports_no_edit(self) -> None:
        replace = build_caption_replacer(search="cat", replacement="cat")

        self.assertIsNone(replace("a cat"))

    def test_prepend_and_append_add_text(self) -> None:
        prepend = build_caption_replacer(mode="prepend", replacement="sks person, ")
        append = build_caption_replacer(mode="append", replacement=", high quality")

        self.assertEqual(prepend("a portrait"), "sks person, a portrait")
        self.assertEqual(append("a portrait"), "a portrait, high quality")

    def test_prepend_and_append_are_idempotent(self) -> None:
        """A second run must not stack a second copy of the trigger word."""
        prepend = build_caption_replacer(mode="prepend", replacement="sks person, ")
        append = build_caption_replacer(mode="append", replacement=", high quality")

        self.assertIsNone(prepend("sks person, a portrait"))
        self.assertIsNone(append("a portrait, high quality"))

    def test_rejects_unusable_edits(self) -> None:
        with self.assertRaisesRegex(ValueError, "text to search for"):
            build_caption_replacer(search="")

        with self.assertRaisesRegex(ValueError, "text to add"):
            build_caption_replacer(mode="append", replacement="   ")

        with self.assertRaisesRegex(ValueError, "Invalid regular expression"):
            build_caption_replacer(search="(unclosed", use_regex=True)

        with self.assertRaisesRegex(ValueError, "Unknown replace mode"):
            build_caption_replacer(mode="destroy", search="a")


class ReplaceCaptionsValidationTests(unittest.TestCase):
    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_replace_captions_folder(root, search="a")

    def test_rejects_invalid_regex_before_the_job_starts(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, "Invalid regular expression"):
                validate_replace_captions_folder(root, search="(unclosed", use_regex=True)


class ReplaceCaptionsJobTests(unittest.TestCase):
    def test_replaces_text_in_txt_sidecars(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a brown dog in a field")

            result = run_replace_captions_job(root, search="dog", replacement="cat")

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "a brown cat in a field",
            )

    def test_json_captions_keep_their_original_key(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_json_caption(media, {"caption": "a brown dog", "tags": ["animal"]})

            run_replace_captions_job(root, search="dog", replacement="cat")

            payload = json.loads(media.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(payload["caption"], "a brown cat")
            self.assertEqual(payload["tags"], ["animal"])

    def test_non_matching_captions_are_skipped_without_rewriting(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a red bicycle")
            sidecar = media.with_suffix(".txt")
            before = sidecar.stat().st_mtime_ns

            result = run_replace_captions_job(root, search="dog", replacement="cat")

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertEqual(result["stats"]["success"], 0)
            self.assertEqual(sidecar.stat().st_mtime_ns, before)

    def test_media_without_a_caption_is_counted_separately(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            result = run_replace_captions_job(root, search="dog", replacement="cat")

            self.assertEqual(result["stats"]["no_caption"], 1)
            self.assertEqual(result["results"][0]["status"], "no_caption")

    def test_selection_limits_the_job(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            write_txt_caption(first, "a dog")
            write_txt_caption(second, "a dog")

            result = run_replace_captions_job(
                root,
                search="dog",
                replacement="cat",
                selected_paths=[first],
            )

            self.assertEqual(result["total"], 1)
            self.assertEqual(
                second.with_suffix(".txt").read_text(encoding="utf-8").strip(), "a dog"
            )

    def test_write_failures_are_reported(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a dog")

            with patch(
                "automation.replace_captions.save_caption",
                side_effect=OSError("disk full"),
            ):
                result = run_replace_captions_job(root, search="dog", replacement="cat")

            self.assertEqual(result["stats"]["write_error"], 1)
            self.assertEqual(result["results"][0]["message"], "disk full")

    def test_cancellation_stops_the_run(self) -> None:
        with TempMediaFolder() as root:
            for index in range(3):
                media = write_media(root, f"photo{index}.png")
                write_txt_caption(media, "a dog")

            result = run_replace_captions_job(
                root,
                search="dog",
                replacement="cat",
                should_cancel=lambda: True,
            )

            self.assertEqual(result["stats"]["cancelled"], 3)
            self.assertEqual(result["stats"]["success"], 0)


class ReplaceCaptionsPreviewTests(unittest.TestCase):
    def test_counts_matches_and_returns_samples(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            third = write_media(root, "three.png")
            write_txt_caption(first, "a dog")
            write_txt_caption(second, "a bicycle")
            write_txt_caption(third, "another dog")

            preview = preview_caption_replacements(root, search="dog", replacement="cat")

            self.assertEqual(preview["total"], 3)
            self.assertEqual(preview["matched"], 2)
            samples = preview["samples"]
            self.assertEqual([sample["name"] for sample in samples], ["one.png", "three.png"])
            self.assertEqual(samples[0]["before"], "a dog")
            self.assertEqual(samples[0]["after"], "a cat")

    def test_preview_does_not_write(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a dog")
            sidecar = media.with_suffix(".txt")
            before = sidecar.stat().st_mtime_ns

            preview_caption_replacements(root, search="dog", replacement="cat")

            self.assertEqual(sidecar.stat().st_mtime_ns, before)
            self.assertEqual(sidecar.read_text(encoding="utf-8").strip(), "a dog")

    def test_sample_count_is_capped(self) -> None:
        with TempMediaFolder() as root:
            for index in range(5):
                media = write_media(root, f"photo{index}.png")
                write_txt_caption(media, "a dog")

            preview = preview_caption_replacements(root, search="dog", replacement="cat")

            self.assertEqual(preview["matched"], 5)
            self.assertEqual(len(preview["samples"]), 3)


if __name__ == "__main__":
    unittest.main()
