from __future__ import annotations

import importlib.util
import io
import subprocess
import sys
import tomllib
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "dataforge_py_version", ROOT / "scripts" / "py_version.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load the Python version guard")
py_version = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = py_version
spec.loader.exec_module(py_version)


class PythonRuntimeVersionTests(unittest.TestCase):
    def test_accepts_any_final_3_13_patch_release(self) -> None:
        for patch_version in (0, 11, 12, 13, 99):
            with (
                self.subTest(patch=patch_version),
                patch.object(py_version.sys, "version_info", (3, 13, patch_version, "final", 0)),
            ):
                py_version.require_python()

    def test_rejects_other_release_series_and_prereleases(self) -> None:
        for version in (
            (3, 12, 6, "final", 0),
            (3, 14, 0, "final", 0),
            (3, 13, 12, "candidate", 1),
        ):
            with self.subTest(version=version):
                stderr = io.StringIO()
                with (
                    patch.object(py_version.sys, "version_info", version),
                    redirect_stderr(stderr),
                    self.assertRaises(SystemExit) as failure,
                ):
                    py_version.require_python()
                self.assertEqual(failure.exception.code, 1)
                self.assertIn("requires Python 3.13.x", stderr.getvalue())

    def test_direct_backend_start_rejects_an_incompatible_interpreter_before_app_imports(
        self,
    ) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import runpy, sys; sys.version_info = (3, 12, 6, 'final', 0); "
                "runpy.run_path('main.py', run_name='__main__')",
            ],
            cwd=ROOT / "backend",
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires Python 3.13.x", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


class PythonConfigurationPinTests(unittest.TestCase):
    def test_ci_has_one_backend_runner_and_every_job_reads_the_shared_pin(self) -> None:
        workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "checks.yml").read_text())
        self.assertNotIn("strategy", workflow["jobs"]["backend"])
        for name, job in workflow["jobs"].items():
            with self.subTest(job=name):
                setup = [
                    step
                    for step in job["steps"]
                    if step.get("uses", "").startswith("actions/setup-python@")
                ]
                self.assertEqual(len(setup), 1)
                self.assertEqual(setup[0]["with"]["python-version-file"], ".python-version")
                self.assertNotIn("python-version", setup[0]["with"])

    def test_project_metadata_and_tools_match_the_shared_python_pin(self) -> None:
        pinned = (ROOT / ".python-version").read_text().strip()
        self.assertRegex(pinned, r"^3\.13\.\d+$")
        project = tomllib.loads((ROOT / "backend" / "pyproject.toml").read_text())
        self.assertEqual(project["project"]["requires-python"], ">=3.13,<3.14")
        self.assertEqual(project["tool"]["ruff"]["target-version"], "py313")
        self.assertEqual(project["tool"]["ty"]["environment"]["python-version"], "3.13")

    def test_setup_scripts_read_the_pin_and_validate_the_actual_interpreter(self) -> None:
        windows = (ROOT / "setup.ps1").read_text()
        unix = (ROOT / "setup.sh").read_text()
        for setup in (windows, unix):
            self.assertIn(".python-version", setup)
            self.assertIn("py_version.py", setup)
        self.assertIn("Test-PythonVersion -File $PyExe -Exact", windows)
        self.assertIn("Test-PythonVersion -File $VenvPy", windows)
        self.assertNotIn("Test-StampMatches -File $PyStampFile", windows)
        self.assertNotIn("now marked", windows)
        self.assertIn('python_matches_pin "$DATAFORGE_PYTHON"', unix)
        self.assertIn('python_matches_pin "$DEV_VENV_PY"', unix)


if __name__ == "__main__":
    unittest.main()
