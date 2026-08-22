"""Invariants between the media extension sets.

Every set here is derived from the others by hand, and a new format is added by
editing one line. These are the couplings that a one-line edit silently breaks.
"""

from __future__ import annotations

import unittest

from constants import (
    COMFY_WORKFLOW_EXTENSIONS,
    GIF_EXTENSION,
    IMAGE_EXTENSIONS,
    IMPORT_EXTENSIONS,
    ISOBMFF_EXTENSIONS,
    MATROSKA_EXTENSIONS,
    MEDIA_EXTENSIONS,
    MEDIA_MIME_TYPES,
    MOTION_EXTENSIONS,
    PILLOW_EXTENSIONS,
    SHARED_CONSTANTS,
    SIDECAR_EXTENSIONS,
    VIDEO_EXTENSIONS,
    WATERMARK_EXTENSIONS,
)

#: Audio is deliberately out of scope, and SVG is vector - nothing here decodes either.
UNSUPPORTED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".svg"}


class MediaExtensionInvariantTests(unittest.TestCase):
    def test_the_three_axes_do_not_overlap(self) -> None:
        self.assertNotIn(GIF_EXTENSION, IMAGE_EXTENSIONS)
        self.assertNotIn(GIF_EXTENSION, VIDEO_EXTENSIONS)
        self.assertEqual(IMAGE_EXTENSIONS & VIDEO_EXTENSIONS, set())

    def test_isobmff_is_a_subset_of_video(self) -> None:
        self.assertLessEqual(ISOBMFF_EXTENSIONS, VIDEO_EXTENSIONS)

    def test_matroska_is_video_the_mp4_reader_cannot_touch(self) -> None:
        # The two header readers in `media_dimensions` split the video extensions
        # between them; an extension in both would pick whichever branch runs first.
        self.assertLessEqual(MATROSKA_EXTENSIONS, VIDEO_EXTENSIONS)
        self.assertEqual(MATROSKA_EXTENSIONS & ISOBMFF_EXTENSIONS, set())

    def test_watermark_covers_images_and_only_the_mp4_family(self) -> None:
        # `-movflags` and `-c:a copy` are MP4-family shaped, and GIF's palette
        # cannot express a translucent mark without banding.
        self.assertEqual(WATERMARK_EXTENSIONS, IMAGE_EXTENSIONS | ISOBMFF_EXTENSIONS)
        self.assertNotIn(GIF_EXTENSION, WATERMARK_EXTENSIONS)

    def test_comfy_workflow_extensions_are_png_plus_isobmff(self) -> None:
        self.assertEqual(COMFY_WORKFLOW_EXTENSIONS, {".png"} | ISOBMFF_EXTENSIONS)
        self.assertLessEqual(COMFY_WORKFLOW_EXTENSIONS, MEDIA_EXTENSIONS)

    def test_every_media_extension_has_a_mime_type(self) -> None:
        # A missing entry falls through to `mimetypes.guess_type`, which answers
        # from the Windows registry and can return text/plain for real media.
        self.assertEqual(MEDIA_EXTENSIONS - set(MEDIA_MIME_TYPES), set())

    def test_pillow_and_motion_split_the_gif_between_them(self) -> None:
        self.assertEqual(PILLOW_EXTENSIONS, IMAGE_EXTENSIONS | {GIF_EXTENSION})
        self.assertEqual(MOTION_EXTENSIONS, VIDEO_EXTENSIONS | {GIF_EXTENSION})
        self.assertEqual(MEDIA_EXTENSIONS, IMAGE_EXTENSIONS | MOTION_EXTENSIONS)

    def test_import_adds_sidecars_to_media(self) -> None:
        self.assertEqual(IMPORT_EXTENSIONS, MEDIA_EXTENSIONS | SIDECAR_EXTENSIONS)

    def test_unsupported_formats_stay_out(self) -> None:
        self.assertEqual(MEDIA_EXTENSIONS & UNSUPPORTED_EXTENSIONS, set())
        self.assertEqual(set(MEDIA_MIME_TYPES) & UNSUPPORTED_EXTENSIONS, set())


class SharedConstantsTests(unittest.TestCase):
    def test_the_ui_gets_what_it_needs_to_type_an_item(self) -> None:
        self.assertEqual(SHARED_CONSTANTS["VIDEO_EXTENSIONS"], sorted(VIDEO_EXTENSIONS))
        self.assertEqual(SHARED_CONSTANTS["GIF_EXTENSION"], GIF_EXTENSION)
        self.assertEqual(
            SHARED_CONSTANTS["COMFY_WORKFLOW_EXTENSIONS"], sorted(COMFY_WORKFLOW_EXTENSIONS)
        )
        self.assertEqual(SHARED_CONSTANTS["IMPORT_EXTENSIONS"], sorted(IMPORT_EXTENSIONS))

    def test_exported_sets_are_sorted_for_a_stable_diff(self) -> None:
        for name in ("IMPORT_EXTENSIONS", "VIDEO_EXTENSIONS", "COMFY_WORKFLOW_EXTENSIONS"):
            with self.subTest(name=name):
                value = SHARED_CONSTANTS[name]
                assert isinstance(value, list)
                self.assertEqual(value, sorted(value))


if __name__ == "__main__":
    unittest.main()
