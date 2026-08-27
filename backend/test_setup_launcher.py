"""Windows bootstrap never calls a global interpreter; it downloads portable zips and forces TLS 1.2."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETUP_BAT = ROOT / "setup.bat"
SETUP_PS1 = ROOT / "setup.ps1"
START_BAT = ROOT / "start.bat"
START_PS1 = ROOT / "start.ps1"
DEV_COMMON = ROOT / "scripts" / "dev-common.ps1"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class SetupBatShimTests(unittest.TestCase):
    def test_setup_bat_exists(self) -> None:
        self.assertTrue(SETUP_BAT.is_file())

    def test_setup_bat_runs_setup_ps1_with_execution_policy_bypass(self) -> None:
        text = _read(SETUP_BAT)
        self.assertIn("ExecutionPolicy Bypass", text)
        self.assertIn("setup.ps1", text)
        self.assertIn("-File", text)

    def test_setup_bat_does_not_download_or_run_the_python_installer(self) -> None:
        text = _read(SETUP_BAT)
        self.assertNotIn("python-installer.exe", text)
        self.assertNotIn("python-%PY_VER%-amd64.exe", text)


class SetupPs1BootstrapTests(unittest.TestCase):
    def test_setup_ps1_exists(self) -> None:
        self.assertTrue(SETUP_PS1.is_file())

    def test_forces_tls12_before_any_download(self) -> None:
        text = _read(SETUP_PS1)
        self.assertIn("[Net.SecurityProtocolType]::Tls12", text)
        tls_at = text.index("[Net.SecurityProtocolType]::Tls12")
        download_at = min(
            at for token in ("Invoke-WebRequest", "curl.exe") if (at := text.find(token)) >= 0
        )
        self.assertLess(tls_at, download_at)

    def test_python_comes_from_the_nuget_zip_not_the_installer(self) -> None:
        text = _read(SETUP_PS1)
        self.assertIn("nuget.org", text)
        self.assertIn("package/{0}", text)
        self.assertIn("PythonPackage = 'python'", text)
        self.assertNotIn("python-installer.exe", text)
        self.assertNotIn("-amd64.exe", text)
        self.assertNotIn("/quiet", text)

    def test_node_comes_from_the_official_zip(self) -> None:
        text = _read(SETUP_PS1)
        self.assertIn("nodejs.org/dist/", text)
        self.assertIn("win-x64", text)
        self.assertIn(".zip", text)

    def test_never_invokes_python_or_npm_from_path(self) -> None:
        text = _read(SETUP_PS1)
        for line in text.splitlines():
            stripped = line.split("#", 1)[0].strip()
            if not stripped:
                continue
            self.assertIsNone(
                re.search(r"(^|[|&;])\s*python(\s|$|\.exe)", stripped),
                msg=f"setup.ps1 must not call PATH python: {line}",
            )
            self.assertIsNone(
                re.search(r"(^|[|&;])\s*npm(\s|$|\.cmd)", stripped),
                msg=f"setup.ps1 must not call PATH npm: {line}",
            )

    def test_creates_the_venv_with_the_downloaded_python(self) -> None:
        text = _read(SETUP_PS1)
        self.assertIn("-m venv", text)
        self.assertIn(".python", text)
        self.assertIn("backend\\.venv", text)

    def test_generates_frontend_types_after_installing_deps(self) -> None:
        text = _read(SETUP_PS1)
        gen_at = text.index("generate_types.py")
        pip_at = text.index("requirements.txt")
        npm_at = text.index("npm install")
        self.assertLess(pip_at, gen_at)
        self.assertLess(npm_at, gen_at)

    def test_prepends_local_python_and_node_to_path(self) -> None:
        text = _read(SETUP_PS1)
        self.assertIn(".python", text)
        self.assertIn(".node", text)
        self.assertRegex(text, r"\$env:PATH\s*=")


class StartLauncherBootstrapTests(unittest.TestCase):
    def test_start_bat_bypasses_execution_policy(self) -> None:
        text = _read(START_BAT)
        self.assertIn("ExecutionPolicy Bypass", text)
        self.assertIn("start.ps1", text)

    def test_npm_prefers_the_portable_copy_from_setup(self) -> None:
        text = _read(DEV_COMMON)
        start = text.index("function Get-NpmCommand")
        end = text.index("$DevGeneratedSources")
        body = text[start:end]
        self.assertIn(".node", body)
        self.assertIn("npm.cmd", body)

    def test_frontend_build_uses_the_portable_npm(self) -> None:
        text = _read(DEV_COMMON)
        self.assertIn("Get-NpmCommand", text)
        self.assertIn("run build", text)
        self.assertNotRegex(
            text,
            r"(^|[|&;])\s*&?\s*npm\.cmd\s+run\s+build",
        )

    def test_portable_npm_puts_node_on_path(self) -> None:
        text = _read(DEV_COMMON)
        start = text.index("function Get-NpmCommand")
        end = text.index("$DevGeneratedSources")
        body = text[start:end]
        self.assertIn(".node", body)
        self.assertIn("$env:PATH", body)

    def test_start_ps1_does_not_call_path_python(self) -> None:
        text = _read(START_PS1)
        self.assertIn("VenvPy", text)
        self.assertNotRegex(text, r"(^|[|&;])\s*python(\s|$)")


if __name__ == "__main__":
    unittest.main()
