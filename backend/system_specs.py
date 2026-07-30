"""Host system specifications for the automation panel."""

from __future__ import annotations

import os
import platform
import re
import subprocess
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class SystemSpecs:
    cpu_name: str
    cpu_cores: int
    memory_total_bytes: int
    memory_used_bytes: int
    gpu_name: str | None
    gpu_memory_bytes: int | None
    gpu_memory_used_bytes: int | None
    gpu_available: bool


@dataclass(frozen=True)
class _GpuInfo:
    name: str
    memory_total_bytes: int
    memory_used_bytes: int | None


def _windows_memory_bytes() -> tuple[int, int]:
    import ctypes

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        raise OSError("GlobalMemoryStatusEx failed")
    return int(stat.ullTotalPhys), int(stat.ullAvailPhys)


def _linux_memory_bytes() -> tuple[int, int]:
    meminfo: dict[str, int] = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, value, *_ = line.split()
            meminfo[key.rstrip(":")] = int(value) * 1024

    total = meminfo["MemTotal"]
    available = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
    return total, available


def _macos_memory_bytes() -> tuple[int, int]:
    total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip())
    page_size = int(subprocess.check_output(["sysctl", "-n", "hw.pagesize"], text=True).strip())
    vm_stat = subprocess.check_output(["vm_stat"], text=True)
    free_pages = 0
    inactive_pages = 0
    for line in vm_stat.splitlines():
        if line.startswith("Pages free:"):
            free_pages = int(line.split(":", 1)[1].strip().rstrip("."))
        elif line.startswith("Pages inactive:"):
            inactive_pages = int(line.split(":", 1)[1].strip().rstrip("."))
    available = (free_pages + inactive_pages) * page_size
    return total, available


def _memory_bytes() -> tuple[int, int]:
    """``(total, available)`` — every platform API reports what is free, not what is used."""
    if sys.platform == "win32":
        return _windows_memory_bytes()
    if sys.platform == "darwin":
        return _macos_memory_bytes()
    return _linux_memory_bytes()


def _cpu_name() -> str:
    if sys.platform == "darwin":
        return subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            text=True,
        ).strip()

    if sys.platform == "win32":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            ) as key:
                name = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
                if name:
                    return name
        except OSError:
            pass

        name = platform.processor().strip()
        if name:
            return name

    if sys.platform.startswith("linux"):
        try:
            with open("/proc/cpuinfo", encoding="utf-8") as handle:
                for line in handle:
                    if line.lower().startswith("model name"):
                        return line.split(":", 1)[1].strip()
        except OSError:
            pass

    fallback = platform.processor().strip()
    return fallback or "Unknown CPU"


def _sanitize_cpu_name(name: str) -> str:
    return re.sub(r"\s+\d+-Core Processor$", "", name, flags=re.IGNORECASE)


def _mb_to_bytes(value: str) -> int:
    return int(float(value.strip()) * 1024 * 1024)


def _gpu_from_nvidia_smi() -> _GpuInfo | None:
    """Whole-GPU stats (includes other processes such as a local LLM server)."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None

    if result.returncode != 0 or not result.stdout.strip():
        return None

    # Use the first GPU line only (matches prior single-GPU behavior).
    line = result.stdout.strip().splitlines()[0]
    parts = [part.strip() for part in line.split(",")]
    if len(parts) < 3:
        return None

    name, total_mb, used_mb = parts[0], parts[1], parts[2]
    return _GpuInfo(
        name=name,
        memory_total_bytes=_mb_to_bytes(total_mb),
        memory_used_bytes=_mb_to_bytes(used_mb),
    )


def _gpu_from_torch() -> _GpuInfo | None:
    try:
        import torch
    except ImportError:
        return None

    if not torch.cuda.is_available():
        return None

    device = torch.cuda.get_device_properties(0)
    total_bytes = int(device.total_memory)
    used_bytes: int | None = None
    try:
        free, total = torch.cuda.mem_get_info(0)
        total_bytes = int(total)
        # torch reports what is free; the panel shows used.
        used_bytes = total_bytes - int(free)
    except Exception:
        pass

    return _GpuInfo(
        name=device.name,
        memory_total_bytes=total_bytes,
        memory_used_bytes=used_bytes,
    )


def _gpu_info() -> tuple[str | None, int | None, int | None, bool]:
    # Prefer nvidia-smi so VRAM used by external processes (e.g. LM Studio) is included.
    for resolver in (_gpu_from_nvidia_smi, _gpu_from_torch):
        info = resolver()
        if info is not None:
            return info.name, info.memory_total_bytes, info.memory_used_bytes, True
    return None, None, None, False


def get_system_specs() -> SystemSpecs:
    total_bytes, available_bytes = _memory_bytes()
    gpu_name, gpu_memory_bytes, gpu_memory_used_bytes, gpu_available = _gpu_info()
    return SystemSpecs(
        cpu_name=_sanitize_cpu_name(_cpu_name()),
        cpu_cores=os.cpu_count() or 1,
        memory_total_bytes=total_bytes,
        # Derived once here so RAM reads "used / total", the same way VRAM does.
        memory_used_bytes=total_bytes - available_bytes,
        gpu_name=gpu_name,
        gpu_memory_bytes=gpu_memory_bytes,
        gpu_memory_used_bytes=gpu_memory_used_bytes,
        gpu_available=gpu_available,
    )
