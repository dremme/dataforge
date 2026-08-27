from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from system_specs import _gpu_from_nvidia_smi, _gpu_from_torch, get_system_specs


class NvidiaSmiGpuTests(unittest.TestCase):
    @patch("system_specs.subprocess.run")
    def test_parses_name_total_and_used(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(
            returncode=0,
            stdout="NVIDIA GeForce RTX 4090, 24564, 8192\n",
        )

        info = _gpu_from_nvidia_smi()

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "NVIDIA GeForce RTX 4090")
        self.assertEqual(info.memory_total_bytes, (24564 * 1024 * 1024))
        self.assertEqual(info.memory_used_bytes, (8192 * 1024 * 1024))

    @patch("system_specs.subprocess.run")
    def test_queries_only_the_fields_the_panel_shows(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(returncode=0, stdout="GPU, 100, 40\n")

        _gpu_from_nvidia_smi()

        query = next(arg for arg in run_mock.call_args.args[0] if arg.startswith("--query-gpu"))
        self.assertEqual(query, "--query-gpu=name,memory.total,memory.used")

    @patch("system_specs.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_none_when_smi_missing(self, _run_mock: MagicMock) -> None:
        self.assertIsNone(_gpu_from_nvidia_smi())


class TorchGpuTests(unittest.TestCase):
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


class SystemMemoryTests(unittest.TestCase):
    @patch("system_specs._gpu_info", return_value=(None, None, None, False))
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
