from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from constants import CAPTION_BACKUP_DIR_NAME
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    make_png_bytes,
    write_gif,
    write_issue_sidecar,
    write_media,
    write_mp4_video,
    write_txt_caption,
    write_wav,
)


class ComfyWorkflowEndpointTests(unittest.TestCase):
    def test_prompt_response_exposes_full_filename_and_output_identity(self) -> None:
        graph = {
            "7": {
                "class_type": "SwiftVRRestoreVideo",
                "_meta": {"title": "Restored video"},
                "inputs": {"filename": "renders/scene.mp4"},
            }
        }
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "scene.mp4", metadata={"prompt": json.dumps(graph)})
            response = client.get(f"/api/comfy-workflow/prompts?path={quote(str(media))}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["matched_node_id"], "7")
        self.assertEqual(payload["branches"][0]["filename"], "renders/scene.mp4")
        self.assertIsNone(payload["branches"][0]["filename_prefix"])
        self.assertEqual(payload["branches"][0]["class_type"], "SwiftVRRestoreVideo")
        self.assertEqual(payload["branches"][0]["label"], "Restored video")

    def test_editor_workflow_is_trimmed_to_the_requested_output(self) -> None:
        prompt = json.dumps(
            {
                "3": {"class_type": "SaveImage", "inputs": {}},
                "4": {"class_type": "PreviewImage", "inputs": {}},
            }
        )
        workflow = json.dumps(
            {
                "version": 0.4,
                "nodes": [{"id": 3, "type": "SaveImage"}, {"id": 4, "type": "PreviewImage"}],
                "links": [],
                "extra": {"ds": {}},
            }
        )
        with TempMediaFolder() as root:
            media = write_media(
                root, "comfy.png", text_chunks={"prompt": prompt, "workflow": workflow}
            )
            path = quote(str(media))
            prompts = client.get(f"/api/comfy-workflow/prompts?path={path}")
            editor = client.get(f"/api/comfy-workflow/editor?path={path}&node_id=4")
            missing = client.get(f"/api/comfy-workflow/editor?path={path}&node_id=9")

        self.assertTrue(prompts.json()["has_editor_workflow"])
        self.assertEqual(editor.status_code, 200)
        trimmed = json.loads(editor.json()["workflow"])
        self.assertEqual([node["type"] for node in trimmed["nodes"]], ["PreviewImage"])
        self.assertEqual(trimmed["extra"], {"ds": {}})
        self.assertEqual(missing.status_code, 404)

    def test_editor_workflow_is_unwrapped_from_a_video_comment(self) -> None:
        workflow = {"version": 0.4, "nodes": [{"id": 3}], "links": [], "extra": {"ds": {}}}
        comment = json.dumps({"prompt": "{}", "workflow": workflow})
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "comfy.mp4", metadata={"comment": comment})
            path = quote(str(media))
            response = client.get(f"/api/comfy-workflow/editor?path={path}&node_id=3")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.json()["workflow"]), {**workflow, "groups": []})

    def test_a_workflow_comfyui_would_not_paste_is_not_offered(self) -> None:
        prompt = json.dumps({"3": {"class_type": "PreviewImage", "inputs": {}}})
        # No ``extra``: ComfyUI's paste handler treats this text as nothing to load.
        unpasteable = json.dumps({"version": 0.4, "nodes": [{"id": 3}]})
        with TempMediaFolder() as root:
            cases = {
                "api.png": {"prompt": prompt},
                "partial.png": {"prompt": prompt, "workflow": unpasteable},
            }
            for name, chunks in cases.items():
                media = write_media(root, name, text_chunks=chunks)
                with self.subTest(name):
                    path = quote(str(media))
                    prompts = client.get(f"/api/comfy-workflow/prompts?path={path}")
                    editor = client.get(f"/api/comfy-workflow/editor?path={path}&node_id=3")
                    self.assertFalse(prompts.json()["has_editor_workflow"])
                    self.assertEqual(editor.status_code, 404)

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
                make_png_bytes(text_chunks={"workflow": workflow}, compressed_text=True),
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


