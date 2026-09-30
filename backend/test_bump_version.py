from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
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


class AmendsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.aliases: dict[str, str] = {}

    def _amends(self, command: str) -> bool:
        return _load_bump_version().amends(command.split(), self.aliases.get)

    def test_a_plain_commit_does_not_amend(self) -> None:
        self.assertFalse(self._amends("commit -m sample"))

    def test_detects_amend_after_global_options(self) -> None:
        self.assertTrue(self._amends("-c core.editor=true -C backend commit --amend"))

    def test_the_last_amend_flag_wins(self) -> None:
        self.assertFalse(self._amends("commit --amend --no-amend"))

    def test_ignores_amend_after_the_pathspec_separator(self) -> None:
        self.assertFalse(self._amends("commit -- --amend"))

    def test_other_subcommands_do_not_amend(self) -> None:
        self.assertFalse(self._amends("rebase --amend"))

    def test_expands_aliases(self) -> None:
        self.aliases = {"fix": "amend-quietly", "amend-quietly": "commit --amend --no-edit"}

        self.assertTrue(self._amends("fix"))

    def test_shell_aliases_do_not_amend(self) -> None:
        self.aliases = {"fix": "!git commit --amend"}

        self.assertFalse(self._amends("fix"))

    def test_self_referencing_aliases_do_not_amend(self) -> None:
        self.aliases = {"loop": "loop --amend"}

        self.assertFalse(self._amends("loop"))


class RealPyprojectTests(unittest.TestCase):
    def test_finds_the_project_version_line(self) -> None:
        bump = _load_bump_version()
        content = (ROOT / bump.PYPROJECT).read_bytes()

        self.assertRegex(bump.project_version(content), r"^\d+\.\d+\.\d+$")


class _SampleRepoTestCase(unittest.TestCase):
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

    def _set_version(self, version: str) -> None:
        self.pyproject.write_bytes(PYPROJECT.replace("0.1.0", version).encode())

    def _staged_pyproject(self) -> str:
        return self._git("show", ":backend/pyproject.toml")


class PreCommitBumpTests(_SampleRepoTestCase):
    def _bump(self, *, amending: bool = False) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            self.bump.bump(self.repo, amending=amending)

    def test_bumps_the_staged_and_working_tree_version(self) -> None:
        self._commit_initial()
        self._stage_change()

        self._bump()

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
        self._set_version("0.2.0")
        self._git("add", "backend/pyproject.toml")

        self._bump()

        self.assertIn('version = "0.2.0"', self._staged_pyproject())
        self.assertIn('version = "0.2.0"', self.pyproject.read_text())

    def test_keeps_an_unstaged_hand_edited_version_in_the_working_tree(self) -> None:
        self._commit_initial()
        self._stage_change()
        self._set_version("0.2.0")

        self._bump()

        self.assertIn('version = "0.1.1"', self._staged_pyproject())
        self.assertIn('version = "0.2.0"', self.pyproject.read_text())

    def test_amending_compares_against_the_parent_of_head(self) -> None:
        self._commit_initial()
        self._set_version("0.2.0")
        self._git("commit", "--quiet", "-am", "Hand bump")
        self._stage_change()

        self._bump(amending=True)

        self.assertIn('version = "0.2.0"', self._staged_pyproject())

    def test_amending_a_root_commit_does_nothing(self) -> None:
        self._commit_initial()
        self._stage_change()

        self._bump(amending=True)

        self.assertIn('version = "0.1.0"', self._staged_pyproject())

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

        self._bump()

        self.assertIn('version = "0.1.0"', self._staged_pyproject())


class CommitHookTests(_SampleRepoTestCase):
    def setUp(self) -> None:
        super().setUp()
        script = self.repo / "scripts" / "bump_version.py"
        script.parent.mkdir()
        script.write_bytes(BUMP_VERSION_PATH.read_bytes())
        (self.repo / ".githooks").mkdir()
        for hook_name in ("pre-commit", "post-commit"):
            self._install_hook(hook_name)
        self._git("config", "core.hooksPath", ".githooks")
        self._commit_initial()

    def _install_hook(self, name: str) -> None:
        hook = self.repo / ".githooks" / name
        python = Path(sys.executable).as_posix()
        hook.write_text(f'#!/bin/sh\nexec "{python}" scripts/bump_version.py {name}\n')
        os.chmod(hook, 0o755)

    def _commit(self, *args: str) -> None:
        self._stage_change()
        self._git("commit", "--quiet", "-m", "Change", *args)

    def _head_version(self) -> str:
        return self.bump.project_version(self._git("show", "HEAD:backend/pyproject.toml").encode())

    def test_a_commit_bumps_the_version(self) -> None:
        self._commit()

        self.assertEqual(self._head_version(), "0.1.1")

    def test_amending_an_auto_bumped_commit_does_not_bump_again(self) -> None:
        self._commit()

        self._commit("--amend")

        self.assertEqual(self._head_version(), "0.1.1")

    def test_amending_a_hand_bumped_commit_keeps_its_version(self) -> None:
        self._set_version("0.2.0")
        self._git("add", "backend/pyproject.toml")
        self._commit()

        self._commit("--amend")

        self.assertEqual(self._head_version(), "0.2.0")

    def test_amending_through_an_alias_does_not_bump_again(self) -> None:
        self._git("config", "alias.fix", "commit --amend --no-edit")
        self._commit()
        (self.repo / "notes.txt").write_text("vehicle\n")
        self._git("add", "notes.txt")

        self._git("fix", "--quiet")

        self.assertEqual(self._head_version(), "0.1.1")

    def test_committing_named_paths_stages_the_bumped_version(self) -> None:
        self._commit("notes.txt")

        self.assertEqual(self._head_version(), "0.1.1")
        self.assertIn('version = "0.1.1"', self._staged_pyproject())
        self.assertEqual(self._git("status", "--porcelain"), "")

    def test_committing_named_paths_keeps_other_staged_edits_to_the_file(self) -> None:
        self.pyproject.write_bytes(f"{PYPROJECT}\n[tool.sample]\nenabled = true\n".encode())
        self._git("add", "backend/pyproject.toml")

        self._commit("notes.txt")

        self.assertNotIn("enabled", self._git("show", "HEAD:backend/pyproject.toml"))
        self.assertIn('version = "0.1.1"', self._staged_pyproject())
        self.assertIn("enabled = true", self._staged_pyproject())

    def test_a_commit_without_a_bump_leaves_the_staged_version_alone(self) -> None:
        self._set_version("0.2.0")
        self._git("add", "backend/pyproject.toml")

        self._commit("--no-verify", "notes.txt")

        self.assertEqual(self._head_version(), "0.1.0")
        self.assertIn('version = "0.2.0"', self._staged_pyproject())


if __name__ == "__main__":
    unittest.main()
