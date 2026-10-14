from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import (
    TempMediaFolder,
    forget_preferences,
    forget_saved_settings,
    isolate_test_database,
    write_media,
    write_wav,
)

isolate_test_database()

from app_settings import update_app_settings
from db import get_connection
from folder_favorites import FOLDER_FAVORITES_KEY, add_folder_favorite
from folder_fingerprint import compute_folder_fingerprint
from folder_scan import scan_folder
from media_listing import list_media_from_scan
from media_tags import (
    folder_tag_rows,
    listed_tags,
    save_media_tags,
)
from schemas import AppSettingsUpdate
from tag_vocabulary import DEFAULT_TAG_TERMS
from tagger import fold_detections, load_vocabulary, vocabulary_id
from tagging_worker import (
    FAILURE_BACKOFF_SECONDS,
    IDLE_SECONDS,
    UNAVAILABLE_RECHECK_SECONDS,
    TaggingWorker,
)

TERMS = ["dog", "cat", "beach"]


def _clear_tags() -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM media_tags")
        conn.commit()


class FakeTagModel:
    """Sees every frame as a dog on a beach; counts the files it was shown."""

    def __init__(self, terms: list[str], model_name: str) -> None:
        self.vocabulary = vocabulary_id(terms, model_name)
        self.tagged = 0
        self.closed = False

    def tag_frames(self, frames: list) -> list[tuple[str, float]]:
        if not frames:
            return []
        self.tagged += 1
        return [("dog", 0.9), ("beach", 0.15)]

    def close(self) -> None:
        self.closed = True


class TaggingTestCase(unittest.TestCase):
    def setUp(self) -> None:
        _clear_tags()
        forget_preferences(FOLDER_FAVORITES_KEY)
        forget_saved_settings()
        self.addCleanup(_clear_tags)
        self.addCleanup(forget_preferences, FOLDER_FAVORITES_KEY)
        self.addCleanup(forget_saved_settings)

        temp = TempMediaFolder()
        self.root = temp.__enter__().resolve()
        self.addCleanup(temp.__exit__)

        self.models: list[FakeTagModel] = []
        self.terms = list(TERMS)

    def make_worker(self) -> TaggingWorker:
        def factory(terms: list[str], model_name: str) -> FakeTagModel:
            model = FakeTagModel(terms, model_name)
            self.models.append(model)
            return model

        return TaggingWorker(
            model_factory=factory,
            vocabulary_loader=lambda: self.terms,
            requirements_check=lambda: True,
            model_selector=lambda: "test-worldv2.pt",
        )

    def run_until_idle(self, worker: TaggingWorker) -> None:
        for _ in range(10):
            if worker.step() == IDLE_SECONDS:
                return
        self.fail("The worker never ran out of work")

    def tagged(self) -> int:
        """Files tagged across every model loaded; one is loaded again after each idle pass."""
        return sum(model.tagged for model in self.models)

    def listed(self, folder: Path) -> dict[str, list[dict]]:
        scan = scan_folder(folder)
        assert scan is not None
        return {item["name"]: item["tags"] for item in list_media_from_scan(scan)}


