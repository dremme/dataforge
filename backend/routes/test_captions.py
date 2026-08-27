from __future__ import annotations

import json
import unittest
from urllib.parse import quote

from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    make_png_ztxt_bytes,
    write_gif,
    write_issue_sidecar,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


class ComfyWorkflowEndpointTests(unittest.TestCase):
    def test_detects_comfy_workflow_metadata_in_png(self) -> None:
        with TempMediaFolder() as root:
            workflow = json.dumps({"nodes": [], "links": [], "last_node_id": 0})
            media = write_media(root, "comfy.png", text_chunks={"workflow": workflow})

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_detects_comfy_prompt_metadata_in_png(self) -> None:
        with TempMediaFolder() as root:
            prompt = json.dumps({"3": {"class_type": "KSampler", "inputs": {}}})
            media = write_media(root, "comfy.png", text_chunks={"prompt": prompt})

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_detects_ztxt_workflow_metadata_in_png(self) -> None:
        with TempMediaFolder() as root:
            workflow = json.dumps({"nodes": [], "links": []})
            media = root / "comfy.png"
            media.write_bytes(
                make_png_ztxt_bytes(text_chunks={"workflow": workflow}),
            )

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_detects_comfy_workflow_metadata_in_mp4(self) -> None:
        with TempMediaFolder() as root:
            workflow = json.dumps({"nodes": [], "links": [], "last_node_id": 0})
            media = write_mp4_video(root, "comfy.mp4", metadata={"workflow": workflow})

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_detects_comfy_prompt_metadata_in_mp4_comment(self) -> None:
        with TempMediaFolder() as root:
            prompt = json.dumps({"3": {"class_type": "KSampler", "inputs": {}}})
            media = write_mp4_video(root, "comfy.mp4", metadata={"comment": prompt})

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_detects_comfy_metadata_in_mp4_classic_comment_tag(self) -> None:
        with TempMediaFolder() as root:
            prompt = json.dumps({"3": {"class_type": "KSampler", "inputs": {}}})
            workflow = json.dumps({"nodes": [], "links": []})
            comment = json.dumps({"prompt": prompt, "workflow": workflow})
            media = write_mp4_video(
                root,
                "comfy.mp4",
                metadata={"\xa9cmt": comment},
                metadata_format="classic",
            )

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])

    def test_returns_false_for_plain_png(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "plain.png")

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["has_workflow"])

    def test_returns_false_for_plain_mp4(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "plain.mp4")

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["has_workflow"])

    def test_detects_comfy_workflow_metadata_in_the_rest_of_the_mp4_family(self) -> None:
        workflow = '{"nodes": [{"type": "KSampler"}]}'
        for name in ("comfy.mov", "comfy.m4v"):
            with self.subTest(name=name), TempMediaFolder() as root:
                media = write_mp4_video(root, name, metadata={"workflow": workflow})

                response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["has_workflow"])

    def test_returns_400_for_a_container_without_isobmff_boxes(self) -> None:
        # Matroska, avi, asf and flv carry metadata the box walk cannot reach.
        workflow = '{"nodes": [{"type": "KSampler"}]}'
        for name in ("comfy.mkv", "comfy.avi", "comfy.wmv", "comfy.flv"):
            with self.subTest(name=name), TempMediaFolder() as root:
                media = write_mp4_video(root, name, metadata={"workflow": workflow})

                response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

                self.assertEqual(response.status_code, 400)

    def test_returns_400_for_gif(self) -> None:
        # A GIF carries neither PNG text chunks nor ISOBMFF boxes.
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 400)

    def test_returns_400_for_unsupported_extension(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.jpg"
            media.write_bytes(b"\xff\xd8\xff")

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 400)

    def test_reports_workflow_metadata_through_cache(self) -> None:
        with TempMediaFolder() as root:
            workflow = '{"nodes": [], "last_node_id": 1}'
            media = write_media(root, "comfy.png", text_chunks={"workflow": workflow})

            response = client.get(f"/api/comfy-workflow?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["has_workflow"])


class CaptionEndpointTests(unittest.TestCase):
    def test_read_caption_reflects_sidecar_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Cached caption.")

            first = client.get(f"/api/caption?path={quote(str(media))}")
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["description"], "Cached caption.")

            write_txt_caption(media, "Updated outside the app.")

            second = client.get(f"/api/caption?path={quote(str(media))}")
            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json()["description"], "Updated outside the app.")

    def test_update_txt_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "Original.")

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "Updated via API."},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["description"], "Updated via API.")
            self.assertEqual(caption.read_text(encoding="utf-8"), "Updated via API.\n")

    def test_resolve_issue_deletes_issue_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Original.")
            issue_path = write_issue_sidecar(media, 'Replace "blue" with "red".')

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "Corrected caption.", "resolve_issue": True},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["description"], "Corrected caption.")
            self.assertFalse(payload["has_issue_file"])
            self.assertEqual(payload["issue_fixes"], [])
            self.assertFalse(issue_path.is_file())

    def test_create_caption_for_uncaptioned_media(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "new.png")

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "First caption."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertTrue((root / "new.txt").is_file())
            self.assertEqual(response.json()["caption_status"], "text")

    def test_empty_caption_clears_txt_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_txt_caption(media, "Previous text.")

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "   "},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(media.with_suffix(".txt").read_text(encoding="utf-8"), "")
            self.assertEqual(response.json()["caption_status"], "empty")

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.put(
                f"/api/caption?path={quote(str(missing))}",
                json={"text": "Nope."},
            )

            self.assertEqual(response.status_code, 404)

    def test_returns_400_for_unsupported_extension(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "notes.md"
            file_path.write_text("not media", encoding="utf-8")

            response = client.put(
                f"/api/caption?path={quote(str(file_path))}",
                json={"text": "Nope."},
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Not a supported media file")

    def test_leftover_json_does_not_block_writing_txt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            leftover = media.with_suffix(".json")
            leftover.write_text("{bad", encoding="utf-8")

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "First caption."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"), "First caption.\n"
            )
            self.assertEqual(leftover.read_text(encoding="utf-8"), "{bad")


class SysPromptEndpointTests(unittest.TestCase):
    def test_update_sysprompt_by_file_path(self) -> None:
        with TempMediaFolder() as root:
            sysprompt = write_sysprompt(root, "Original prompt.")

            response = client.put(
                f"/api/sysprompt?path={quote(str(sysprompt))}",
                json={"text": "Updated prompt."},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["description"], "Updated prompt.")
            self.assertEqual(payload["caption_status"], "text")
            self.assertEqual(sysprompt.read_text(encoding="utf-8"), "Updated prompt.\n")

    def test_create_sysprompt_by_folder_path(self) -> None:
        with TempMediaFolder() as root:
            response = client.put(
                f"/api/sysprompt?path={quote(str(root))}",
                json={"text": "Brand new prompt."},
            )

            self.assertEqual(response.status_code, 200)
            sysprompt = root / ".sysprompt"
            self.assertTrue(sysprompt.is_file())
            self.assertEqual(sysprompt.read_text(encoding="utf-8"), "Brand new prompt.\n")
            self.assertEqual(response.json()["caption_status"], "text")

    def test_empty_sysprompt_clears_file(self) -> None:
        with TempMediaFolder() as root:
            sysprompt = write_sysprompt(root, "Previous prompt.")

            response = client.put(
                f"/api/sysprompt?path={quote(str(root))}",
                json={"text": "   "},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(sysprompt.read_text(encoding="utf-8"), "")
            self.assertEqual(response.json()["caption_status"], "empty")

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.put(
                f"/api/sysprompt?path={quote(str(missing))}",
                json={"text": "Nope."},
            )

            self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
