import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from candidate_pairing import candidate_name_for, candidate_path_for
from constants import STAGING_DIR_NAME


class CandidateNameTests(unittest.TestCase):
    def test_an_exact_name_wins_over_the_stem_rule(self) -> None:
        name = candidate_name_for("clip.mp4", {"clip.mp4", "clip.png"}, {"clip.mp4"})

        self.assertEqual(name, "clip.mp4")

    def test_a_still_claims_the_staged_png(self) -> None:
        self.assertEqual(candidate_name_for("photo.jpg", {"photo.png"}, {"photo.jpg"}), "photo.png")

    def test_a_clip_claims_the_staged_mp4(self) -> None:
        self.assertEqual(candidate_name_for("clip.mov", {"clip.mp4"}, {"clip.mov"}), "clip.mp4")

    def test_a_sibling_of_that_exact_name_owns_the_candidate(self) -> None:
        # photo.png is its own media file, so photo.jpg must not claim staging/photo.png too.
        self.assertEqual(
            candidate_name_for("photo.jpg", {"photo.png"}, {"photo.jpg", "photo.png"}), None
        )

    def test_a_file_never_claims_its_own_suffix_by_stem(self) -> None:
        # Reaching the stem rule means staging/photo.png is not there; nothing else can match it.
        self.assertIsNone(candidate_name_for("photo.png", {"other.png"}, {"photo.png"}))

    def test_the_suffix_order_decides_when_two_could_pair(self) -> None:
        name = candidate_name_for("clip.mkv", {"clip.png", "clip.mp4"}, {"clip.mkv"})

        self.assertEqual(name, "clip.png")

    def test_an_extensionless_name_claims_nothing(self) -> None:
        self.assertIsNone(candidate_name_for("README", {"README.png"}, {"README"}))


class CandidatePathTests(unittest.TestCase):
    def test_the_filesystem_rule_matches_the_scan_rule(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            staging = folder / STAGING_DIR_NAME
            staging.mkdir()
            (folder / "clip.mov").write_bytes(b"source")
            staged = staging / "clip.mp4"
            staged.write_bytes(b"candidate")

            self.assertEqual(candidate_path_for(folder / "clip.mov"), staged)

    def test_nothing_staged_is_no_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / "clip.mov").write_bytes(b"source")

            self.assertIsNone(candidate_path_for(folder / "clip.mov"))


if __name__ == "__main__":
    unittest.main()
