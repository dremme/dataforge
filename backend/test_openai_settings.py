"""Tests for openai_settings."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from openai_settings import (
    DEFAULT_INSTRUCT_PRESENCE_PENALTY,
    DEFAULT_INSTRUCT_TEMPERATURE,
    DEFAULT_INSTRUCT_TOP_P,
    DEFAULT_MAX_TOKENS,
    DEFAULT_OPENAI_API_KEY,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    DEFAULT_THINKING_PRESENCE_PENALTY,
    DEFAULT_THINKING_TEMPERATURE,
    DEFAULT_THINKING_TOP_P,
    DEFAULT_TOP_K,
    create_openai_client,
    get_instruct_presence_penalty,
    get_instruct_temperature,
    get_instruct_top_p,
    get_max_tokens,
    get_openai_api_key,
    get_openai_base_url,
    get_openai_model,
    get_thinking_presence_penalty,
    get_thinking_temperature,
    get_thinking_top_p,
    get_top_k,
)


class OpenAISettingsTests(unittest.TestCase):
    def test_defaults_when_env_unset(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_openai_base_url(), DEFAULT_OPENAI_BASE_URL)
            self.assertEqual(get_openai_api_key(), DEFAULT_OPENAI_API_KEY)
            self.assertEqual(get_openai_model(), DEFAULT_OPENAI_MODEL)
            self.assertEqual(get_max_tokens(), DEFAULT_MAX_TOKENS)
            self.assertEqual(get_thinking_temperature(), DEFAULT_THINKING_TEMPERATURE)
            self.assertEqual(get_thinking_presence_penalty(), DEFAULT_THINKING_PRESENCE_PENALTY)
            self.assertEqual(get_thinking_top_p(), DEFAULT_THINKING_TOP_P)
            self.assertEqual(get_instruct_temperature(), DEFAULT_INSTRUCT_TEMPERATURE)
            self.assertEqual(get_instruct_presence_penalty(), DEFAULT_INSTRUCT_PRESENCE_PENALTY)
            self.assertEqual(get_instruct_top_p(), DEFAULT_INSTRUCT_TOP_P)
            self.assertEqual(get_top_k(), DEFAULT_TOP_K)

    def test_reads_environment_overrides(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_BASE_URL": "http://localhost:9999/v1",
                "OPENAI_API_KEY": "test-key",
                "OPENAI_MODEL": "my-vision-model",
                "OPENAI_MAX_TOKENS": "2048",
                "OPENAI_THINKING_TEMPERATURE": "0.5",
                "OPENAI_THINKING_PRESENCE_PENALTY": "0.25",
                "OPENAI_THINKING_TOP_P": "0.9",
                "OPENAI_INSTRUCT_TEMPERATURE": "0.2",
                "OPENAI_INSTRUCT_PRESENCE_PENALTY": "1.0",
                "OPENAI_INSTRUCT_TOP_P": "0.75",
                "OPENAI_TOP_K": "40",
            },
            clear=True,
        ):
            self.assertEqual(get_openai_base_url(), "http://localhost:9999/v1")
            self.assertEqual(get_openai_api_key(), "test-key")
            self.assertEqual(get_openai_model(), "my-vision-model")
            self.assertEqual(get_max_tokens(), 2048)
            self.assertEqual(get_thinking_temperature(), 0.5)
            self.assertEqual(get_thinking_presence_penalty(), 0.25)
            self.assertEqual(get_thinking_top_p(), 0.9)
            self.assertEqual(get_instruct_temperature(), 0.2)
            self.assertEqual(get_instruct_presence_penalty(), 1.0)
            self.assertEqual(get_instruct_top_p(), 0.75)
            self.assertEqual(get_top_k(), 40)

    def test_blank_or_invalid_env_values_fall_back_to_defaults(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_BASE_URL": "   ",
                "OPENAI_API_KEY": "",
                "OPENAI_MODEL": "\t",
                "OPENAI_MAX_TOKENS": "not-a-number",
                "OPENAI_THINKING_TEMPERATURE": "",
                "OPENAI_TOP_K": "  ",
            },
            clear=True,
        ):
            self.assertEqual(get_openai_base_url(), DEFAULT_OPENAI_BASE_URL)
            self.assertEqual(get_openai_api_key(), DEFAULT_OPENAI_API_KEY)
            self.assertEqual(get_openai_model(), DEFAULT_OPENAI_MODEL)
            self.assertEqual(get_max_tokens(), DEFAULT_MAX_TOKENS)
            self.assertEqual(get_thinking_temperature(), DEFAULT_THINKING_TEMPERATURE)
            self.assertEqual(get_top_k(), DEFAULT_TOP_K)

    def test_create_openai_client_uses_resolved_settings(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "OPENAI_API_BASE_URL": "http://example.local/v1",
                    "OPENAI_API_KEY": "secret",
                },
                clear=True,
            ),
            patch("openai.OpenAI") as openai_cls,
        ):
            create_openai_client()
            openai_cls.assert_called_once_with(
                base_url="http://example.local/v1",
                api_key="secret",
            )


if __name__ == "__main__":
    unittest.main()
