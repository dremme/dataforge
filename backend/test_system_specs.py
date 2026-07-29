"""Unit tests for system_specs GPU parsing helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from system_specs import _gpu_from_nvidia_smi, _gpu_from_torch


class NvidiaSmiGpuTests(unittest.TestCase):
    @patch("system_specs.subprocess.run")
    def test_parses_name_total_used_and_free(self, run_mock: MagicMock) -> None:
        run_mock.return_value = MagicMock(
            returncode=0,
            stdout="NVIDIA GeForce RTX 4090, 24564, 8192, 16372\n",
        )

        info = _gpu_from_nvidia_smi()

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "NVIDIA GeForce RTX 4090")
        self.assertEqual(info.memory_total_bytes, (24564 * 1024 * 1024))
        self.assertEqual(info.memory_used_bytes, (8192 * 1024 * 1024))
        self.assertEqual(info.memory_available_bytes, (16372 * 1024 * 1024))

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
        self.assertEqual(info.memory_used_bytes, 5 * 1024**3)
        self.assertEqual(info.memory_available_bytes, 3 * 1024**3)


if __name__ == "__main__":
    unittest.main()
