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
from captions import load_issue_summary
from duplicates import duplicate_file_path, group_id_for, load_duplicate_finding
from testing_fixtures import (
    TempMediaFolder,
    write_image,
    write_issue_sidecar,
    write_media,
)


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


def group_of(media: Path) -> str:
    finding = load_duplicate_finding(media)
    assert finding is not None, f"{media.name} carries no duplicate finding"
    return finding.group


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
        """A chains to B and B to C, so all three group even though A and C are further apart."""
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b0001, Path("c.png"): 0b0011}

        groups = _group_duplicates(hashes, max_distance=1)

        self.assertEqual(groups, [[Path("a.png"), Path("b.png"), Path("c.png")]])

    def test_unique_files_are_not_groups(self) -> None:
        hashes = {Path("a.png"): 0b0000, Path("b.png"): 0b1111}

        self.assertEqual(_group_duplicates(hashes, max_distance=1), [])


class GroupIdTests(unittest.TestCase):
    def test_membership_decides_the_id_regardless_of_order(self) -> None:
        self.assertEqual(group_id_for(["b.png", "a.png"]), group_id_for(["a.png", "b.png"]))

    def test_a_different_membership_is_a_different_group(self) -> None:
        self.assertNotEqual(group_id_for(["a.png", "b.png"]), group_id_for(["a.png", "c.png"]))


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

            # The shared group id is the only thing linking the two files.
            self.assertEqual(group_of(first), group_of(second))
            self.assertEqual(group_of(first), group_id_for(["one.png", "two.png"]))

    def test_leaves_unique_media_unflagged(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=3)
            second = write_patterned_image(root, "two.png", seed=29)

            result = run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(result["stats"]["duplicate"], 0)
            self.assertFalse(duplicate_file_path(first).exists())
            self.assertFalse(duplicate_file_path(second).exists())

    def test_identical_files_read_as_exact_under_a_loose_threshold(self) -> None:
        """The distance describes the files, not the slack the run happened to allow."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="loose")

            finding = load_duplicate_finding(first)
            assert finding is not None
            self.assertEqual(finding.max_distance, 0)
            self.assertTrue(finding.exact)
            self.assertEqual(finding.threshold, "loose")

    def test_caption_issues_are_untouched(self) -> None:
        """Separate sidecars: neither job can reach the other's findings."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")
            write_issue_sidecar(first, "The caption says night but the photo is daylight.")

            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(
                load_issue_summary(first)[0],
                ["The caption says night but the photo is daylight."],
            )
            self.assertIsNotNone(load_duplicate_finding(first))

    def test_rerunning_leaves_the_sidecar_byte_identical(self) -> None:
        """The group id is derived, so an unchanged folder does not churn mtimes."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="exact")
            before = duplicate_file_path(first).read_bytes()
            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(duplicate_file_path(first).read_bytes(), before)

    def test_a_finding_is_dropped_once_the_duplicate_is_gone(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            second = root / "two.png"
            shutil.copyfile(first, second)

            run_find_duplicates_job(root, threshold="exact")
            second.unlink()
            run_find_duplicates_job(root, threshold="exact")

            self.assertFalse(duplicate_file_path(first).exists())

    def test_a_group_larger_than_two_shares_one_id(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            copies = []
            for index in range(2, 7):
                copy = root / f"copy{index}.png"
                shutil.copyfile(first, copy)
                copies.append(copy)

            result = run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(result["stats"]["group"], 1)
            self.assertEqual(result["stats"]["duplicate"], 6)
            self.assertEqual(len({group_of(path) for path in [first, *copies]}), 1)

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
            self.assertFalse(duplicate_file_path(first).exists())

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
            self.assertFalse(duplicate_file_path(second).exists())

    def test_the_sidecar_holds_the_group_distance_and_threshold(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "one.png", seed=7)
            shutil.copyfile(first, root / "two.png")

            run_find_duplicates_job(root, threshold="exact")

            payload = json.loads(duplicate_file_path(first).read_text(encoding="utf-8"))
            self.assertEqual(sorted(payload), ["group", "max_distance", "threshold"])
            # Deliberately no member list - see the duplicates module docstring.
            self.assertNotIn("members", payload)


class StemSharingTests(unittest.TestCase):
    """A generated folder holds a video beside the still that previews it.

    Both sit under one stem, and a stem-named sidecar would be one file for the two of
    them. Order decided the damage: the run wrote the video's finding, reached the still
    it does not group, and cleared what it had just written - leaving a group of one that
    no re-run could repair, because every re-run did the same thing.

    The fixtures stand in for that shape with images, and the extensions are chosen so the
    unique file sorts *after* the duplicate one, the way ``clip.png`` follows ``clip.mp4``.
    """

    def test_a_still_sharing_a_stem_does_not_clear_the_media_finding(self) -> None:
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "clip.jpg", seed=11)
            second = root / "clip-copy.jpg"
            shutil.copy(first, second)
            # Same stem as the duplicate, nothing like it to look at, sorted after it.
            write_patterned_image(root, "clip.png", seed=29)

            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(group_of(first), group_of(second))
            self.assertIsNone(load_duplicate_finding(root / "clip.png"))

    def test_the_group_survives_a_second_run(self) -> None:
        """The clobber was reproducible, so repairing it has to be too."""
        with TempMediaFolder() as root:
            first = write_patterned_image(root, "clip.jpg", seed=11)
            second = root / "clip-copy.jpg"
            shutil.copy(first, second)
            write_patterned_image(root, "clip.png", seed=29)

            run_find_duplicates_job(root, threshold="exact")
            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(group_of(first), group_of(second))

    def test_two_stem_sharers_can_each_hold_their_own_finding(self) -> None:
        """One sidecar per stem could only ever record one of the two groups."""
        with TempMediaFolder() as root:
            video_like = write_patterned_image(root, "clip.jpg", seed=11)
            still_like = write_patterned_image(root, "clip.png", seed=29)
            shutil.copy(video_like, root / "other.jpg")
            shutil.copy(still_like, root / "other.png")

            run_find_duplicates_job(root, threshold="exact")

            self.assertEqual(group_of(video_like), group_of(root / "other.jpg"))
            self.assertEqual(group_of(still_like), group_of(root / "other.png"))
            self.assertNotEqual(group_of(video_like), group_of(still_like))


if __name__ == "__main__":
    unittest.main()
