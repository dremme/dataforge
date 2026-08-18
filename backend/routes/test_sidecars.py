"""Tests for /api/sidecars/delete."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from captions import issue_file_path
from duplicates import DuplicateFinding, duplicate_file_path, save_duplicate_finding
from media_delete import delete_path
from routes._test_client import client
from testing_fixtures import TempMediaFolder, write_issue_sidecar, write_json_caption, write_media

FINDING = DuplicateFinding(group="abc123", max_distance=0, threshold="exact")


def delete_sidecars(folder: Path, kind: str) -> dict:
    response = client.post("/api/sidecars/delete", json={"folder": str(folder), "kind": kind})
    assert response.status_code == 200, response.text
    return response.json()


class DeleteSidecarsTests(unittest.TestCase):
    def test_deletes_every_sidecar_of_its_kind(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            write_issue_sidecar(first, 'Replace "a lake" with "a harbour".')
            write_issue_sidecar(second, 'Remove "dusk".')

            payload = delete_sidecars(root, "issue")

            self.assertCountEqual(payload["deleted"], ["one.issue.json", "two.issue.json"])
            self.assertEqual(payload["failed"], [])
            self.assertEqual(payload["kind"], "issue")
            self.assertEqual(payload["folder"], str(root.resolve()))
            self.assertTrue(first.is_file())
            self.assertTrue(second.is_file())
            self.assertFalse(issue_file_path(first).exists())
            self.assertFalse(issue_file_path(second).exists())

    def test_leaves_the_other_kind_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            write_issue_sidecar(media, 'Replace "a lake" with "a harbour".')
            save_duplicate_finding(media, FINDING)

            payload = delete_sidecars(root, "issue")

            self.assertEqual(payload["deleted"], ["one.issue.json"])
            self.assertFalse(issue_file_path(media).exists())
            self.assertTrue(duplicate_file_path(media).is_file())
            self.assertTrue(media.is_file())

    def test_deletes_every_duplicate_finding(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)
            write_issue_sidecar(first, 'Remove "dusk".')

            payload = delete_sidecars(root, "duplicate")

            self.assertCountEqual(payload["deleted"], ["one.duplicate.json", "two.duplicate.json"])
            self.assertFalse(duplicate_file_path(first).exists())
            self.assertFalse(duplicate_file_path(second).exists())
            # The media a finding pointed at, and the other kind of sidecar, both stay.
            self.assertTrue(first.is_file())
            self.assertTrue(second.is_file())
            self.assertTrue(issue_file_path(first).is_file())

    def test_sweeps_an_orphan_whose_media_is_gone(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "gone.png")
            write_issue_sidecar(media, 'Replace "a lake" with "a harbour".')
            media.unlink()

            payload = delete_sidecars(root, "issue")

            self.assertEqual(payload["deleted"], ["gone.issue.json"])
            self.assertFalse((root / "gone.issue.json").exists())

    def test_keeps_a_caption_that_only_looks_like_a_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.issue.png")
            caption = write_json_caption(media, {"description": "A sunset over the lake."})

            payload = delete_sidecars(root, "issue")

            self.assertEqual(payload["deleted"], [])
            self.assertTrue(caption.is_file())
            self.assertTrue(media.is_file())

    def test_does_not_reach_into_subfolders(self) -> None:
        with TempMediaFolder() as root:
            child = root / "nested"
            child.mkdir()
            top = write_media(root, "top.png")
            nested = write_media(child, "nested.png")
            write_issue_sidecar(top, 'Replace "a lake" with "a harbour".')
            write_issue_sidecar(nested, 'Remove "dusk".')

            payload = delete_sidecars(root, "issue")

            self.assertEqual(payload["deleted"], ["top.issue.json"])
            self.assertTrue(issue_file_path(nested).is_file())
            self.assertTrue(nested.is_file())

    def test_a_clean_folder_reports_nothing_deleted(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "one.png")

            payload = delete_sidecars(root, "duplicate")

            self.assertEqual(payload["deleted"], [])
            self.assertEqual(payload["failed"], [])
            self.assertEqual(payload["kind"], "duplicate")

    def test_a_missing_folder_is_a_404(self) -> None:
        response = client.post(
            "/api/sidecars/delete",
            json={"folder": "/definitely/not/here", "kind": "issue"},
        )

        self.assertEqual(response.status_code, 404)

    def test_unknown_kind_is_a_422(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                "/api/sidecars/delete",
                json={"folder": str(root), "kind": "caption"},
            )

            self.assertEqual(response.status_code, 422)

    def test_reports_whether_a_delete_can_be_undone(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "one.png")

            for recoverable in (True, False):
                with patch("routes.sidecars.deletes_to_trash", return_value=recoverable):
                    self.assertIs(delete_sidecars(root, "issue")["deletes_to_trash"], recoverable)

    def test_a_locked_file_is_reported_rather_than_aborting(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            write_issue_sidecar(first, 'Replace "a lake" with "a harbour".')
            write_issue_sidecar(second, 'Remove "dusk".')
            locked = issue_file_path(first)

            def delete_or_lock(path: Path) -> None:
                if path.name == locked.name:
                    raise OSError("in use")
                delete_path(path)

            with patch("routes.sidecars.delete_path", side_effect=delete_or_lock):
                payload = delete_sidecars(root, "issue")

            self.assertCountEqual(payload["deleted"], ["two.issue.json"])
            self.assertEqual(payload["failed"], ["one.issue.json"])
            self.assertTrue(locked.is_file())
            self.assertFalse(issue_file_path(second).exists())

    def test_ignores_a_sidecar_named_in_the_wrong_case(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "one.png")
            odd = root / "one.Issue.JSON"
            odd.write_text("{}", encoding="utf-8")

            payload = delete_sidecars(root, "issue")

            # The listing does not read this as a sidecar either, so it was never in
            # the count the confirmation showed.
            self.assertEqual(payload["deleted"], [])
            self.assertTrue(odd.is_file())

    def test_reports_deleted_names_in_a_stable_order(self) -> None:
        with TempMediaFolder() as root:
            for name in ("beta.png", "Alpha.png", "gamma.png"):
                write_issue_sidecar(write_media(root, name), 'Remove "dusk".')

            payload = delete_sidecars(root, "issue")

            self.assertEqual(
                payload["deleted"],
                ["Alpha.issue.json", "beta.issue.json", "gamma.issue.json"],
            )


if __name__ == "__main__":
    unittest.main()
