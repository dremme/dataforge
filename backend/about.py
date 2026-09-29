"""Facts about this installation, for the Settings modal and for bug reports."""

from __future__ import annotations

import platform
import tomllib
from functools import cache
from pathlib import Path

from comfy_settings import get_comfy_workflows_dir
from db import get_db_path
from env_file import loaded_env_file
from ffmpeg_bin import locate_ffmpeg
from schemas import AboutResponse
from thumbnails import get_thumbnail_cache_dir

PYPROJECT = Path(__file__).resolve().parent / "pyproject.toml"


@cache
def app_version() -> str:
    with PYPROJECT.open("rb") as handle:
        return str(tomllib.load(handle)["project"]["version"])


def describe_installation() -> AboutResponse:
    ffmpeg = locate_ffmpeg()
    env_file = loaded_env_file()
    return AboutResponse(
        version=app_version(),
        python_version=platform.python_version(),
        platform=platform.platform(terse=True),
        ffmpeg_path=ffmpeg[0] if ffmpeg else None,
        ffmpeg_source=ffmpeg[1] if ffmpeg else None,
        env_file=str(env_file) if env_file else None,
        database_path=str(get_db_path()),
        thumbnail_cache_dir=str(get_thumbnail_cache_dir()),
        workflows_dir=str(get_comfy_workflows_dir()),
    )
