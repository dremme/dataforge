"""Never reads the developer's project-root ``.env``; loads temp files via ``force=True``."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import env_file

_TEST_KEY = "DATAFORGE_ENV_FILE_TEST"


class EnvFileTests(unittest.TestCase):
    def setUp(self) -> None:
        env_file.reset_env_file_state_for_tests()
        self._had_test_key = _TEST_KEY in os.environ
        self._previous_test_value = os.environ.get(_TEST_KEY)
        os.environ.pop(_TEST_KEY, None)

    def tearDown(self) -> None:
        env_file.reset_env_file_state_for_tests()
        if self._had_test_key and self._previous_test_value is not None:
            os.environ[_TEST_KEY] = self._previous_test_value
        else:
            os.environ.pop(_TEST_KEY, None)

    def test_loads_temp_env_without_overriding_existing(self) -> None:
        with self._temp_env_file(f"{_TEST_KEY}=from-file\n") as env_path:
            with patch.object(env_file, "_ENV_CANDIDATES", (env_path,)):
                os.environ[_TEST_KEY] = "already-set"
                loaded = env_file.load_env_file(override=False, force=True)
                self.assertEqual(loaded, env_path)
                self.assertEqual(os.environ.get(_TEST_KEY), "already-set")

    def test_loads_temp_env_when_unset(self) -> None:
        with self._temp_env_file(f"{_TEST_KEY}=from-file\n") as env_path:
            with patch.object(env_file, "_ENV_CANDIDATES", (env_path,)):
                os.environ.pop(_TEST_KEY, None)
                loaded = env_file.load_env_file(override=False, force=True)
                self.assertEqual(loaded, env_path)
                self.assertEqual(os.environ.get(_TEST_KEY), "from-file")

    def test_returns_none_when_missing(self) -> None:
        missing = Path(__file__).resolve().parent / "does-not-exist.env"
        with patch.object(env_file, "_ENV_CANDIDATES", (missing,)):
            self.assertIsNone(env_file.load_env_file(override=False, force=True))

    def test_disabled_dotenv_skips_without_force(self) -> None:
        with self._temp_env_file(f"{_TEST_KEY}=from-file\n") as env_path:
            with patch.object(env_file, "_ENV_CANDIDATES", (env_path,)):
                with patch.dict(os.environ, {"DATAFORGE_DISABLE_DOTENV": "1"}, clear=False):
                    os.environ.pop(_TEST_KEY, None)
                    self.assertIsNone(env_file.load_env_file(override=False, force=False))
                    self.assertIsNone(os.environ.get(_TEST_KEY))

    def _temp_env_file(self, content: str):
        class _Ctx:
            def __enter__(self_nonlocal) -> Path:
                self_nonlocal._tmp = TemporaryDirectory()
                path = Path(self_nonlocal._tmp.name) / ".env"
                path.write_text(content, encoding="utf-8")
                return path

            def __exit__(self_nonlocal, *args: object) -> None:
                self_nonlocal._tmp.cleanup()

        return _Ctx()


if __name__ == "__main__":
    unittest.main()
