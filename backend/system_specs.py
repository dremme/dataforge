from __future__ import annotations

import contextlib
import glob
import importlib
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
    cpu_load_percent: float | None
    cpu_temperature_celsius: float | None
    memory_total_bytes: int
    memory_used_bytes: int
    gpu_name: str | None
    gpu_memory_bytes: int | None
    gpu_memory_used_bytes: int | None
    gpu_load_percent: float | None
    gpu_temperature_celsius: float | None
    gpu_available: bool


@dataclass(frozen=True)
class _GpuInfo:
    name: str
    memory_total_bytes: int
    memory_used_bytes: int | None
    load_percent: float | None
    temperature_celsius: float | None


def _windows_memory_bytes() -> tuple[int, int]:
    # The caller dispatches on platform, but only a guard here narrows ctypes for a checker
    # running on another one; CI checks this file from Linux.
    if sys.platform != "win32":
        raise OSError("Windows memory counters need Windows")

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
    """``(total, available)``. Platform APIs report free, not used."""
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


def _windows_cpu_times() -> tuple[int, int]:
    if sys.platform != "win32":
        raise OSError("Windows CPU counters need Windows")

    import ctypes
    from ctypes import wintypes

    idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
    if not ctypes.windll.kernel32.GetSystemTimes(
        ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
    ):
        raise OSError("GetSystemTimes failed")

    def ticks(value: wintypes.FILETIME) -> int:
        return (value.dwHighDateTime << 32) | value.dwLowDateTime

    # Kernel time already includes idle time.
    return ticks(idle), ticks(kernel) + ticks(user)


def _linux_cpu_times() -> tuple[int, int]:
    with open("/proc/stat", encoding="utf-8") as handle:
        fields = [int(value) for value in handle.readline().split()[1:]]
    # idle + iowait; guest time is already counted in user/nice.
    return fields[3] + fields[4], sum(fields[:8])


def _cpu_times() -> tuple[int, int] | None:
    """``(idle, total)`` since boot, or ``None`` where no counter is read (macOS)."""
    try:
        if sys.platform == "win32":
            return _windows_cpu_times()
        if sys.platform.startswith("linux"):
            return _linux_cpu_times()
    except (OSError, ValueError, IndexError):
        pass
    return None


_previous_cpu_times = _cpu_times()
_last_cpu_load_percent: float | None = None


def _cpu_load_percent() -> float | None:
    """System-wide load since the previous call, so the panel's poll cadence sets the window."""
    global _previous_cpu_times, _last_cpu_load_percent
    current = _cpu_times()
    if current is None or _previous_cpu_times is None:
        _previous_cpu_times = current
        return None
    idle_delta = current[0] - _previous_cpu_times[0]
    total_delta = current[1] - _previous_cpu_times[1]
    # Two requests inside one scheduler tick see no elapsed time; repeat the last reading.
    if total_delta > 0:
        busy = 100.0 * (1 - idle_delta / total_delta)
        _last_cpu_load_percent = round(max(0.0, min(100.0, busy)), 1)
        _previous_cpu_times = current
    return _last_cpu_load_percent


#: hwmon drivers that report a package/die temperature for the CPU.
_LINUX_CPU_HWMON_NAMES = ("k10temp", "zenpower", "coretemp", "cpu_thermal", "cpu-thermal")


def _cpu_temperature_celsius() -> float | None:
    """Only Linux answers without a ring-0 driver: Windows boards expose no usable ACPI zone."""
    if not sys.platform.startswith("linux"):
        return None

    for hwmon in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        try:
            with open(os.path.join(hwmon, "name"), encoding="utf-8") as handle:
                if handle.read().strip() not in _LINUX_CPU_HWMON_NAMES:
                    continue
            with open(os.path.join(hwmon, "temp1_input"), encoding="utf-8") as handle:
                return int(handle.read().strip()) / 1000
        except (OSError, ValueError):
            continue
    return None


def _sanitize_cpu_name(name: str) -> str:
    return re.sub(r"\s+\d+-Core Processor$", "", name, flags=re.IGNORECASE)


def _mb_to_bytes(value: str) -> int:
    return int(float(value.strip()) * 1024 * 1024)


def _optional_float(value: str) -> float | None:
    """nvidia-smi prints ``[N/A]`` for counters a card does not expose."""
    try:
        return float(value.strip())
    except ValueError:
        return None


def _gpu_from_nvidia_smi() -> _GpuInfo | None:
    """Includes VRAM used by other processes."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu",
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

    line = result.stdout.strip().splitlines()[0]
    parts = [part.strip() for part in line.split(",")]
    if len(parts) < 5:
        return None

    name, total_mb, used_mb, load, temperature = parts[:5]
    return _GpuInfo(
        name=name,
        memory_total_bytes=_mb_to_bytes(total_mb),
        memory_used_bytes=_mb_to_bytes(used_mb),
        load_percent=_optional_float(load),
        temperature_celsius=_optional_float(temperature),
    )


def _gpu_from_torch() -> _GpuInfo | None:
    try:
        torch = importlib.import_module("torch")
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
        used_bytes = total_bytes - int(free)
    except Exception:
        pass

    load_percent: float | None = None
    # Needs pynvml, which a plain torch install does not bring.
    with contextlib.suppress(Exception):
        load_percent = float(torch.cuda.utilization(0))

    return _GpuInfo(
        name=device.name,
        memory_total_bytes=total_bytes,
        memory_used_bytes=used_bytes,
        load_percent=load_percent,
        temperature_celsius=None,
    )


def _gpu_info() -> _GpuInfo | None:
    # Prefer nvidia-smi so VRAM used by external processes is included.
    for resolver in (_gpu_from_nvidia_smi, _gpu_from_torch):
        info = resolver()
        if info is not None:
            return info
    return None


def get_system_specs() -> SystemSpecs:
    total_bytes, available_bytes = _memory_bytes()
    gpu = _gpu_info()
    return SystemSpecs(
        cpu_name=_sanitize_cpu_name(_cpu_name()),
        cpu_cores=os.cpu_count() or 1,
        cpu_load_percent=_cpu_load_percent(),
        cpu_temperature_celsius=_cpu_temperature_celsius(),
        memory_total_bytes=total_bytes,
        memory_used_bytes=total_bytes - available_bytes,
        gpu_name=gpu.name if gpu else None,
        gpu_memory_bytes=gpu.memory_total_bytes if gpu else None,
        gpu_memory_used_bytes=gpu.memory_used_bytes if gpu else None,
        gpu_load_percent=gpu.load_percent if gpu else None,
        gpu_temperature_celsius=gpu.temperature_celsius if gpu else None,
        gpu_available=gpu is not None,
    )