def _revision(media: Path) -> str | None:
    return client.get(f"/api/caption?path={quote(str(media))}").json()["caption_revision"]


def _save(media: Path, text: str, base: str | None, **extra: object):
    body = {"text": text, "base_revision": base, **extra}
    return client.put(f"/api/caption?path={quote(str(media))}", json=body)


class CaptionEndpointTests(unittest.TestCase):
    def test_the_caption_response_carries_the_rule_hits(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_issue_sidecar(media, rules=('Flagged "floating".',))

            response = client.get(f"/api/caption?path={quote(str(media))}")

            self.assertEqual(response.json()["rule_findings"], ['Flagged "floating".'])
            self.assertTrue(response.json()["has_issue_file"])

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

            response = _save(media, "Updated via API.", _revision(media))

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["description"], "Updated via API.")
            self.assertEqual(caption.read_text(encoding="utf-8"), "Updated via API.\n")

    def test_resolve_issue_deletes_issue_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Original.")
            issue_path = write_issue_sidecar(media, 'Replace "blue" with "red".')

            response = _save(media, "Corrected caption.", _revision(media), resolve_issue=True)

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["description"], "Corrected caption.")
            self.assertFalse(payload["has_issue_file"])
            self.assertEqual(payload["issue_fixes"], [])
            self.assertFalse(issue_path.is_file())

    def test_create_caption_for_uncaptioned_media(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "new.png")

            response = _save(media, "First caption.", None)

            self.assertEqual(response.status_code, 200)
            self.assertTrue((root / "new.txt").is_file())
            self.assertEqual(response.json()["caption_status"], "text")

    def test_audio_takes_a_caption_by_hand(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav")

            response = _save(media, "A short greeting.", None)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                (root / "voice.txt").read_text(encoding="utf-8").strip(), "A short greeting."
            )

    def test_empty_caption_clears_txt_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_txt_caption(media, "Previous text.")

            response = _save(media, "   ", _revision(media))

            self.assertEqual(response.status_code, 200)
            self.assertEqual(media.with_suffix(".txt").read_text(encoding="utf-8"), "")
            self.assertEqual(response.json()["caption_status"], "empty")

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = _save(missing, "Nope.", None)

            self.assertEqual(response.status_code, 404)

    def test_returns_400_for_unsupported_extension(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "notes.md"
            file_path.write_text("not media", encoding="utf-8")

            response = _save(file_path, "Nope.", None)

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Not a supported media file")

    def test_leftover_json_does_not_block_writing_txt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            leftover = media.with_suffix(".json")
            leftover.write_text("{bad", encoding="utf-8")

            response = _save(media, "First caption.", None)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"), "First caption.\n"
            )
            self.assertEqual(leftover.read_text(encoding="utf-8"), "{bad")


