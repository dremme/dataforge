from __future__ import annotations

import contextlib
import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
BUMP_VERSION_PATH = ROOT / "scripts" / "bump_version.py"

PYPROJECT = """[project]
name = "sample"
version = "0.1.0"

[tool.ruff]
target-version = "py312"
"""


def _load_bump_version() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dataforge_bump_version", BUMP_VERSION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {BUMP_VERSION_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BumpedTests(unittest.TestCase):
    def test_increments_the_patch_numerically(self) -> None:
        self.assertEqual(_load_bump_version().bumped("0.1.9"), "0.1.10")


class RealPyprojectTests(unittest.TestCase):
    def test_finds_the_project_version_line(self) -> None:
        bump = _load_bump_version()
        content = (ROOT / bump.PYPROJECT).read_bytes()

        self.assertRegex(bump.project_version(content), r"^\d+\.\d+\.\d+$")


class PreCommitBumpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bump = _load_bump_version()

    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.pyproject = self.repo / "backend" / "pyproject.toml"
        self.pyproject.parent.mkdir()
        self._git("init", "--quiet")
        self._git("config", "core.autocrlf", "false")

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-c", "user.name=Sample", "-c", "user.email=sample@example.com", *args],
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def _commit_initial(self, content: str = PYPROJECT) -> None:
        self.pyproject.write_bytes(content.encode())
        self._git("add", ".")
        self._git("commit", "--quiet", "-m", "Initial")

    def _stage_change(self) -> None:
        (self.repo / "notes.txt").write_text("landscape\n")
        self._git("add", "notes.txt")

    def _bump(self) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return self.bump.main(self.repo)

    def _staged_pyproject(self) -> str:
        return self._git("show", ":backend/pyproject.toml")

    def test_bumps_the_staged_and_working_tree_version(self) -> None:
        self._commit_initial()
        self._stage_change()

        self.assertEqual(self._bump(), 0)

        self.assertIn('version = "0.1.1"', self._staged_pyproject())
        self.assertIn('version = "0.1.1"', self.pyproject.read_text())
        self.assertIn('target-version = "py312"', self._staged_pyproject())

    def test_leaves_unstaged_edits_to_the_file_unstaged(self) -> None:
        self._commit_initial()
        self._stage_change()
        self.pyproject.write_bytes(f"{PYPROJECT}\n[tool.sample]\nenabled = true\n".encode())

        self._bump()

        staged = self._git("diff", "--cached", "backend/pyproject.toml")
        self.assertIn('+version = "0.1.1"', staged)
        self.assertNotIn("enabled", staged)
        unstaged = self._git("diff", "backend/pyproject.toml")
        self.assertIn("+enabled = true", unstaged)
        self.assertNotIn('\n+version = "', unstaged)
        self.assertNotIn('\n-version = "', unstaged)

    def test_a_retried_commit_does_not_bump_twice(self) -> None:
        self._commit_initial()
        self._stage_change()

        self._bump()
        self._bump()

        self.assertIn('version = "0.1.1"', self._staged_pyproject())
        self.assertIn('version = "0.1.1"', self.pyproject.read_text())

    def test_keeps_a_hand_staged_version(self) -> None:
        self._commit_initial()
        self.pyproject.write_bytes(PYPROJECT.replace("0.1.0", "0.2.0").encode())
        self._git("add", "backend/pyproject.toml")

        self._bump()

        self.assertIn('version = "0.2.0"', self._staged_pyproject())
        self.assertIn('version = "0.2.0"', self.pyproject.read_text())

    def test_preserves_crlf_line_endings_in_the_working_tree(self) -> None:
        self._commit_initial(PYPROJECT.replace("\n", "\r\n"))
        self._stage_change()

        self._bump()

        self.assertEqual(
            self.pyproject.read_bytes(),
            PYPROJECT.replace("0.1.0", "0.1.1").replace("\n", "\r\n").encode(),
        )

    def test_does_nothing_before_the_first_commit(self) -> None:
        self.pyproject.write_bytes(PYPROJECT.encode())
        self._git("add", ".")

        self.assertEqual(self._bump(), 0)

        self.assertIn('version = "0.1.0"', self._staged_pyproject())


if __name__ == "__main__":
    unittest.main()
