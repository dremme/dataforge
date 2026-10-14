"""Installs the optional tagging packages into the backend venv and downloads the tagging model.

Run with the venv's Python; setup does this unless told to skip tagging. The PyTorch build is
chosen for this machine: the newest CUDA build the NVIDIA driver runs, ROCm on Linux x86_64 with
ROCm installed, PyPI's on macOS, and CPU otherwise. A torch that already fits is kept, so running
setup again does not download it again.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
REQUIREMENTS = BACKEND / "requirements-tagging.txt"

PYTORCH_INDEX = "https://download.pytorch.org/whl/"
# Bump together: torchvision releases pair with one torch release.
TORCH_VERSION = "2.11.0"
TORCHVISION_VERSION = "0.26.0"

#: CUDA builds published for the pinned torch, newest first, with the driver CUDA each needs.
CUDA_BUILDS: tuple[tuple[str, tuple[int, int]], ...] = (
    ("cu130", (13, 0)),
    ("cu128", (12, 8)),
    ("cu126", (12, 6)),
)
ROCM_BUILD = "rocm7.1"
CPU_BUILD = "cpu"

# Older drivers print "CUDA Version: 12.8"; newer ones "CUDA UMD Version: 13.4".
_DRIVER_CUDA = re.compile(r"CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)")


def parse_driver_cuda(text: str) -> tuple[int, int] | None:
    match = _DRIVER_CUDA.search(text)
    return None if match is None else (int(match.group(1)), int(match.group(2)))


def driver_cuda_version() -> tuple[int, int] | None:
    """The newest CUDA the NVIDIA driver supports, or None without one."""
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi is None:
        return None
    try:
        completed = subprocess.run(
            [nvidia_smi], capture_output=True, text=True, timeout=30, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_driver_cuda(completed.stdout) if completed.returncode == 0 else None


def has_rocm() -> bool:
    return shutil.which("rocminfo") is not None or Path("/opt/rocm").is_dir()


def choose_build(
    system: str, machine: str, cuda: tuple[int, int] | None, rocm: bool
) -> str | None:
    """The PyTorch index to install from; None means PyPI's default build."""
    if system == "Darwin":
        return None
    if cuda is not None:
        for build, needs in CUDA_BUILDS:
            if cuda >= needs:
                return build
    if rocm and system == "Linux" and machine.lower() in {"x86_64", "amd64"}:
        return ROCM_BUILD
    return CPU_BUILD


def torch_fits(installed: str | None, build: str | None, cuda: tuple[int, int] | None) -> bool:
    """Whether the installed torch can stay. ``installed`` is its version, like 2.11.0+cu128."""
    if installed is None:
        return False
    version, _, local = installed.partition("+")
    if version != TORCH_VERSION:
        return False
    if build is None or local == build:
        return True
    # An older CUDA build the driver still runs is kept: a newer one is gigabytes for little.
    return (
        build.startswith("cu")
        and cuda is not None
        and any(local == name and cuda >= needs for name, needs in CUDA_BUILDS)
    )


def installed_torch() -> str | None:
    try:
        return importlib.metadata.version("torch")
    except importlib.metadata.PackageNotFoundError:
        return None


def describe(build: str | None, cuda: tuple[int, int] | None) -> str:
    if build is None:
        return "the default macOS build"
    if build.startswith("cu") and cuda is not None:
        return f"{build} (the driver supports CUDA {cuda[0]}.{cuda[1]})"
    if build == ROCM_BUILD:
        return f"{build} (ROCm found)"
    return "the CPU build (no supported GPU found; tagging uses the small model)"


def pip(*args: str) -> None:
    subprocess.run([sys.executable, "-m", "pip", "install", *args], check=True)


def install_torch() -> None:
    cuda = driver_cuda_version()
    build = choose_build(platform.system(), platform.machine(), cuda, has_rocm())
    installed = installed_torch()

    if torch_fits(installed, build, cuda):
        print(f"Keeping torch {installed}.")
        return

    print(f"Installing torch {TORCH_VERSION}, {describe(build, cuda)}...")
    index = [] if build is None else ["--index-url", f"{PYTORCH_INDEX}{build}"]
    pip(f"torch=={TORCH_VERSION}", f"torchvision=={TORCHVISION_VERSION}", *index)


def download_model() -> None:
    """Loads the model the app will load, which downloads and prepares it."""
    importlib.invalidate_caches()
    sys.path.insert(0, str(BACKEND))
    tagger = importlib.import_module("tagger")

    model_name = tagger.select_model_name()
    print(f"Preparing {model_name} with the tag vocabulary; the first time downloads it...")
    tagger.TagModel(tagger.load_vocabulary(), model_name).close()
    print(f"{model_name} is ready in {tagger.get_models_dir()}.")


def main() -> int:
    if sys.prefix == sys.base_prefix:
        print("Run this with the backend venv's Python.", file=sys.stderr)
        return 2
    try:
        install_torch()
        # ultralytics asks for opencv-python, which would overwrite opencv-python-headless.
        print("Installing the tagging packages...")
        pip("--no-deps", "-r", str(REQUIREMENTS))
        download_model()
    except subprocess.CalledProcessError as error:
        print(f"pip failed with exit code {error.returncode}.", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"The tagging model could not be prepared: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