class TaggingWorkerTests(TaggingTestCase):
    def test_tags_the_files_of_a_favorite_but_not_its_subfolders(self) -> None:
        write_media(self.root, "top.png")
        nested = self.root / "nested"
        nested.mkdir()
        write_media(nested, "inner.png")
        add_folder_favorite(str(self.root))

        self.run_until_idle(self.make_worker())

        self.assertEqual(self.listed(self.root)["top.png"], [{"label": "dog", "confidence": 0.9}])
        self.assertEqual(self.listed(nested)["inner.png"], [])

    def test_the_model_is_freed_once_the_favorites_are_done(self) -> None:
        write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()

        self.assertEqual(worker.step(), 0.0)
        self.assertFalse(self.models[0].closed)
        self.assertEqual(worker.step(), IDLE_SECONDS)
        self.assertTrue(self.models[0].closed)

        write_media(self.root, "later.png")
        self.run_until_idle(worker)
        self.assertEqual(len(self.models), 2)
        self.assertEqual(self.models[1].tagged, 1)

    def test_folders_that_are_not_favorites_stay_untagged(self) -> None:
        write_media(self.root, "photo.png")

        worker = self.make_worker()

        self.assertEqual(worker.step(), IDLE_SECONDS)
        self.assertEqual(self.models, [])
        self.assertEqual(self.listed(self.root)["photo.png"], [])

    def test_audio_is_skipped(self) -> None:
        write_wav(self.root, "tone.wav")
        add_folder_favorite(str(self.root))

        self.assertEqual(self.make_worker().step(), IDLE_SECONDS)
        self.assertEqual(folder_tag_rows(self.root), {})

    def test_a_tagged_file_is_not_tagged_again_until_it_changes(self) -> None:
        photo = write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()
        self.run_until_idle(worker)
        self.assertEqual(self.tagged(), 1)

        self.assertEqual(worker.step(), IDLE_SECONDS)
        self.assertEqual(self.tagged(), 1)

        write_media(self.root, "photo.png", width=80)
        stat = photo.stat()
        os.utime(photo, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
        self.run_until_idle(worker)
        self.assertEqual(self.tagged(), 2)

    def test_an_edited_file_hides_its_old_tags_until_it_is_tagged_again(self) -> None:
        photo = write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        self.run_until_idle(self.make_worker())

        write_media(self.root, "photo.png", width=80)
        stat = photo.stat()
        os.utime(photo, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))

        self.assertEqual(self.listed(self.root)["photo.png"], [])

    def test_a_new_vocabulary_reloads_the_model_and_tags_everything_again(self) -> None:
        write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()
        self.run_until_idle(worker)

        self.terms = [*TERMS, "horse"]
        self.run_until_idle(worker)

        self.assertEqual(len(self.models), 2)
        self.assertTrue(self.models[0].closed)
        self.assertEqual(self.models[1].tagged, 1)

    def test_tags_of_files_that_left_the_folder_are_forgotten(self) -> None:
        photo = write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()
        self.run_until_idle(worker)

        photo.unlink()
        worker.step()

        self.assertEqual(folder_tag_rows(self.root), {})

    def test_an_unreadable_file_is_stored_empty_and_not_retried(self) -> None:
        (self.root / "broken.png").write_bytes(b"not an image")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()

        self.run_until_idle(worker)

        self.assertEqual(self.models[0].tagged, 0)
        self.assertIn("broken.png", folder_tag_rows(self.root))
        self.assertEqual(worker.step(), IDLE_SECONDS)

    def test_pushes_the_folder_being_tagged_and_then_idle_but_not_every_file(self) -> None:
        for index in range(3):
            write_media(self.root, f"photo-{index}.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()

        with patch("tagging_worker.events.publish") as publish:
            self.run_until_idle(worker)

        pushed = [
            (call.args[0]["status"]["state"], call.args[0]["status"]["folder"])
            for call in publish.call_args_list
        ]
        self.assertEqual(
            pushed,
            [("loading", str(self.root)), ("tagging", str(self.root)), ("idle", None)],
        )
        self.assertEqual(publish.call_args_list[0].args[0]["type"], "tagging")

    def test_reports_unavailable_without_the_optional_requirements(self) -> None:
        worker = TaggingWorker(requirements_check=lambda: False)

        self.assertEqual(worker.step(), UNAVAILABLE_RECHECK_SECONDS)
        status = worker.status()
        self.assertEqual(status.state, "unavailable")
        self.assertIn("Run setup again", status.detail)

    def test_a_model_that_will_not_load_backs_off_and_says_why(self) -> None:
        write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))

        def refuse(_terms: list[str], _model_name: str) -> FakeTagModel:
            raise RuntimeError("weights missing")

        worker = TaggingWorker(
            model_factory=refuse,
            vocabulary_loader=lambda: self.terms,
            requirements_check=lambda: True,
            model_selector=lambda: "test-worldv2.pt",
        )

        with self.assertLogs("tagging_worker", level="ERROR"):
            self.assertEqual(worker.step(), FAILURE_BACKOFF_SECONDS)
        status = worker.status()
        self.assertEqual(status.state, "failed")
        self.assertIn("weights missing", status.detail)

    def test_a_model_that_keeps_failing_stops_and_tags_nothing_more(self) -> None:
        for index in range(5):
            write_media(self.root, f"photo-{index}.png")
        add_folder_favorite(str(self.root))
        worker = self.make_worker()

        def explode(_frames: list) -> list[tuple[str, float]]:
            raise RuntimeError("out of memory")

        with patch.object(FakeTagModel, "tag_frames", side_effect=explode):
            with self.assertLogs("tagging_worker", level="WARNING"):
                self.assertEqual(worker.step(), FAILURE_BACKOFF_SECONDS)

        self.assertEqual(worker.status().state, "failed")
        self.assertTrue(self.models[0].closed)
        # Only the files before the model was given up on are stored, empty.
        self.assertEqual(len(folder_tag_rows(self.root)), 2)


