from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

import edit_sidecars
import image_edit
from media_claims import MediaBusyError, cancel, claim, holds_claim, is_claimed
from routes._test_client import client
from schemas import ImageEditSpec
from testing_fixtures import TempMediaFolder, claimed_elsewhere, write_image, write_media


class ClaimTests(unittest.TestCase):
    def test_a_second_claim_from_another_thread_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with claimed_elsewhere(media), self.assertRaises(MediaBusyError) as caught:
                with claim([media], "delete"):
                    pass

            self.assertIn("sunset.png is being edited", str(caught.exception))

    def test_a_claim_is_all_or_nothing(self) -> None:
        with TempMediaFolder() as root:
            free = write_media(root, "free.png")
            held = write_media(root, "held.png")

            with claimed_elsewhere(held), self.assertRaises(MediaBusyError):
                with claim([free, held], "rename"):
                    pass

            self.assertFalse(is_claimed(free))

    def test_the_same_thread_may_claim_again(self) -> None:
        """An operation may call another that claims the same file, as a job's render does."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with claim([media], "render") as outer, claim([media], "render") as inner:
                self.assertIs(inner, outer)
                self.assertTrue(holds_claim(media))

            self.assertFalse(is_claimed(media))

    def test_the_claim_is_released_even_when_the_work_raises(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with self.assertRaises(RuntimeError), claim([media], "render"):
                raise RuntimeError("bad filter")

            self.assertFalse(is_claimed(media))

    def test_a_case_variant_of_the_name_is_the_same_file_where_the_disk_says_so(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            variant = root / "SUNSET.png"
            if not variant.exists():
                self.skipTest("case-sensitive file system")

            with claimed_elsewhere(media), self.assertRaises(MediaBusyError):
                with claim([variant], "delete"):
                    pass

    def test_a_waiting_claim_gets_the_file_once_it_is_free(self) -> None:
        with TempMediaFolder() as root:
            caption = root / "sunset.txt"
            release = threading.Event()
            held = threading.Event()

            def hold() -> None:
                with claim([caption], "caption"):
                    held.set()
                    release.wait(timeout=5)

            worker = threading.Thread(target=hold)
            worker.start()
            held.wait(timeout=5)
            threading.Timer(0.05, release.set).start()

            with claim([caption], "caption", wait_s=5):
                self.assertTrue(holds_claim(caption))
            worker.join(timeout=5)

    def test_cancelling_sets_the_flag_the_work_polls(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            entered = threading.Event()
            seen: list[bool] = []

            def render() -> None:
                with claim([media], "render") as held:
                    entered.set()
                    while not held.should_cancel():
                        pass
                    seen.append(True)

            worker = threading.Thread(target=render)
            worker.start()
            entered.wait(timeout=5)

            self.assertFalse(cancel(media, "delete"))
            self.assertTrue(cancel(media, "render"))
            worker.join(timeout=5)

            self.assertEqual(seen, [True])

    def test_cancelling_an_idle_file_reports_that_there_was_nothing_to_stop(self) -> None:
        with TempMediaFolder() as root:
            self.assertFalse(cancel(write_media(root, "sunset.png"), "render"))


class DeleteDuringRenderTests(unittest.TestCase):
    """The audit's F01: a delete during a render used to report success, after which the render
    published the file back with no original to revert to."""

    def test_a_render_in_flight_refuses_the_delete_and_keeps_every_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            publishing = threading.Event()
            proceed = threading.Event()
            real_publish = edit_sidecars.publish_with_spec

            def paused_publish(temp: Path, target: Path, spec: ImageEditSpec) -> None:
                publishing.set()
                proceed.wait(timeout=5)
                real_publish(temp, target, spec)

            results: list[object] = []

            def render() -> None:
                results.append(image_edit.apply_image_edit(media, ImageEditSpec(rotate=90)))

            with patch("image_edit.publish_with_spec", paused_publish):
                worker = threading.Thread(target=render)
                worker.start()
                self.assertTrue(publishing.wait(timeout=5))

                response = client.delete(f"/api/media?path={quote(str(media))}")

                proceed.set()
                worker.join(timeout=10)

            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["code"], "media_busy")
            self.assertEqual(len(results), 1)
            self.assertTrue(media.is_file())
            self.assertTrue(edit_sidecars.backup_path_for(media).is_file())
            self.assertTrue(edit_sidecars.edit_spec_path(media).is_file())

    def test_a_delete_in_flight_refuses_the_render(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            with claimed_elsewhere(media, activity="delete"):
                response = client.post(
                    f"/api/media/image-edit?path={quote(str(media))}", json={"rotate": 90}
                )

            self.assertEqual(response.status_code, 409)
            self.assertIn("being deleted", response.json()["detail"])
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())


class OtherWritersRefuseARenderTests(unittest.TestCase):
    def test_a_rename_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            with claimed_elsewhere(media):
                response = client.post(f"/api/media/rename?path={quote(str(media))}&name=renamed")

            self.assertEqual(response.status_code, 409)
            self.assertTrue(media.is_file())

    def test_a_move_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            destination = root / "elsewhere"
            destination.mkdir()

            with claimed_elsewhere(media):
                response = client.post(
                    f"/api/media/move?destination={quote(str(destination))}",
                    json={"paths": [str(media)]},
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["failed"]), 1)
            self.assertTrue(media.is_file())

    def test_an_import_over_it_is_skipped(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            before = media.read_bytes()

            with claimed_elsewhere(media):
                response = client.post(
                    f"/api/files/import?path={quote(str(root))}&overwrite=true",
                    files=[("files", ("photo.png", b"replacement", "image/png"))],
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["skipped"], ["photo.png"])
            self.assertEqual(media.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
