import struct
from pathlib import Path


def read_jpeg_dimensions(path: Path) -> tuple[int, int] | None:
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }

    try:
        with path.open("rb") as handle:
            if handle.read(2) != b"\xff\xd8":
                return None

            while True:
                prefix = handle.read(1)
                if not prefix:
                    break
                if prefix != b"\xff":
                    continue

                marker_byte = handle.read(1)
                if not marker_byte:
                    break
                marker = marker_byte[0]

                if marker in sof_markers:
                    length_bytes = handle.read(2)
                    if len(length_bytes) < 2:
                        break
                    segment_length = struct.unpack(">H", length_bytes)[0]
                    segment = handle.read(segment_length - 2)
                    if len(segment) < 5:
                        break
                    height, width = struct.unpack(">HH", segment[1:5])
                    return width, height

                if marker in {0xD9, 0xDA}:
                    break

                length_bytes = handle.read(2)
                if len(length_bytes) < 2:
                    break
                segment_length = struct.unpack(">H", length_bytes)[0]
                if segment_length < 2:
                    break
                handle.read(segment_length - 2)
    except OSError:
        return None

    return None


def get_image_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as handle:
            header = handle.read(64)
    except OSError:
        return None

    if len(header) < 10:
        return None

    if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24:
        width, height = struct.unpack(">II", header[16:24])
        return width, height

    if header[:6] in (b"GIF87a", b"GIF89a"):
        width, height = struct.unpack("<HH", header[6:10])
        return width, height

    if header[:2] == b"BM" and len(header) >= 26:
        width, height = struct.unpack("<II", header[18:26])
        return width, abs(height)

    if header[:2] == b"\xff\xd8":
        return read_jpeg_dimensions(path)

    if len(header) >= 30 and header[8:12] == b"WEBP" and header[12:16] == b"VP8X":
        width = 1 + (header[24] | (header[25] << 8) | (header[26] << 16))
        height = 1 + (header[27] | (header[28] << 8) | (header[29] << 16))
        return width, height

    return None


def read_mp4_dimensions(path: Path) -> tuple[int, int] | None:
    def parse_tkhd(body: bytes) -> tuple[int, int] | None:
        if not body:
            return None
        version = body[0]
        if version == 0 and len(body) >= 84:
            width = struct.unpack(">I", body[76:80])[0] / 65536
            height = struct.unpack(">I", body[80:84])[0] / 65536
            return int(width), int(height)
        if version == 1 and len(body) >= 96:
            width = struct.unpack(">I", body[88:92])[0] / 65536
            height = struct.unpack(">I", body[92:96])[0] / 65536
            return int(width), int(height)
        return None

    def scan_boxes(handle, end: int) -> tuple[int, int] | None:
        while handle.tell() < end:
            header = handle.read(8)
            if len(header) < 8:
                break

            size, box_type = struct.unpack(">I4s", header)
            box_type = box_type.decode("latin1")
            header_size = 8

            if size == 1:
                extended = handle.read(8)
                if len(extended) < 8:
                    break
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            elif size == 0:
                size = end - handle.tell() + header_size

            if size < header_size:
                break

            data_start = handle.tell()
            data_end = data_start + size - header_size

            if box_type == "tkhd":
                handle.seek(data_start)
                body = handle.read(min(size - header_size, 120))
                dimensions = parse_tkhd(body)
                if dimensions:
                    return dimensions

            if box_type in {"moov", "trak", "mdia", "minf", "stbl"}:
                handle.seek(data_start)
                dimensions = scan_boxes(handle, data_end)
                if dimensions:
                    return dimensions

            handle.seek(data_end)

        return None

    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            file_end = handle.tell()
            handle.seek(0)
            return scan_boxes(handle, file_end)
    except OSError:
        return None


def get_video_dimensions(path: Path) -> tuple[int, int] | None:
    if path.suffix.lower() == ".mp4":
        return read_mp4_dimensions(path)
    return None


def get_media_dimensions(path: Path, media_type: str) -> tuple[int, int] | None:
    if media_type == "image":
        return get_image_dimensions(path)
    if media_type == "video":
        return get_video_dimensions(path)
    return None
