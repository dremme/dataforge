import json
import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

from comfy_candidates import (
    CandidateBusyError,
    NoCandidateError,
    accept_candidate,
    candidate_difference,
    candidate_path_for,
    candidate_sidecar_path,
    describe_candidate_state,
    difference_percent,
    read_candidate_sidecar,
    reject_candidate,
    settle_slot,
    staging_dir,
    sweep_comfy_temp_files,
    write_candidate_sidecar,
)
from constants import (
    COMFY_STALE_SUFFIX,
    COMFY_TEMP_SUFFIX,
    MEDIA_EXTENSIONS,
    STAGING_DIR_NAME,
)
from edit_sidecars import backup_path_for
from schemas import ComfyCandidateSidecar


def write_image(path: Path, size: tuple[int, int], colour: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(path)
    return path


def noise_image(seed: int, size: tuple[int, int] = (128, 128)) -> Image.Image:
    """Textured pixels, because a flat colour hashes to zero whatever colour it is."""
    rng = random.Random(seed)
    image = Image.new("RGB", size)
    image.putdata(
        [
            (rng.randrange(256), rng.randrange(256), rng.randrange(256))
            for _ in range(size[0] * size[1])
        ]
    )
    return image


def sidecar(**overrides: object) -> ComfyCandidateSidecar:
    values: dict[str, object] = {
        "source_name": "photo.png",
        "preset": "upscale-2x",
        "prompt_id": "abc123",
        "seed": 7,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    values.update(overrides)
    return ComfyCandidateSidecar.model_validate(values)


class CandidateFolder:
    """A dataset folder holding one image and, optionally, a candidate for it."""

    def __init__(self, *, staged: bool = True) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.folder = Path(self._temp.name)
        self.media = write_image(self.folder / "photo.png", (32, 32), "red")

        if staged:
            self.candidate = write_image(candidate_path_for(self.media), (64, 64), "blue")
            write_candidate_sidecar(self.candidate, sidecar())
        else:
            self.candidate = candidate_path_for(self.media)

    def __enter__(self) -> "CandidateFolder":
        return self

    def __exit__(self, *_exc: object) -> None:
        self._temp.cleanup()


class CandidatePathTests(unittest.TestCase):
    def test_a_candidate_keeps_the_source_filename(self) -> None:
        media = Path("photos") / "holiday.jpg"

        self.assertEqual(
            candidate_path_for(media),
            Path("photos") / STAGING_DIR_NAME / "holiday.jpg",
        )

    def test_none_of_the_markers_end_in_a_media_suffix(self) -> None:
        # A marker whose last suffix is a media one would surface as a phantom gallery
        # item, because folder_scan classifies on the last suffix alone.
        for marker in (COMFY_TEMP_SUFFIX, COMFY_STALE_SUFFIX):
            with self.subTest(marker=marker):
                self.assertNotIn(Path(f"photo.png{marker}").suffix, MEDIA_EXTENSIONS)


class AcceptCandidateTests(unittest.TestCase):
    def test_accepting_publishes_the_candidate_over_the_original(self) -> None:
        with CandidateFolder() as fixture:
            response = accept_candidate(fixture.media)

            self.assertTrue(response.accepted)
            # The candidate's pixels are now the file's.
            with Image.open(fixture.media) as opened:
                self.assertEqual(opened.size, (64, 64))

    def test_accepting_keeps_no_copy_of_what_it_replaced(self) -> None:
        """Accepting is final. Rejecting is the way back, and it comes before the accept."""
        with CandidateFolder() as fixture:
            accept_candidate(fixture.media)

            siblings = sorted(entry.name for entry in fixture.folder.iterdir())
            self.assertEqual(siblings, ["photo.png", STAGING_DIR_NAME])

    def test_accepting_clears_the_candidate_and_its_record(self) -> None:
        with CandidateFolder() as fixture:
            accept_candidate(fixture.media)

            self.assertFalse(fixture.candidate.is_file())
            self.assertFalse(candidate_sidecar_path(fixture.candidate).is_file())

    def test_a_second_accept_publishes_over_the_first(self) -> None:
        with CandidateFolder() as fixture:
            accept_candidate(fixture.media)

            write_image(fixture.candidate, (128, 128), "green")
            write_candidate_sidecar(fixture.candidate, sidecar())
            accept_candidate(fixture.media)

            with Image.open(fixture.media) as opened:
                self.assertEqual(opened.size, (128, 128))

    def test_accepting_is_refused_while_an_editor_backup_exists(self) -> None:
        # The trap this refusal exists for: image_edit renders every crop from the .bak,
        # so an accepted candidate would be silently discarded by the next edit.
        with CandidateFolder() as fixture:
            # Contents are irrelevant: the refusal is on the backup existing at all.
            backup_path_for(fixture.media).write_bytes(b"the untouched original")

            with self.assertRaises(ValueError) as caught:
                accept_candidate(fixture.media)

            self.assertIn("image editor", str(caught.exception))
            # Nothing moved.
            self.assertTrue(fixture.candidate.is_file())
            with Image.open(fixture.media) as opened:
                self.assertEqual(opened.size, (32, 32))

    def test_accepting_without_a_candidate_is_a_missing_candidate(self) -> None:
        with CandidateFolder(staged=False) as fixture:
            with self.assertRaises(NoCandidateError):
                accept_candidate(fixture.media)

    def test_accepting_leaves_no_temp_files_behind(self) -> None:
        with CandidateFolder() as fixture:
            accept_candidate(fixture.media)

            leftovers = [
                entry.name
                for entry in fixture.folder.iterdir()
                if entry.name.endswith((COMFY_TEMP_SUFFIX, COMFY_STALE_SUFFIX))
            ]
            self.assertEqual(leftovers, [])


class RejectCandidateTests(unittest.TestCase):
    def test_rejecting_discards_the_candidate_and_leaves_the_image_alone(self) -> None:
        with CandidateFolder() as fixture:
            response = reject_candidate(fixture.media)

            self.assertFalse(response.accepted)
            self.assertFalse(fixture.candidate.is_file())
            self.assertFalse(candidate_sidecar_path(fixture.candidate).is_file())
            with Image.open(fixture.media) as opened:
                self.assertEqual(opened.size, (32, 32))

    def test_rejecting_nothing_is_a_missing_candidate(self) -> None:
        with CandidateFolder(staged=False) as fixture:
            with self.assertRaises(NoCandidateError):
                reject_candidate(fixture.media)


class SettleSlotTests(unittest.TestCase):
    def test_a_second_settle_on_the_same_file_is_refused(self) -> None:
        # An "accept all" batch and a single accept can otherwise publish over each other.
        with CandidateFolder() as fixture:
            with settle_slot(fixture.media):
                with self.assertRaises(CandidateBusyError):
                    accept_candidate(fixture.media)

    def test_the_slot_is_released_after_use(self) -> None:
        with CandidateFolder() as fixture:
            with settle_slot(fixture.media):
                pass

            accept_candidate(fixture.media)
            self.assertFalse(fixture.candidate.is_file())


class CandidateStateTests(unittest.TestCase):
    def test_state_reports_the_record_that_produced_the_candidate(self) -> None:
        with CandidateFolder() as fixture:
            state = describe_candidate_state(fixture.media)

            self.assertTrue(state.has_candidate)
            self.assertEqual(state.candidate_path, str(fixture.candidate))
            self.assertEqual(state.preset, "upscale-2x")
            self.assertEqual(state.prompt_id, "abc123")
            self.assertEqual(state.seed, 7)

    def test_state_prefers_the_score_the_job_recorded(self) -> None:
        with CandidateFolder() as fixture:
            write_candidate_sidecar(fixture.candidate, sidecar(difference_percent=41.5))

            # Not recomputed: the two fixture images are flat colours and would score 0,
            # so a returned 41.5 can only have come from the record.
            self.assertEqual(describe_candidate_state(fixture.media).difference_percent, 41.5)

    def test_state_scores_the_pair_when_the_record_has_none(self) -> None:
        # What gives candidates staged before the score existed one anyway.
        with CandidateFolder() as fixture:
            noise_image(1).save(fixture.media)
            noise_image(2).save(fixture.candidate)

            scored = describe_candidate_state(fixture.media).difference_percent

            self.assertIsNotNone(scored)
            assert scored is not None
            self.assertGreater(scored, 25.0)

    def test_state_is_empty_where_nothing_is_staged(self) -> None:
        with CandidateFolder(staged=False) as fixture:
            state = describe_candidate_state(fixture.media)

            self.assertFalse(state.has_candidate)
            self.assertIsNone(state.candidate_path)
            self.assertIsNone(state.preset)

    def test_an_unreadable_record_is_ignored_rather_than_raised(self) -> None:
        with CandidateFolder() as fixture:
            candidate_sidecar_path(fixture.candidate).write_text("{not json", encoding="utf-8")

            self.assertIsNone(read_candidate_sidecar(fixture.candidate))
            # The candidate itself is still reviewable; only its provenance is lost.
            self.assertTrue(describe_candidate_state(fixture.media).has_candidate)

    def test_the_record_round_trips(self) -> None:
        with CandidateFolder() as fixture:
            stored = read_candidate_sidecar(fixture.candidate)

            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored.source_name, "photo.png")
            self.assertEqual(
                json.loads(candidate_sidecar_path(fixture.candidate).read_text(encoding="utf-8"))[
                    "preset"
                ],
                "upscale-2x",
            )


class DifferenceScoreTests(unittest.TestCase):
    def test_an_image_against_itself_scores_zero(self) -> None:
        image = noise_image(1)

        self.assertEqual(difference_percent(image, image), 0.0)

    def test_an_upscale_of_the_same_content_barely_registers(self) -> None:
        # The whole point of the metric: a prep run that only added pixels has to score
        # near nothing, or every clean result looks as suspect as a broken one.
        original = noise_image(1)
        upscaled = original.resize((512, 512), Image.Resampling.LANCZOS)

        self.assertLess(difference_percent(original, upscaled), 5.0)

    def test_unrelated_images_score_far_higher_than_a_upscale(self) -> None:
        original = noise_image(1)

        self.assertGreater(difference_percent(original, noise_image(2)), 25.0)

    def test_scoring_two_files_reads_them_from_disk(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            noise_image(1).save(folder / "before.png")
            noise_image(2).save(folder / "after.png")

            score = candidate_difference(folder / "before.png", folder / "after.png")

            self.assertIsNotNone(score)
            assert score is not None
            self.assertGreater(score, 25.0)

    def test_a_file_that_cannot_be_read_scores_nothing_rather_than_raising(self) -> None:
        with CandidateFolder() as fixture:
            self.assertIsNone(candidate_difference(fixture.media, fixture.folder / "gone.png"))


class SweepTests(unittest.TestCase):
    def test_the_sweep_drops_leftovers_a_hard_kill_left(self) -> None:
        with CandidateFolder() as fixture:
            temp = fixture.folder / f"photo.png{COMFY_TEMP_SUFFIX}"
            stale = fixture.folder / f"photo.png{COMFY_STALE_SUFFIX}"
            temp.write_bytes(b"partial")
            stale.write_bytes(b"displaced")

            sweep_comfy_temp_files(fixture.folder)

            self.assertFalse(temp.exists())
            self.assertFalse(stale.exists())
            # The real files are untouched.
            self.assertTrue(fixture.media.is_file())

    def test_the_sweep_survives_a_folder_that_is_not_there(self) -> None:
        with CandidateFolder() as fixture:
            sweep_comfy_temp_files(staging_dir(fixture.folder) / "missing")


if __name__ == "__main__":
    unittest.main()
