"""Tests for /api/caption, /api/comfy-workflow, and /api/sysprompt."""

from __future__ import annotations

import json
import unittest
from urllib.parse import quote

from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    make_png_ztxt_bytes,
    write_issue_sidecar,
    write_json_caption,
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

    def test_returns_raw_json_content(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            caption = write_json_caption(media, {"description": "JSON body."})

            response = client.get(f"/api/caption?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json()["caption_content"], caption.read_text(encoding="utf-8-sig")
            )
            self.assertEqual(
                json.loads(response.json()["caption_content"])["description"], "JSON body."
            )

    def test_txt_caption_content_matches_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_txt_caption(media, "Plain text.")

            response = client.get(f"/api/caption?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["caption_content"], "Plain text.")

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
            self.assertEqual(payload["caption_file_type"], "txt")
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

    def test_update_json_caption_preserves_elements(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "scene.png")
            caption = write_json_caption(
                media,
                {
                    "description": "Before.",
                    "elements": [{"desc": "Lamp", "bbox": [1500, 1600, 1700, 1800]}],
                },
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "After."},
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["description"], "After.")
            self.assertEqual(data["elements"][0]["desc"], "Lamp")
            self.assertTrue(response.json()["has_bboxes"])

    def test_update_json_caption_key(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            caption = write_json_caption(media, {"caption": "Old caption."})

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "New caption."},
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["caption"], "New caption.")

    def test_update_nested_json_description(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            caption = write_json_caption(
                media,
                {
                    "compositional_deconstruction": {
                        "high_level_description": "Old text.",
                        "elements": [{"desc": "Chair", "bbox": [1500, 1600, 1700, 1800]}],
                    }
                },
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "Updated nested text."},
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            decon = data["compositional_deconstruction"]
            self.assertEqual(decon["high_level_description"], "Updated nested text.")
            self.assertEqual(decon["elements"][0]["desc"], "Chair")

    def test_adds_description_to_bbox_only_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            caption = write_json_caption(
                media,
                {"elements": [{"desc": "Tree", "bbox": [10, 20, 30, 40]}]},
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "Added description."},
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["description"], "Added description.")
            self.assertEqual(response.json()["caption_status"], "text")

    def test_update_json_caption_full_content(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            caption = write_json_caption(
                media,
                {
                    "description": "Before.",
                    "elements": [{"desc": "Lamp", "bbox": [1500, 1600, 1700, 1800]}],
                },
            )

            updated_json = json.dumps(
                {
                    "description": "After full edit.",
                    "elements": [
                        {"desc": "Chair", "bbox": [100, 200, 300, 400]},
                        {"desc": "Table", "bbox": [500, 600, 700, 800]},
                    ],
                    "custom_field": "preserved",
                },
                indent=2,
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"json_content": updated_json},
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["description"], "After full edit.")
            self.assertEqual(data["custom_field"], "preserved")
            self.assertEqual(len(data["elements"]), 2)
            self.assertEqual(data["elements"][0]["desc"], "Chair")
            payload = response.json()
            self.assertEqual(payload["description"], "After full edit.")
            self.assertTrue(payload["has_bboxes"])
            self.assertEqual(len(payload["bboxes"]), 2)

    def test_update_json_caption_rejects_invalid_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_json_caption(media, {"description": "Valid."})

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"json_content": "{not valid json"},
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn("Invalid JSON", response.json()["detail"])

    def test_update_json_caption_bboxes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, width=1000, height=800)
            caption = write_json_caption(
                media,
                {
                    "description": "Scene.",
                    "elements": [{"desc": "Sign", "bbox": [1500, 1600, 1700, 1800]}],
                },
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={
                    "text": "Scene.",
                    "bboxes": [{"x1": 200, "y1": 220, "x2": 340, "y2": 360, "label": "Sign"}],
                },
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["elements"][0]["bbox"], [275, 200, 450, 340])
            payload = response.json()
            self.assertEqual(len(payload["bboxes"]), 1)
            self.assertEqual(payload["bboxes"][0]["x1"], 200)
            self.assertEqual(payload["bboxes"][0]["y2"], 360)

    def test_update_normalized_json_caption_bboxes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, width=1000, height=800)
            caption = write_json_caption(
                media,
                {
                    "description": "Scene.",
                    "elements": [{"desc": "Tree", "bbox": [100, 200, 300, 400]}],
                },
            )

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={
                    "text": "Scene.",
                    "bboxes": [{"x1": 250, "y1": 120, "x2": 450, "y2": 320, "label": "Tree"}],
                },
            )

            self.assertEqual(response.status_code, 200)
            data = json.loads(caption.read_text(encoding="utf-8"))
            self.assertEqual(data["elements"][0]["bbox"], [150, 250, 400, 450])

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

    def test_returns_400_for_invalid_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            media.with_suffix(".json").write_text("{bad", encoding="utf-8")

            response = client.put(
                f"/api/caption?path={quote(str(media))}",
                json={"text": "Nope."},
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Caption JSON file is unreadable")


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