class CaptionConflictTests(unittest.TestCase):
    """The audit's F05: a save against an older read used to replace the newer caption."""

    def test_a_save_against_an_older_read_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "Original.")
            base = _revision(media)

            first = _save(media, "From the first tab.", base)
            second = _save(media, "From the second tab.", base)

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 409)
            self.assertEqual(second.json()["code"], "caption_conflict")
            self.assertEqual(caption.read_text(encoding="utf-8"), "From the first tab.\n")

    def test_an_edit_from_another_program_is_not_overwritten(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            base = _revision(media)
            caption = write_txt_caption(media, "Written by another program.")

            response = _save(media, "From the app.", base)

            self.assertEqual(response.status_code, 409)
            self.assertEqual(caption.read_text(encoding="utf-8"), "Written by another program.")

    def test_a_save_carries_the_revision_the_next_save_names(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            first = _save(media, "One.", None).json()
            second = _save(media, "Two.", first["caption_revision"])

            self.assertEqual(second.status_code, 200)
            self.assertNotEqual(second.json()["caption_revision"], first["caption_revision"])

    def test_same_stem_files_share_one_revision(self) -> None:
        with TempMediaFolder() as root:
            jpg = write_media(root, "scene.jpg")
            png = write_media(root, "scene.png")
            write_txt_caption(jpg, "Shared.")
            base = _revision(png)
            self.assertEqual(_revision(jpg), base)

            self.assertEqual(_save(jpg, "Saved through the JPG.", base).status_code, 200)

            self.assertEqual(_save(png, "Saved through the PNG.", base).status_code, 409)

    def test_the_revision_is_required(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.put(
                f"/api/caption?path={quote(str(media))}", json={"text": "No base."}
            )

            self.assertEqual(response.status_code, 422)
            self.assertFalse(media.with_suffix(".txt").exists())


class UnreadableCaptionTests(unittest.TestCase):
    """The audit's F07: an unreadable caption read as empty, and the next save replaced it."""

    def test_text_that_is_not_utf8_is_unreadable_not_empty(self) -> None:
        for name, data in (
            ("utf-16", "A caption.".encode("utf-16")),
            ("invalid utf-8", b"\xff\xfe\xfd caption"),
        ):
            with self.subTest(name), TempMediaFolder() as root:
                media = write_media(root, "sunset.png")
                media.with_suffix(".txt").write_bytes(data)

                payload = client.get(f"/api/caption?path={quote(str(media))}").json()

                self.assertEqual(payload["caption_status"], "unreadable")
                self.assertEqual(payload["caption_read_error"], "encoding")
                self.assertIsNone(payload["description"])
                self.assertIsNotNone(payload["caption_revision"])

    def test_an_autosave_that_believed_it_empty_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = media.with_suffix(".txt")
            caption.write_bytes("A caption.".encode("utf-16"))
            original = caption.read_bytes()

            response = _save(media, "Typed over it.", None)

            self.assertEqual(response.status_code, 409)
            self.assertEqual(caption.read_bytes(), original)

    def test_replacing_it_deliberately_names_its_revision(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            media.with_suffix(".txt").write_bytes("A caption.".encode("utf-16"))

            response = _save(media, "Replaced on purpose.", _revision(media))

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["caption_status"], "text")

    def test_a_caption_that_cannot_be_opened_is_unreadable_and_kept(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "Held by another program.")
            real_read_bytes = Path.read_bytes

            def locked(path: Path) -> bytes:
                if path.suffix == ".txt":
                    raise PermissionError("locked")
                return real_read_bytes(path)

            with patch.object(Path, "read_bytes", locked):
                payload = client.get(f"/api/caption?path={quote(str(media))}").json()
                response = _save(media, "Typed over it.", None)

            self.assertEqual(payload["caption_status"], "unreadable")
            self.assertEqual(payload["caption_read_error"], "access")
            self.assertIsNone(payload["caption_revision"])
            self.assertEqual(response.status_code, 423)
            self.assertEqual(caption.read_text(encoding="utf-8"), "Held by another program.")


class CaptionBackupEndpointTests(unittest.TestCase):
    def test_reports_no_backup_when_the_folder_has_none(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Current caption.")

            response = client.get(f"/api/caption/backup?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertFalse(payload["exists"])
            self.assertIsNone(payload["description"])

    def test_returns_the_backed_up_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Current caption.")
            run_backup_captions_job(root)
            write_txt_caption(media, "Edited since the backup.")

            response = client.get(f"/api/caption/backup?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertTrue(payload["exists"])
            self.assertEqual(payload["description"], "Current caption.")

    def test_ignores_a_backup_belonging_to_another_file(self) -> None:
        with TempMediaFolder() as root:
            backed_up = write_media(root, "sunset.png")
            write_txt_caption(backed_up, "Sunset caption.")
            run_backup_captions_job(root)

            other = write_media(root, "harbour.png")

            response = client.get(f"/api/caption/backup?path={quote(str(other))}")

            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["exists"])

    def test_an_empty_backup_counts_as_a_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Current caption.")
            run_backup_captions_job(root)
            (root / CAPTION_BACKUP_DIR_NAME / "sunset.txt").write_text("   ", encoding="utf-8")

            response = client.get(f"/api/caption/backup?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertTrue(payload["exists"])
            self.assertEqual(payload["description"], "")


if __name__ == "__main__":
    unittest.main()
