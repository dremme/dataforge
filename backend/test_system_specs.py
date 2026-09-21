from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import venv
from pathlib import Path
from unittest.mock import MagicMock, patch

import system_specs
from system_specs import _gpu_from_nvidia_smi, _gpu_from_torch, get_system_specs


class NvidiaSmiGpuTests(unittest.TestCase):
    @patch("system_specs.subprocess.run")
    def test_parses_name_total_and_used(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(
            returncode=0,
            stdout="NVIDIA GeForce RTX 4090, 24564, 8192, 87, 64\n",
        )

        info = _gpu_from_nvidia_smi()

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "NVIDIA GeForce RTX 4090")
        self.assertEqual(info.memory_total_bytes, (24564 * 1024 * 1024))
        self.assertEqual(info.memory_used_bytes, (8192 * 1024 * 1024))
        self.assertEqual(info.load_percent, 87.0)
        self.assertEqual(info.temperature_celsius, 64.0)

    @patch("system_specs.subprocess.run")
    def test_queries_only_the_fields_the_panel_shows(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(returncode=0, stdout="GPU, 100, 40, 5, 44\n")

        _gpu_from_nvidia_smi()

        query = next(arg for arg in run_mock.call_args.args[0] if arg.startswith("--query-gpu"))
        self.assertEqual(
            query,
            "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu",
        )

    @patch("system_specs.subprocess.run")
    def test_leaves_load_unknown_when_the_card_reports_na(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(returncode=0, stdout="GPU, 100, 40, [N/A], [N/A]\n")

        info = _gpu_from_nvidia_smi()

        assert info is not None
        self.assertIsNone(info.load_percent)
        self.assertIsNone(info.temperature_celsius)
        self.assertEqual(info.memory_used_bytes, 40 * 1024 * 1024)

    @patch("system_specs.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_none_when_smi_missing(self, _run_mock: MagicMock) -> None:
        self.assertIsNone(_gpu_from_nvidia_smi())


class TorchGpuTests(unittest.TestCase):
    def test_typechecks_without_optional_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            venv.EnvBuilder(with_pip=False).create(directory)
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "ty",
                    "check",
                    "system_specs.py",
                    "--python",
                    directory,
                    "--python-platform",
                    "linux",
                ],
                cwd=Path(__file__).resolve().parent,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_returns_none_when_torch_is_not_installed(self) -> None:
        with patch.dict("sys.modules", {"torch": None}):
            self.assertIsNone(_gpu_from_torch())

    def test_returns_none_when_cuda_unavailable(self) -> None:
        torch_mock = MagicMock()
        torch_mock.cuda.is_available.return_value = False
        with patch.dict("sys.modules", {"torch": torch_mock}):
            self.assertIsNone(_gpu_from_torch())

    def test_reads_mem_get_info_when_available(self) -> None:
        torch_mock = MagicMock()
        torch_mock.cuda.is_available.return_value = True
        props = MagicMock()
        props.name = "Mock GPU"
        props.total_memory = 8 * 1024**3
        torch_mock.cuda.get_device_properties.return_value = props
        torch_mock.cuda.mem_get_info.return_value = (3 * 1024**3, 8 * 1024**3)

        with patch.dict("sys.modules", {"torch": torch_mock}):
            info = _gpu_from_torch()

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "Mock GPU")
        self.assertEqual(info.memory_total_bytes, 8 * 1024**3)
        # torch reports 3 GB free of 8 GB, so 5 GB is in use.
        self.assertEqual(info.memory_used_bytes, 5 * 1024**3)


class CpuUsageTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.multiple(
            system_specs, _previous_cpu_times=(100, 1000), _last_cpu_load_percent=None
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_measures_busy_share_since_the_previous_sample(self) -> None:
        # 400 of the 1000 ticks since the last sample were idle.
        with patch("system_specs._cpu_times", return_value=(500, 2000)):
            self.assertEqual(system_specs._cpu_load_percent(), 60.0)

    def test_repeats_the_last_reading_when_no_time_has_passed(self) -> None:
        with patch("system_specs._cpu_times", return_value=(500, 2000)):
            system_specs._cpu_load_percent()
            # A second request in the same tick must not blank the readout.
            self.assertEqual(system_specs._cpu_load_percent(), 60.0)

    def test_is_none_without_a_counter(self) -> None:
        with patch("system_specs._cpu_times", return_value=None):
            self.assertIsNone(system_specs._cpu_load_percent())


class CpuTemperatureTests(unittest.TestCase):
    """Windows and macOS have no sensor a normal process may read; only Linux is wired up."""

    def test_reads_the_hwmon_package_sensor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            unrelated = Path(directory) / "hwmon0"
            unrelated.mkdir()
            (unrelated / "name").write_text("nvme", encoding="utf-8")
            (unrelated / "temp1_input").write_text("39000", encoding="utf-8")
            cpu = Path(directory) / "hwmon1"
            cpu.mkdir()
            (cpu / "name").write_text("k10temp", encoding="utf-8")
            (cpu / "temp1_input").write_text("54321", encoding="utf-8")

            with (
                patch("system_specs.sys.platform", "linux"),
                patch("system_specs.glob.glob", return_value=[str(unrelated), str(cpu)]),
            ):
                self.assertEqual(system_specs._cpu_temperature_celsius(), 54.321)

    def test_is_none_when_no_hwmon_belongs_to_the_cpu(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            other = Path(directory) / "hwmon0"
            other.mkdir()
            (other / "name").write_text("nvme", encoding="utf-8")

            with (
                patch("system_specs.sys.platform", "linux"),
                patch("system_specs.glob.glob", return_value=[str(other)]),
            ):
                self.assertIsNone(system_specs._cpu_temperature_celsius())

    def test_reads_no_sensor_off_linux(self) -> None:
        with (
            patch("system_specs.sys.platform", "win32"),
            patch("system_specs.glob.glob") as glob_mock,
        ):
            self.assertIsNone(system_specs._cpu_temperature_celsius())

        glob_mock.assert_not_called()


class SystemMemoryTests(unittest.TestCase):
    @patch("system_specs._gpu_info", return_value=None)
    @patch("system_specs._memory_bytes", return_value=(32 * 1024**3, 24 * 1024**3))
    def test_reports_used_memory_rather_than_available(
        self,
        _memory_mock: MagicMock,
        _gpu_mock: MagicMock,
    ) -> None:
        """The platform APIs report free memory; the panel wants used, like it shows for VRAM."""
        specs = get_system_specs()

        self.assertEqual(specs.memory_total_bytes, 32 * 1024**3)
        self.assertEqual(specs.memory_used_bytes, 8 * 1024**3)


if __name__ == "__main__":
    unittest.main()
