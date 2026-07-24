"""Unit tests for body-parts detection and sidecar writing."""

from __future__ import annotations

import json
import unittest.mock

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from automation.body_parts import (
    BODY_PARTS_MODEL_SPECS,
    BodyPartsModels,
    _require_gpu,
    build_body_part_elements,
    ensure_body_parts_models,
    list_body_parts_images,
    run_body_parts_job,
    validate_body_parts_folder,
    write_body_parts_sidecar,
)
from testing_fixtures import TempMediaFolder, write_media


class BodyPartsFolderValidationTests(unittest.TestCase):
    def test_lists_only_supported_images(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_media(root, "clip.mp4")

            names = [path.name for path in list_body_parts_images(root)]

            self.assertEqual(names, ["photo.png"])

    def test_validate_requires_supported_images(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images"):
                validate_body_parts_folder(root)


class BodyPartsModelDownloadTests(unittest.TestCase):
    def test_model_specs_use_upstream_sources(self) -> None:
        filenames = {spec.filename for spec in BODY_PARTS_MODEL_SPECS}
        self.assertEqual(filenames, {"yolo26x.pt", "yolov8n-face.pt", "sam3.1.pt"})

        by_name = {spec.filename: spec for spec in BODY_PARTS_MODEL_SPECS}
        self.assertIn("ultralytics/assets", by_name["yolo26x.pt"].source.lower())
        self.assertIn("derronqi", by_name["yolov8n-face.pt"].source.lower())
        self.assertIn("facebook/sam3.1", by_name["sam3.1.pt"].source)

    def test_ensure_body_parts_models_skips_existing_files(self) -> None:
        with unittest.mock.patch("automation.body_parts._download_body_parts_model") as download:
            with unittest.mock.patch("automation.body_parts._BACKEND_DIR") as backend_dir:
                existing = unittest.mock.MagicMock()
                existing.is_file.return_value = True
                backend_dir.__truediv__.return_value = existing

                ensure_body_parts_models()

        download.assert_not_called()

    def test_ensure_body_parts_models_downloads_missing_files(self) -> None:
        with unittest.mock.patch("automation.body_parts._download_body_parts_model") as download:
            with unittest.mock.patch("automation.body_parts._BACKEND_DIR") as backend_dir:
                missing = unittest.mock.MagicMock()
                missing.is_file.return_value = False
                missing.parent.mkdir = unittest.mock.MagicMock()
                missing.stat.return_value = unittest.mock.MagicMock(st_size=123)
                backend_dir.__truediv__.return_value = missing

                ensure_body_parts_models()

        self.assertEqual(download.call_count, len(BODY_PARTS_MODEL_SPECS))


class BodyPartsSidecarTests(unittest.TestCase):
    def test_build_body_part_elements_rounds_bboxes(self) -> None:
        elements = build_body_part_elements(
            body_bbox=[10.4, 20.6, 30.2, 40.8],
            face_bbox=[1.1, 2.9, 3.4, 4.6],
            semantic_bbox=[100.2, 200.7, 300.1, 400.9],
            body_desc="the subject's torso",
            face_desc="the subject's face",
            semantic_desc="the subject's accessory",
        )

        self.assertEqual(len(elements), 3)
        self.assertEqual(elements[0]["bbox"], [10.0, 21.0, 30.0, 41.0])
        self.assertEqual(elements[0]["desc"], "the subject's torso")
        self.assertEqual(elements[1]["desc"], "the subject's face")
        self.assertEqual(elements[2]["desc"], "the subject's accessory")

    def test_creates_ideogram4_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")

            status, message = write_body_parts_sidecar(
                media,
                build_body_part_elements(
                    body_bbox=[0, 0, 10, 20],
                    face_bbox=[1, 2, 3, 4],
                    semantic_bbox=None,
                ),
            )

            self.assertEqual(status, "created")
            self.assertIsNone(message)

            data = json.loads(media.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["compositional_deconstruction"]["elements"]), 2)

    def test_updates_existing_json_elements_only(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            json_path = media.with_suffix(".json")
            json_path.write_text(
                json.dumps(
                    {
                        "high_level_description": "Keep this text.",
                        "style_description": {"mood": "warm"},
                        "compositional_deconstruction": {
                            "elements": [{"desc": "old", "bbox": [1, 2, 3, 4]}],
                        },
                    }
                ),
                encoding="utf-8",
            )

            status, _ = write_body_parts_sidecar(
                media,
                build_body_part_elements(
                    body_bbox=[5, 6, 7, 8],
                    face_bbox=None,
                    semantic_bbox=None,
                ),
            )

            self.assertEqual(status, "updated")
            data = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(data["high_level_description"], "Keep this text.")
            self.assertEqual(data["style_description"], {"mood": "warm"})
            self.assertEqual(
                data["compositional_deconstruction"]["elements"][0]["bbox"], [5.0, 6.0, 7.0, 8.0]
            )


class BodyPartsJobProgressTests(unittest.TestCase):
    def test_processed_count_does_not_double_count_no_detections(self) -> None:
        with TempMediaFolder() as root:
            for name in ("one.png", "two.png", "three.png", "four.png"):
                write_media(root, name)

            def fake_loader() -> BodyPartsModels:
                return BodyPartsModels(
                    body_model=object(),
                    face_model=object(),
                    semantic_predictor=None,
                )

            def fake_detect(_models: BodyPartsModels, img_path, **_kwargs):
                if img_path.name in {"one.png", "two.png"}:
                    return []
                return build_body_part_elements(
                    body_bbox=[0, 0, 1, 1],
                    face_bbox=None,
                    semantic_bbox=None,
                )

            with unittest.mock.patch("automation.body_parts.load_body_parts_models", fake_loader):
                with unittest.mock.patch(
                    "automation.body_parts.detect_body_parts_for_image", fake_detect
                ):
                    result = run_body_parts_job(root)

            self.assertEqual(result["total"], 4)
            self.assertEqual(result["processed"], 4)
            self.assertEqual(result["stats"]["no_detections"], 2)
            self.assertEqual(result["stats"]["success"], 4)


class BodyPartsGpuRequirementTests(unittest.TestCase):
    def _fake_torch_modules(
        self, *, cuda_available: bool, torchvision_version: str
    ) -> dict[str, object]:
        fake_torch = unittest.mock.MagicMock()
        fake_torch.cuda.is_available.return_value = cuda_available
        fake_torchvision = unittest.mock.MagicMock()
        fake_torchvision.__version__ = torchvision_version
        return {"torch": fake_torch, "torchvision": fake_torchvision}

    def test_require_gpu_rejects_missing_cuda(self) -> None:
        import sys

        modules = self._fake_torch_modules(cuda_available=False, torchvision_version="0.27.1+cu132")
        with unittest.mock.patch.dict(sys.modules, modules):
            with self.assertRaises(RuntimeError) as ctx:
                _require_gpu()
            self.assertIn("CUDA", str(ctx.exception))

    def test_require_gpu_rejects_cpu_torchvision(self) -> None:
        import sys

        modules = self._fake_torch_modules(cuda_available=True, torchvision_version="0.27.1+cpu")
        with unittest.mock.patch.dict(sys.modules, modules):
            with self.assertRaises(RuntimeError) as ctx:
                _require_gpu()
            self.assertIn("torchvision", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
