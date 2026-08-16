"""Unit tests for automation.find_duplicates."""

from __future__ import annotations

import json
import shutil
import unittest
from pathlib import Path

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.find_duplicates import (
    _group_duplicates,
    difference_hash,
    hamming_distance,
    run_find_duplicates_job,
    validate_find_duplicates_folder,
)
from captions import issue_file_path, load_issue_summary
from testing_fixtures import TempMediaFolder, write_image, write_issue_sidecar, write_media


def write_patterned_image(root: Path, name: str, *, seed: int, size: int = 64) -> Path:
    """An image with real structure, which a flat colour fixture does not have.

    A difference hash compares each pixel with its right-hand neighbour, so every
    single-colour image hashes to zero whatever the colour - fine as a duplicate
    pair, useless as a distinct one.
    """
    from PIL import Image

    image = Image.new("RGB", (size, size))
    pixels = image.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            pixels[x, y] = ((x * seed) % 256, (y * seed) % 256, ((x + y) * seed) % 256)

    media = root / name
    image.save(media)
    return media


def fixes_for(media: Path) -> list[str]:
    return load_issue_summary(media)[0]


class DifferenceHashTests(unittest.TestCase):
    def test_identical_images_hash_alike(self) -> None:
        with TempMediaFolder() as root:
            from PIL import Image

            first = write_patterned_image(root, "one.png", seed=7)
            second = write_patterned_image(root, "two.png", seed=7)

            with Image.open(first) as left, Image.open(second) as right:
                self.assertEqual(difference_hash(left), difference_hash(right))

    def test_different_images_hash_apart(self) -> None:
        with TempMediaFolder() as root:
            from PIL import Image

            first = write_patterned_image(root, "one.png", seed=3)
            second = write_patterned_image(root, "two.png", seed=29)

            with Image.open(first) as left, Image.open(second) as right:
                self.assertGreater(
                    hamming_distance(difference_hash(left), difference_hash(right)), 10
                )

    def test_hamming_distance_counts_differing_bits(self) -> None:
        self.assertEqual(hamming_distance(0b1010, 0b1010), 0)
        self.assertEqual(hamming_distance(0b1010, 0b1011), 1)
        self.assertEqual(hamming_distance(0b0000, 0b1111), 4)


class GroupDuplicatesTests(unittest.TestCase):
    def test_groups_only_hashes_within_the_threshold(self) -> None:
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b0001, Path("c.png"): 0b1111}

        groups = _group_duplicates(hashes, max_distance=1)

        self.assertEqual(groups, [[Path("a.png"), Path("b.png")]])

    def test_exact_threshold_ignores_near_matches(self) -> None:
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b0001}

        self.assertEqual(_group_duplicates(hashes, max_distance=0), [])

    def test_grouping_is_transitive(self) -> None:
        """A chains to B and B to C, so all three land in one group even though A and C are further apart."""
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b0001, Path("c.png"): 0b0011}

        groups = _group_duplicates(hashes, max_distance=1)

        self.assertEqual(groups, [[Path("a.png"), Path("b.png"), Path("c.png")]])

    def test_unique_files_are_not_groups(self) -> None:
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b1111}

        self.assertEqual(_group_duplicates(hashes, max_distance=1), [])


class FindDuplicatesValidationTests(unittest.TestCase):
    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_find_duplicates_folder(root)

    def test_rejects_an_unknown_threshold(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, "Unknown duplicate threshold"):
                validate_find_duplicates_folder(root, threshold="identical")


class FindDuplicatesJobTests(unittest.TestCase):
    def test_flags_both_halves_of_a_duplicate_pair(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            second = root / "two.png"
            shutil.copyfile(first, second)

            result = run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(result["stats"]["hashed"], 2)
            self.assertEqual(result["stats"]["duplicate"], 2)
            self.assertEqual(result["stats"]["group"], 1)
            self.assertEqual(fixes_for(first), ["Duplicate of two.png."])
            self.assertEqual(fixes_for(second), ["Duplicate of one.png."])

    def test_leaves_unique_media_unflagged(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=3)
            second = write_patterned_image(root, "two.png", seed=29)

            result = run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(result["stats"]["duplicate"], 0)
            self.assertFalse(issue_file_path(first).exists())
            self.assertFalse(issue_file_path(second).exists())

    def test_near_threshold_says_near_duplicate(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="near")

            self.assertEqual(fixes_for(first), ["Near-duplicate of two.png."])

    def test_existing_caption_issues_survive(self) -> None:
        """Unlike verify-captions, this job must not clear the sidecars it did not write."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")
            write_issue_sidecar(first, "The caption says night but the photo is daylight.")

            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(
                fixes_for(first),
                [
                    "Duplicate of two.png.",
                    "The caption says night but the photo is daylight.",
                ],
            )

    def test_rerunning_replaces_rather_than_stacks_its_own_finding(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="exact")
            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(fixes_for(first), ["Duplicate of two.png."])

    def test_a_finding_is_dropped_once_the_duplicate_is_gone(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            second = root / "two.png"
            shutil.copyfile(first, second)

            run_find_duplicates_job(root, threshold="exact")
            second.unlink()
            run_find_duplicates_job(root, threshold="exact")

            self.assertFalse(issue_file_path(first).exists())

    def test_a_stale_finding_goes_without_taking_caption_issues_with_it(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            second = root / "two.png"
            shutil.copyfile(first, second)

            run_find_duplicates_job(root, threshold="exact")
            write_issue_sidecar(
                first,
                "Duplicate of two.png.",
                "The caption says night but the photo is daylight.",
            )
            second.unlink()
            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(
                fixes_for(first),
                ["The caption says night but the photo is daylight."],
            )

    def test_names_beyond_the_cap_collapse_into_a_count(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            for index in range(2, 7):
                shutil.copyfile(first, root / f"copy{index}.png")

            run_find_duplicates_job(root, threshold="exact")

            fix = fixes_for(first)[0]
            self.assertTrue(fix.startswith("Duplicate of copy2.png, copy3.png, copy4.png"), fix)
            self.assertIn("and 2 more", fix)

    def test_an_unreadable_file_is_reported_and_skipped(self) -> None:
        with TempMediaFolder() as root:
            write_patterned_image(root, "one.png", seed=7)
            broken = root / "broken.png"
            broken.write_bytes(b"not an image")

            result = run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(result["stats"]["read_error"], 1)
            self.assertEqual(result["stats"]["hashed"], 1)

    def test_cancellation_writes_nothing(self) -> None:
        """A half-hashed folder cannot tell a unique file from an unexamined one."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            result = run_find_duplicates_job(root, threshold="exact", should_cancel=lambda: True)

            self.assertEqual(result["stats"]["cancelled"], 2)
            self.assertEqual(result["stats"]["duplicate"], 0)
            self.assertFalse(issue_file_path(first).exists())

    def test_selection_limits_the_comparison(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            second = root / "two.png"
            shutil.copyfile(first, second)
            third = write_image(root, "three.png")

            result = run_find_duplicates_job(
                root,
                threshold="exact",
                selected_paths=[first, third],
            )

            self.assertEqual(result["total"], 2)
            self.assertFalse(issue_file_path(second).exists())

    def test_the_sidecar_holds_only_the_fixes_key(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="exact")

            payload = json.loads(issue_file_path(first).read_text(encoding="utf-8"))
            self.assertEqual(list(payload), ["fixes"])


if __name__ == "__main__":
    unittest.main()
