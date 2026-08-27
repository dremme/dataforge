from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from openai_settings import (
    CONNECT_TIMEOUT_SECONDS,
    DEFAULT_MAX_TOKENS,
    DEFAULT_OPENAI_API_KEY,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_TOP_K,
    INSTRUCT_DEFAULTS,
    NEUTRAL_REPEAT_PENALTY,
    THINKING_DEFAULTS,
    SamplingProfile,
    assistant_message_text,
    build_sampling_extra_body,
    create_openai_client,
    get_max_tokens,
    get_openai_api_key,
    get_openai_base_url,
    get_openai_model,
    get_openai_timeout,
    get_sampling_profile,
    get_top_k,
)


class OpenAISettingsTests(unittest.TestCase):
    def test_defaults_when_env_unset(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_openai_base_url(), DEFAULT_OPENAI_BASE_URL)
            self.assertEqual(get_openai_api_key(), DEFAULT_OPENAI_API_KEY)
            self.assertEqual(get_openai_model(), DEFAULT_OPENAI_MODEL)
            self.assertEqual(get_max_tokens(), DEFAULT_MAX_TOKENS)
            self.assertEqual(get_top_k(), DEFAULT_TOP_K)
            self.assertEqual(get_sampling_profile("thinking"), THINKING_DEFAULTS)
            self.assertEqual(get_sampling_profile("instruct"), INSTRUCT_DEFAULTS)

    def test_unknown_mode_falls_back_to_the_thinking_profile(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_sampling_profile("unsupported"), THINKING_DEFAULTS)

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
                "OPENAI_THINKING_MIN_P": "0.05",
                "OPENAI_INSTRUCT_TEMPERATURE": "0.2",
                "OPENAI_INSTRUCT_PRESENCE_PENALTY": "1.0",
                "OPENAI_INSTRUCT_TOP_P": "0.75",
                "OPENAI_INSTRUCT_MIN_P": "0.1",
                "OPENAI_THINKING_REPEAT_PENALTY": "1.05",
                "OPENAI_INSTRUCT_REPEAT_PENALTY": "1.15",
                "OPENAI_TOP_K": "40",
            },
            clear=True,
        ):
            self.assertEqual(get_openai_base_url(), "http://localhost:9999/v1")
            self.assertEqual(get_openai_api_key(), "test-key")
            self.assertEqual(get_openai_model(), "my-vision-model")
            self.assertEqual(get_max_tokens(), 2048)
            self.assertEqual(get_top_k(), 40)
            self.assertEqual(
                get_sampling_profile("thinking"),
                SamplingProfile(
                    temperature=0.5,
                    presence_penalty=0.25,
                    top_p=0.9,
                    min_p=0.05,
                    repeat_penalty=1.05,
                ),
            )
            self.assertEqual(
                get_sampling_profile("instruct"),
                SamplingProfile(
                    temperature=0.2,
                    presence_penalty=1.0,
                    top_p=0.75,
                    min_p=0.1,
                    repeat_penalty=1.15,
                ),
            )

    def test_blank_or_invalid_env_values_fall_back_to_defaults(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_BASE_URL": "   ",
                "OPENAI_API_KEY": "",
                "OPENAI_MODEL": "\t",
                "OPENAI_MAX_TOKENS": "not-a-number",
                "OPENAI_THINKING_TEMPERATURE": "",
                "OPENAI_INSTRUCT_TOP_P": "not-a-number",
                "OPENAI_TOP_K": "  ",
            },
            clear=True,
        ):
            self.assertEqual(get_openai_base_url(), DEFAULT_OPENAI_BASE_URL)
            self.assertEqual(get_openai_api_key(), DEFAULT_OPENAI_API_KEY)
            self.assertEqual(get_openai_model(), DEFAULT_OPENAI_MODEL)
            self.assertEqual(get_max_tokens(), DEFAULT_MAX_TOKENS)
            self.assertEqual(get_top_k(), DEFAULT_TOP_K)
            self.assertEqual(
                get_sampling_profile("thinking").temperature,
                THINKING_DEFAULTS.temperature,
            )
            self.assertEqual(get_sampling_profile("instruct").top_p, INSTRUCT_DEFAULTS.top_p)

    def test_extra_body_omits_repeat_penalty_at_the_neutral_value(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            for mode in ("thinking", "instruct"):
                extra = build_sampling_extra_body(mode)
                self.assertNotIn("repeat_penalty", extra, mode)
                self.assertEqual(extra["top_k"], DEFAULT_TOP_K)
                self.assertIn("min_p", extra)

    def test_extra_body_includes_configured_repeat_penalty_per_mode(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENAI_THINKING_REPEAT_PENALTY": "1.1",
                "OPENAI_INSTRUCT_REPEAT_PENALTY": "1.2",
            },
            clear=True,
        ):
            self.assertEqual(build_sampling_extra_body("thinking")["repeat_penalty"], 1.1)
            self.assertEqual(build_sampling_extra_body("instruct")["repeat_penalty"], 1.2)

    def test_extra_body_disables_thinking_only_for_instruct(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                build_sampling_extra_body("instruct")["chat_template_kwargs"],
                {"enable_thinking": False},
            )
            # Instruct has no reasoning to size, so the effort keys stay out entirely.
            self.assertNotIn("reasoning_effort", build_sampling_extra_body("instruct"))

    def test_thinking_sends_reasoning_defaults_both_ways(self) -> None:
        # Sent even at the default: the template falls back to xhigh, so omitting the
        # key would quietly ignore the medium DataForge picks.
        with patch.dict(os.environ, {}, clear=True):
            extra = build_sampling_extra_body("thinking")
            self.assertEqual(
                extra["chat_template_kwargs"],
                {
                    "reasoning_effort": DEFAULT_REASONING_EFFORT,
                    "preserve_thinking": DEFAULT_PRESERVE_THINKING,
                },
            )
            self.assertEqual(extra["reasoning_effort"], DEFAULT_REASONING_EFFORT)

    def test_thinking_carries_each_supported_effort(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            for effort in ("low", "medium", "xhigh"):
                extra = build_sampling_extra_body("thinking", effort=effort)
                kwargs = extra["chat_template_kwargs"]
                assert isinstance(kwargs, dict)
                self.assertEqual(kwargs["reasoning_effort"], effort)
                self.assertEqual(extra["reasoning_effort"], effort)

    def test_thinking_carries_preserve_thinking_off(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            kwargs = build_sampling_extra_body("thinking", preserve_thinking=False)[
                "chat_template_kwargs"
            ]
            assert isinstance(kwargs, dict)
            self.assertIs(kwargs["preserve_thinking"], False)
            self.assertEqual(kwargs["reasoning_effort"], DEFAULT_REASONING_EFFORT)

    def test_neutral_repeat_penalty_is_explicitly_omitted(self) -> None:
        with patch.dict(
            os.environ,
            {"OPENAI_INSTRUCT_REPEAT_PENALTY": str(NEUTRAL_REPEAT_PENALTY)},
            clear=True,
        ):
            self.assertNotIn("repeat_penalty", build_sampling_extra_body("instruct"))

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

            kwargs = openai_cls.call_args.kwargs
            self.assertEqual(kwargs["base_url"], "http://example.local/v1")
            self.assertEqual(kwargs["api_key"], "secret")
            self.assertEqual(kwargs["timeout"].read, DEFAULT_TIMEOUT_SECONDS)
            self.assertEqual(kwargs["timeout"].connect, CONNECT_TIMEOUT_SECONDS)

    def test_create_openai_client_leaves_retrying_to_the_job_layer(self) -> None:
        """The SDK default of 2 would turn each attempt into three requests."""
        with patch.dict(os.environ, {}, clear=True), patch("openai.OpenAI") as openai_cls:
            create_openai_client()

            self.assertEqual(openai_cls.call_args.kwargs["max_retries"], 0)

    def test_default_timeout_stays_generous_for_slow_local_models(self) -> None:
        """Must stay at least the SDK default; tightening it fails long thinking-mode runs as api_error."""
        self.assertGreaterEqual(DEFAULT_TIMEOUT_SECONDS, 600.0)

    def test_openai_timeout_is_configurable(self) -> None:
        with patch.dict(os.environ, {"OPENAI_TIMEOUT": "120"}, clear=True):
            self.assertEqual(get_openai_timeout(), 120.0)

    def test_openai_timeout_falls_back_when_unusable(self) -> None:
        for raw in ("", "not-a-number", "0", "-30"):
            with patch.dict(os.environ, {"OPENAI_TIMEOUT": raw}, clear=True):
                self.assertEqual(get_openai_timeout(), DEFAULT_TIMEOUT_SECONDS)

    def test_assistant_message_text(self) -> None:
        both = type("M", (), {"content": " final ", "reasoning_content": "cot"})()
        empty_content = type("M", (), {"content": "", "reasoning_content": "answer"})()
        as_dict = {"content": None, "reasoning_content": " from dict "}

        self.assertEqual(assistant_message_text(both), "final")
        self.assertEqual(assistant_message_text(both, allow_reasoning_fallback=True), "final")
        self.assertEqual(assistant_message_text(empty_content), "")
        self.assertEqual(
            assistant_message_text(empty_content, allow_reasoning_fallback=True),
            "answer",
        )
        self.assertEqual(assistant_message_text(as_dict), "")
        self.assertEqual(
            assistant_message_text(as_dict, allow_reasoning_fallback=True),
            "from dict",
        )


if __name__ == "__main__":
    unittest.main()
