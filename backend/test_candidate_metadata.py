import subprocess
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from automation.strip_metadata import iter_png_chunks
from candidate_metadata import write_with_source_metadata
from comfy_metadata import read_media_metadata_values
from ffmpeg_bin import ffmpeg_path
from testing_fixtures import make_png_bytes, playable_video_bytes, png_chunk

ICC_PROFILE = png_chunk(b"iCCP", b"profile\x00\x00" + b"x\x9c\x03\x00\x00\x00\x00\x01")


def chunk_types(path: Path) -> list[bytes]:
    return [chunk_type for chunk_type, _ in iter_png_chunks(path.read_bytes())]


def with_chunk_after_ihdr(data: bytes, chunk: bytes) -> bytes:
    # Signature (8) plus IHDR (12 + 13 bytes of payload).
    return data[:33] + chunk + data[33:]


def tagged_video(path: Path, tags: dict[str, str]) -> Path:
    """A playable clip whose container carries ``tags``, custom keys included."""
    plain = path.with_name(f"plain-{path.name}")
    plain.write_bytes(playable_video_bytes())
    command = [str(ffmpeg_path()), "-nostdin", "-v", "error", "-y", "-i", str(plain)]
    for key, value in tags.items():
        command += ["-metadata", f"{key}={value}"]
    command += ["-c", "copy", "-movflags", "+use_metadata_tags", str(path)]
    subprocess.run(command, check=True, capture_output=True, timeout=30)
    plain.unlink()
    return path


class StillMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.candidate = self.root / "candidate.png"
        self.candidate.write_bytes(
            with_chunk_after_ihdr(
                make_png_bytes(text_chunks={"prompt": '{"1": {"class_type": "Upscale"}}'}),
                ICC_PROFILE,
            )
        )
        self.output = self.root / "output.tmp"

    def tearDown(self) -> None:
        self._temp.cleanup()

    def test_a_png_source_replaces_the_candidates_text_and_keeps_its_colour_profile(self) -> None:
        source = self.root / "photo.png"
        source.write_bytes(make_png_bytes(text_chunks={"parameters": "a lake at dawn"}))

        write_with_source_metadata(source, self.candidate, self.output)

        # The metadata reader goes by suffix.
        published = self.output.replace(self.root / "published.png")
        values = read_media_metadata_values(published)
        self.assertEqual(values, {"parameters": "a lake at dawn"})
        self.assertIn(b"iCCP", chunk_types(published))
        with Image.open(published) as image:
            image.load()
            self.assertEqual(image.size, (64, 48))

    def test_a_jpeg_sources_exif_xmp_and_comment_carry_over(self) -> None:
        exif = Image.Exif()
        exif[0x010E] = "A lake at dawn"
        source = self.root / "photo.jpg"
        Image.new("RGB", (8, 8)).save(
            source, "JPEG", exif=exif, xmp=b"<x:xmpmeta>lake</x:xmpmeta>", comment=b"shot one"
        )

        write_with_source_metadata(source, self.candidate, self.output)

        with Image.open(BytesIO(self.output.read_bytes())) as image:
            image.load()
            self.assertEqual(image.getexif()[0x010E], "A lake at dawn")
            self.assertEqual(image.info["xmp"], b"<x:xmpmeta>lake</x:xmpmeta>")
            self.assertEqual(image.info["Comment"], "shot one")
            self.assertNotIn("prompt", image.info)

    def test_a_webp_sources_exif_carries_over(self) -> None:
        exif = Image.Exif()
        exif[0x010E] = "A ridge"
        source = self.root / "photo.webp"
        Image.new("RGB", (8, 8)).save(source, "WEBP", exif=exif)

        write_with_source_metadata(source, self.candidate, self.output)

        with Image.open(BytesIO(self.output.read_bytes())) as image:
            self.assertEqual(image.getexif()[0x010E], "A ridge")

    def test_an_oriented_sources_exif_does_not_turn_the_upright_candidate(self) -> None:
        """ComfyUI loads the source upright, so its Orientation describes pixels already turned."""
        for suffix in (".jpg", ".png"):
            with self.subTest(source=suffix):
                exif = Image.Exif()
                exif[0x0112] = 6
                exif[0x010E] = "A lake at dawn"
                source = self.root / f"photo{suffix}"
                Image.new("RGB", (64, 32)).save(source, exif=exif.tobytes())
                candidate = self.root / "upright.png"
                Image.new("RGB", (32, 64)).save(candidate)

                write_with_source_metadata(source, candidate, self.output)

                with Image.open(BytesIO(self.output.read_bytes())) as image:
                    self.assertEqual(ImageOps.exif_transpose(image).size, (32, 64))
                    self.assertEqual(image.getexif()[0x010E], "A lake at dawn")

    def test_a_bmp_source_leaves_the_candidate_without_metadata(self) -> None:
        source = self.root / "photo.bmp"
        Image.new("RGB", (8, 8)).save(source)

        write_with_source_metadata(source, self.candidate, self.output)

        types = chunk_types(self.output)
        self.assertNotIn(b"tEXt", types)
        self.assertIn(b"iCCP", types)

    def test_an_unreadable_source_refuses_with_a_way_out(self) -> None:
        source = self.root / "photo.jpg"
        source.write_bytes(b"not a jpeg")

        with self.assertRaisesRegex(ValueError, "Untick Keep original metadata"):
            write_with_source_metadata(source, self.candidate, self.output)

    def test_a_gif_candidate_is_copied_unchanged(self) -> None:
        source = self.root / "photo.png"
        source.write_bytes(make_png_bytes(text_chunks={"parameters": "a lake"}))
        candidate = self.root / "candidate.gif"
        Image.new("P", (8, 8)).save(candidate)

        write_with_source_metadata(source, candidate, self.output)

        self.assertEqual(self.output.read_bytes(), candidate.read_bytes())


class VideoMetadataTests(unittest.TestCase):
    def test_a_video_sources_tags_replace_the_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = tagged_video(root / "clip.mp4", {"comment": "take two", "prompt": "{}"})
            candidate = tagged_video(root / "candidate.mp4", {"workflow": '{"nodes": []}'})
            output = root / "output.tmp"

            write_with_source_metadata(source, candidate, output)

            published = output.replace(root / "published.mp4")
            values = read_media_metadata_values(published)
            self.assertEqual(values.get("comment"), "take two")
            self.assertEqual(values.get("prompt"), "{}")
            self.assertNotIn("workflow", values)


if __name__ == "__main__":
    unittest.main()
