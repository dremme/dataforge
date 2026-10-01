from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def verify_ffmpeg(expected_version: str | None = None) -> str:
    from ffmpeg_bin import PINNED_VERSION, ffmpeg_path

    series = f"{'.'.join(map(str, PINNED_VERSION))}.x"
    expected = expected_version or series
    executable = ffmpeg_path()
    if not executable:
        raise RuntimeError(
            f"The application could not locate FFmpeg {expected}. "
            f"Install FFmpeg {series} on PATH or reinstall the backend dependencies."
        )
    result = subprocess.run(
        [executable, "-version"], capture_output=True, text=True, check=True, timeout=10
    )
    banner = result.stdout.splitlines()[0] if result.stdout else ""
    release = re.match(r"ffmpeg version n?(\d+\.\d+(?:\.\d+)?)(?=\s|[-_]|$)", banner)
    matches = bool(release) and (
        release[1] == expected_version
        if expected_version
        else tuple(map(int, release[1].split(".")[:2])) == PINNED_VERSION
    )
    if not matches:
        raise RuntimeError(
            f"Expected FFmpeg {expected}, but the application selected {executable}: "
            f"{banner or 'no version banner'}"
        )
    return f"{executable}\n{banner}"


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
    parser = argparse.ArgumentParser(description="Verify the FFmpeg selected by the application.")
    parser.add_argument("version", nargs="?")
    args = parser.parse_args()
    try:
        print(verify_ffmpeg(args.version))
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
