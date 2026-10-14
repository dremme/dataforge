from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "dataforge_setup_tagging", ROOT / "scripts" / "setup_tagging.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load the tagging setup script")
setup_tagging = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = setup_tagging
spec.loader.exec_module(setup_tagging)


class DriverCudaTests(unittest.TestCase):
    def test_reads_the_older_and_the_newer_nvidia_smi_header(self) -> None:
        older = "| NVIDIA-SMI 571.96   Driver Version: 571.96   CUDA Version: 12.8     |"
        newer = "| NVIDIA-SMI 617.42   KMD Version: 617.42   CUDA UMD Version: 13.4     |"

        self.assertEqual(setup_tagging.parse_driver_cuda(older), (12, 8))
        self.assertEqual(setup_tagging.parse_driver_cuda(newer), (13, 4))

    def test_no_version_without_a_header(self) -> None:
        self.assertIsNone(setup_tagging.parse_driver_cuda("NVIDIA-SMI has failed"))


class ChooseBuildTests(unittest.TestCase):
    def choose(self, cuda=None, *, system="Windows", machine="AMD64", rocm=False):
        return setup_tagging.choose_build(system, machine, cuda, rocm)

    def test_takes_the_newest_cuda_build_the_driver_runs(self) -> None:
        self.assertEqual(self.choose((13, 4)), "cu130")
        self.assertEqual(self.choose((12, 9)), "cu128")
        self.assertEqual(self.choose((12, 6)), "cu126")

    def test_a_driver_too_old_for_any_build_gets_the_cpu_build(self) -> None:
        self.assertEqual(self.choose((12, 4)), "cpu")

    def test_rocm_only_on_linux_x86_64(self) -> None:
        self.assertEqual(self.choose(system="Linux", machine="x86_64", rocm=True), "rocm7.1")
        self.assertEqual(self.choose(system="Linux", machine="aarch64", rocm=True), "cpu")
        self.assertEqual(self.choose(rocm=True), "cpu")

    def test_macos_uses_the_default_index(self) -> None:
        self.assertIsNone(self.choose(system="Darwin", machine="arm64"))

    def test_no_gpu_gets_the_cpu_build(self) -> None:
        self.assertEqual(self.choose(), "cpu")
        self.assertEqual(self.choose(system="Linux", machine="x86_64"), "cpu")


class TorchFitsTests(unittest.TestCase):
    version = setup_tagging.TORCH_VERSION

    def test_the_chosen_build_at_the_pinned_version_stays(self) -> None:
        self.assertTrue(setup_tagging.torch_fits(f"{self.version}+cu130", "cu130", (13, 4)))
        self.assertTrue(setup_tagging.torch_fits(f"{self.version}+cpu", "cpu", None))

    def test_an_older_cuda_build_the_driver_runs_stays(self) -> None:
        self.assertTrue(setup_tagging.torch_fits(f"{self.version}+cu128", "cu130", (13, 4)))

    def test_another_version_or_a_cpu_build_beside_a_gpu_is_replaced(self) -> None:
        self.assertFalse(setup_tagging.torch_fits("2.10.0+cu130", "cu130", (13, 4)))
        self.assertFalse(setup_tagging.torch_fits(f"{self.version}+cpu", "cu130", (13, 4)))
        self.assertFalse(setup_tagging.torch_fits(None, "cpu", None))

    def test_a_cuda_build_without_a_driver_is_replaced(self) -> None:
        self.assertFalse(setup_tagging.torch_fits(f"{self.version}+cu128", "cpu", None))

    def test_macos_keeps_any_build_at_the_pinned_version(self) -> None:
        self.assertTrue(setup_tagging.torch_fits(self.version, None, None))


if __name__ == "__main__":
    unittest.main()
