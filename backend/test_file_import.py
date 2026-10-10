from __future__ import annotations

import errno
import io
import shutil
import unittest
from unittest.mock import patch

from PIL import Image

from edit_sidecars import backup_path_for, edit_spec_path
from file_import import import_uploaded_files
from image_edit import apply_image_edit
from schemas import ImageEditSpec
from testing_fixtures import TempMediaFolder, write_image


class ImportWriteFailureTests(unittest.TestCase):
    def test_overwrite_exposes_only_complete_file_contents(self) -> None:
        with TempMediaFolder() as root:
            destination = root / "landscape.png"
            original = b"original landscape"
            destination.write_bytes(original)

            def copy(source, target):
                target.write(b"new ")
                target.flush()
                self.assertEqual(destination.read_bytes(), original)
                target.write(source.read())

            with patch("file_import.shutil.copyfileobj", side_effect=copy):
                result = import_uploaded_files(
                    root, [(destination.name, io.BytesIO(b"landscape"))], overwrite=True
                )

            self.assertEqual(result, {"copied": [destination.name], "skipped": [], "rejected": []})
            self.assertEqual(destination.read_bytes(), b"new landscape")
            self.assertEqual(list(root.iterdir()), [destination])

    def test_failed_publication_preserves_the_existing_file(self) -> None:
        with TempMediaFolder() as root:
            destination = root / "landscape.png"
            original = b"original landscape"
            destination.write_bytes(original)

            with patch("os.replace", side_effect=PermissionError("Destination is locked")):
                with self.assertRaises(PermissionError):
                    import_uploaded_files(
                        root, [(destination.name, io.BytesIO(b"new landscape"))], overwrite=True
                    )

            self.assertEqual(destination.read_bytes(), original)
            self.assertEqual(list(root.iterdir()), [destination])

    def test_file_created_during_upload_is_skipped_without_overwrite(self) -> None:
        with TempMediaFolder() as root:
            destination = root / "landscape.png"
            original = b"landscape created by another import"
            real_copy = shutil.copyfileobj

            def copy(source, target):
                real_copy(source, target)
                destination.write_bytes(original)

            with patch("file_import.shutil.copyfileobj", side_effect=copy):
                result = import_uploaded_files(
                    root, [(destination.name, io.BytesIO(b"new landscape"))]
                )

            self.assertEqual(result, {"copied": [], "skipped": [destination.name], "rejected": []})
            self.assertEqual(destination.read_bytes(), original)
            self.assertEqual(list(root.iterdir()), [destination])

    def test_failed_upload_read_preserves_the_existing_file(self) -> None:
        with TempMediaFolder() as root:
            destination = root / "landscape.png"
            original = b"original landscape"
            destination.write_bytes(original)
            upload = io.BytesIO()

            with patch.object(upload, "read", side_effect=[b"partial", OSError("Read failed")]):
                with self.assertRaises(OSError):
                    import_uploaded_files(root, [(destination.name, upload)], overwrite=True)

            self.assertEqual(destination.read_bytes(), original)
            self.assertEqual(list(root.iterdir()), [destination])

    def test_failed_new_upload_leaves_no_partial_file(self) -> None:
        with TempMediaFolder() as root:
            upload = io.BytesIO()

            with patch.object(upload, "read", side_effect=[b"partial", OSError("Read failed")]):
                with self.assertRaises(OSError):
                    import_uploaded_files(root, [("landscape.png", upload)])

            self.assertEqual(list(root.iterdir()), [])

    def test_full_disk_preserves_the_existing_file(self) -> None:
        with TempMediaFolder() as root:
            destination = root / "landscape.png"
            original = b"original landscape"
            destination.write_bytes(original)

            def fail_copy(source, target):
                target.write(b"partial")
                raise OSError(errno.ENOSPC, "Disk is full")

            with patch("file_import.shutil.copyfileobj", side_effect=fail_copy):
                with self.assertRaises(OSError):
                    import_uploaded_files(
                        root, [(destination.name, io.BytesIO(b"new landscape"))], overwrite=True
                    )

            self.assertEqual(destination.read_bytes(), original)
            self.assertEqual(list(root.iterdir()), [destination])


def _png_bytes(color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 16), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _unlink(path) -> None:
    path.unlink()


class ImportOverEditedMediaTests(unittest.TestCase):
    def test_the_next_edit_renders_the_imported_file_not_the_old_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=32, height=16, color=(255, 0, 0))
            apply_image_edit(media, ImageEditSpec(rotate=90))
            caption = root / "photo.txt"
            caption.write_text("kept", encoding="utf-8")

            with patch("file_import.delete_path", side_effect=_unlink):
                import_uploaded_files(
                    root, [("photo.png", io.BytesIO(_png_bytes((0, 255, 0))))], overwrite=True
                )

            self.assertFalse(backup_path_for(media).exists())
            self.assertFalse(edit_spec_path(media).exists())
            self.assertEqual(caption.read_text(encoding="utf-8"), "kept")

            apply_image_edit(media, ImageEditSpec(mirror_h=True))
            with Image.open(media) as edited:
                self.assertEqual(edited.size, (32, 16))
                self.assertEqual(edited.convert("RGB").getpixel((0, 0)), (0, 255, 0))

    def test_importing_a_caption_leaves_the_edit_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=32, height=16)
            apply_image_edit(media, ImageEditSpec(rotate=90))
            (root / "photo.txt").write_text("old", encoding="utf-8")

            with patch("file_import.delete_path", side_effect=_unlink):
                import_uploaded_files(root, [("photo.txt", io.BytesIO(b"new"))], overwrite=True)

            self.assertTrue(backup_path_for(media).is_file())


if __name__ == "__main__":
    unittest.main()