class TagListingTests(TaggingTestCase):
    def test_the_confidence_setting_filters_listed_tags(self) -> None:
        write_media(self.root, "photo.png")
        add_folder_favorite(str(self.root))
        self.run_until_idle(self.make_worker())

        update_app_settings(AppSettingsUpdate(tag_min_confidence=0.1))

        self.assertEqual(
            [tag["label"] for tag in self.listed(self.root)["photo.png"]], ["dog", "beach"]
        )

    def test_the_confidence_setting_moves_the_fingerprint(self) -> None:
        write_media(self.root, "photo.png")
        before = compute_folder_fingerprint(self.root)

        update_app_settings(AppSettingsUpdate(tag_min_confidence=0.5))

        self.assertNotEqual(compute_folder_fingerprint(self.root), before)

    def test_saving_tags_moves_the_fingerprint(self) -> None:
        photo = write_media(self.root, "photo.png")
        before = compute_folder_fingerprint(self.root)
        stat = photo.stat()

        save_media_tags(
            self.root,
            "photo.png",
            mtime_ns=stat.st_mtime_ns,
            size=stat.st_size,
            vocabulary="v",
            tags=[("dog", 0.8)],
        )

        self.assertNotEqual(compute_folder_fingerprint(self.root), before)

    def test_listed_tags_need_the_same_file(self) -> None:
        photo = write_media(self.root, "photo.png")
        stat = photo.stat()
        save_media_tags(
            self.root,
            "photo.png",
            mtime_ns=stat.st_mtime_ns,
            size=stat.st_size,
            vocabulary="v",
            tags=[("dog", 0.8), ("cat", 0.3)],
        )
        row = folder_tag_rows(self.root)["photo.png"]

        self.assertEqual(
            listed_tags(row, stat.st_mtime_ns, stat.st_size, 0.5),
            [{"label": "dog", "confidence": 0.8}],
        )
        self.assertEqual(listed_tags(row, stat.st_mtime_ns, stat.st_size + 1, 0.1), [])
        self.assertEqual(listed_tags(None, stat.st_mtime_ns, stat.st_size, 0.1), [])


class TaggerTests(unittest.TestCase):
    def test_fold_keeps_each_term_once_at_its_best_score_strongest_first(self) -> None:
        folded = fold_detections(
            [("dog", 0.4), ("cat", 0.7), ("dog", 0.8), ("tree", 0.05), ("cat", 0.2)]
        )

        self.assertEqual(folded, [("dog", 0.8), ("cat", 0.7)])

    def test_the_personal_list_extends_the_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            personal = Path(temp) / "tag_vocabulary.txt"
            personal.write_text(
                "# mine\nCat\n\n  red   dress  # inline\nred dress\n", encoding="utf-8"
            )

            self.assertEqual(load_vocabulary(("dog", "cat"), personal), ["dog", "cat", "red dress"])

    def test_a_missing_personal_list_adds_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            absent = Path(temp) / "tag_vocabulary.txt"

            self.assertEqual(load_vocabulary(("dog",), absent), ["dog"])

    def test_the_default_terms_are_clean_and_unique(self) -> None:
        self.assertGreater(len(DEFAULT_TAG_TERMS), 100)
        self.assertEqual(len(DEFAULT_TAG_TERMS), len(set(DEFAULT_TAG_TERMS)))
        for term in DEFAULT_TAG_TERMS:
            self.assertEqual(term, " ".join(term.split()).lower())

    def test_vocabulary_id_follows_the_terms_and_the_model(self) -> None:
        self.assertEqual(vocabulary_id(["dog"], "a.pt"), vocabulary_id(["dog"], "a.pt"))
        self.assertNotEqual(vocabulary_id(["dog"], "a.pt"), vocabulary_id(["dog", "cat"], "a.pt"))
        self.assertNotEqual(vocabulary_id(["dog"], "a.pt"), vocabulary_id(["dog"], "b.pt"))


if __name__ == "__main__":
    unittest.main()
