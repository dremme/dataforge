"""Tests for /api/duplicates."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.parse import quote

from duplicates import DuplicateFinding, duplicate_file_path, save_duplicate_finding
from media_delete import deletes_to_trash
from routes._test_client import client
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption

FINDING = DuplicateFinding(group="abc123", max_distance=0, threshold="exact")


def list_duplicates(folder) -> dict:
    response = client.get(f"/api/duplicates?folder={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


class ListDuplicatesTests(unittest.TestCase):
    def test_reports_a_group_with_its_members(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)

            payload = list_duplicates(root)

            self.assertEqual(len(payload["groups"]), 1)
            group = payload["groups"][0]
            self.assertEqual(group["group"], "abc123")
            self.assertEqual(group["max_distance"], 0)
            self.assertEqual(group["threshold"], "exact")
            self.assertEqual(
                [member["name"] for member in group["members"]], ["one.png", "two.png"]
            )

    def test_members_carry_the_metadata_the_resolver_compares_on(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            write_txt_caption(first, "A red car.")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)

            member = list_duplicates(root)["groups"][0]["members"][0]

            self.assertEqual(member["description"], "A red car.")
            self.assertTrue(member["has_duplicate_file"])
            self.assertEqual(member["duplicate_group"], "abc123")
            for field in ("width", "height", "size", "modified_at"):
                self.assertIn(field, member)

    def test_an_empty_folder_reports_no_groups(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "one.png")

            payload = list_duplicates(root)

            self.assertEqual(payload["groups"], [])
            self.assertEqual(payload["stale"], [])

    def test_a_lone_member_is_reported_as_stale_rather_than_a_group(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            save_duplicate_finding(first, FINDING)

            payload = list_duplicates(root)

            self.assertEqual(payload["groups"], [])
            self.assertEqual(payload["stale"], ["one.png"])

    def test_larger_groups_come_first(self) -> None:
        with TempMediaFolder() as root:
            pair = DuplicateFinding(group="pair", max_distance=0, threshold="exact")
            trio = DuplicateFinding(group="trio", max_distance=2, threshold="near")
            for name in ("a.png", "b.png"):
                save_duplicate_finding(write_media(root, name), pair)
            for name in ("c.png", "d.png", "e.png"):
                save_duplicate_finding(write_media(root, name), trio)

            payload = list_duplicates(root)

            self.assertEqual([group["group"] for group in payload["groups"]], ["trio", "pair"])

    def test_a_missing_folder_is_a_404(self) -> None:
        response = client.get("/api/duplicates?folder=/definitely/not/here")

        self.assertEqual(response.status_code, 404)

    def test_reports_whether_a_delete_can_be_undone(self) -> None:
        """The resolver only asks for confirmation where deleting is final."""
        with TempMediaFolder() as root:
            write_media(root, "one.png")

            for recoverable in (True, False):
                with patch("routes.duplicates.deletes_to_trash", return_value=recoverable):
                    self.assertIs(list_duplicates(root)["deletes_to_trash"], recoverable)

    def test_the_capability_follows_the_delete_implementation(self) -> None:
        """Named for the behaviour, so a future trash backend flips it on its own."""
        with patch("media_delete.sys.platform", "win32"):
            self.assertTrue(deletes_to_trash())

        with patch("media_delete.sys.platform", "linux"):
            self.assertFalse(deletes_to_trash())


class ResolveDuplicateTests(unittest.TestCase):
    def test_deletes_the_discards_and_clears_the_keeper(self) -> None:
        with TempMediaFolder() as root:
            keep = write_media(root, "keep.png")
            drop = write_media(root, "drop.png")
            save_duplicate_finding(keep, FINDING)
            save_duplicate_finding(drop, FINDING)

            response = client.post(
                "/api/duplicates/resolve",
                json={"keep": str(keep), "discard": [str(drop)]},
            )

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["deleted"], ["drop.png"])
            self.assertEqual(response.json()["failed"], [])
            self.assertTrue(keep.is_file())
            self.assertFalse(drop.is_file())
            # The group is settled, so the survivor stops advertising it.
            self.assertFalse(duplicate_file_path(keep).exists())

    def test_deletes_the_discards_sidecars_too(self) -> None:
        with TempMediaFolder() as root:
            keep = write_media(root, "keep.png")
            drop = write_media(root, "drop.png")
            write_txt_caption(drop, "A red car.")
            save_duplicate_finding(keep, FINDING)
            save_duplicate_finding(drop, FINDING)

            client.post(
                "/api/duplicates/resolve",
                json={"keep": str(keep), "discard": [str(drop)]},
            )

            self.assertFalse(drop.with_suffix(".txt").exists())
            self.assertFalse(duplicate_file_path(drop).exists())

    def test_refuses_to_delete_the_file_it_is_keeping(self) -> None:
        with TempMediaFolder() as root:
            keep = write_media(root, "keep.png")
            save_duplicate_finding(keep, FINDING)

            response = client.post(
                "/api/duplicates/resolve",
                json={"keep": str(keep), "discard": [str(keep)]},
            )

            self.assertEqual(response.status_code, 400)
            self.assertTrue(keep.is_file())

    def test_refuses_an_empty_discard_list(self) -> None:
        with TempMediaFolder() as root:
            keep = write_media(root, "keep.png")

            response = client.post(
                "/api/duplicates/resolve",
                json={"keep": str(keep), "discard": []},
            )

            self.assertEqual(response.status_code, 400)

    def test_a_missing_file_is_a_404(self) -> None:
        with TempMediaFolder() as root:
            keep = write_media(root, "keep.png")

            response = client.post(
                "/api/duplicates/resolve",
                json={"keep": str(keep), "discard": [str(root / "gone.png")]},
            )

            self.assertEqual(response.status_code, 404)
            self.assertTrue(keep.is_file())


if __name__ == "__main__":
    unittest.main()
