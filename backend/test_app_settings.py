from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from app_settings import (
    APP_SETTINGS_KEY,
    InvalidSettingError,
    describe_app_settings,
    effective_settings,
    load_saved_settings,
    update_app_settings,
)
from automation.auto_caption import get_draft_caption_threshold
from automation.vision import get_image_max_pixels, get_max_video_keyframes
from comfy_settings import get_comfy_base_url
from db import set_preference
from external.ostris_jobs import get_ostris_base_url
from openai_settings import (
    get_max_tokens,
    get_openai_api_key,
    get_openai_base_url,
    get_openai_model,
    get_openai_timeout,
    get_sampling_profile,
    get_top_k,
)
from schemas import AppSettingsUpdate
from testing_fixtures import forget_saved_settings, isolate_test_database
from thumbnails import get_thumbnail_cache_budget_bytes

isolate_test_database()


class PrecedenceTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_the_default_applies_when_nothing_is_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            state = describe_app_settings().comfy_base_url

        self.assertEqual(state.value, "http://127.0.0.1:9000")
        self.assertEqual(state.source, "default")
        self.assertEqual(state.fallback, "http://127.0.0.1:9000")

    def test_the_environment_outranks_the_default(self) -> None:
        with patch.dict(os.environ, {"COMFY_BASE_URL": "http://gpu-box:8188"}, clear=True):
            state = describe_app_settings().comfy_base_url

        self.assertEqual(state.value, "http://gpu-box:8188")
        self.assertEqual(state.source, "env")

    def test_a_saved_value_outranks_the_environment(self) -> None:
        update_app_settings(AppSettingsUpdate(comfy_base_url="http://127.0.0.1:9100"))

        with patch.dict(os.environ, {"COMFY_BASE_URL": "http://gpu-box:8188"}, clear=True):
            state = describe_app_settings().comfy_base_url
            self.assertEqual(get_comfy_base_url(), "http://127.0.0.1:9100")

        self.assertEqual(state.value, "http://127.0.0.1:9100")
        self.assertEqual(state.source, "saved")
        self.assertEqual(state.fallback, "http://gpu-box:8188")
        self.assertEqual(state.fallback_source, "env")

    def test_a_reset_falls_back_to_the_environment(self) -> None:
        update_app_settings(AppSettingsUpdate(comfy_base_url="http://127.0.0.1:9100"))
        update_app_settings(AppSettingsUpdate(reset=["comfy_base_url"]))

        with patch.dict(os.environ, {"COMFY_BASE_URL": "http://gpu-box:8188"}, clear=True):
            self.assertEqual(get_comfy_base_url(), "http://gpu-box:8188")

    def test_a_value_in_the_same_update_as_its_reset_is_saved(self) -> None:
        update_app_settings(
            AppSettingsUpdate(vision_model="model-b", reset=["vision_model"]),
        )

        self.assertEqual(effective_settings().vision_model, "model-b")

    def test_saved_values_survive_a_restart(self) -> None:
        update_app_settings(AppSettingsUpdate(draft_caption_threshold=512))

        load_saved_settings()

        self.assertEqual(effective_settings().draft_caption_threshold, 512)

    def test_an_unusable_environment_value_falls_back_to_the_default(self) -> None:
        with patch.dict(
            os.environ,
            {"COMFY_BASE_URL": "gpu-box:8188", "DATAFORGE_THUMBNAIL_CACHE_MAX_MB": "-5"},
            clear=True,
        ):
            settings = describe_app_settings()

        self.assertEqual(settings.comfy_base_url.source, "default")
        self.assertEqual(settings.thumbnail_cache_max_mb.value, 2048)


class ValidationTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_urls_lose_their_trailing_slash(self) -> None:
        settings = update_app_settings(
            AppSettingsUpdate(vision_base_url="http://127.0.0.1:8890/v1/")
        )

        self.assertEqual(settings.vision_base_url.value, "http://127.0.0.1:8890/v1")

    def test_unusable_urls_are_refused(self) -> None:
        for url in ("127.0.0.1:9000", "ftp://127.0.0.1:9000", "http://", "http://127.0.0.1:70000"):
            with self.subTest(url=url), self.assertRaises(InvalidSettingError):
                update_app_settings(AppSettingsUpdate(comfy_base_url=url))

    def test_out_of_range_numbers_are_refused(self) -> None:
        updates = (
            AppSettingsUpdate(vision_max_tokens=0),
            AppSettingsUpdate(draft_caption_threshold=0),
            AppSettingsUpdate(thinking_temperature=2.5),
            AppSettingsUpdate(instruct_top_p=0),
            AppSettingsUpdate(instruct_min_p=1.5),
            AppSettingsUpdate(thinking_presence_penalty=-3),
            AppSettingsUpdate(instruct_repeat_penalty=2.5),
            AppSettingsUpdate(video_keyframes_per_second=0),
            AppSettingsUpdate(image_max_pixels=0),
            AppSettingsUpdate(job_history_days=-1),
            AppSettingsUpdate(vision_api_key="two words"),
            AppSettingsUpdate(thumbnail_cache_max_mb=-1),
            AppSettingsUpdate(vision_model="   "),
        )
        for update in updates:
            with self.subTest(update=update), self.assertRaises(InvalidSettingError):
                update_app_settings(update)

    def test_the_error_names_the_setting(self) -> None:
        with self.assertRaises(InvalidSettingError) as caught:
            update_app_settings(AppSettingsUpdate(ai_toolkit_base_url="localhost"))

        self.assertIn("AI-Toolkit URL", str(caught.exception))

    def test_a_refused_update_saves_none_of_its_values(self) -> None:
        with self.assertRaises(InvalidSettingError):
            update_app_settings(
                AppSettingsUpdate(vision_model="model-b", comfy_base_url="not a url"),
            )

        self.assertEqual(describe_app_settings().vision_model.source, "default")

    def test_a_corrupt_saved_field_does_not_lose_the_others(self) -> None:
        set_preference(
            APP_SETTINGS_KEY,
            json.dumps({"vision_model": "model-b", "comfy_base_url": "not a url"}),
        )
        load_saved_settings()

        with patch.dict(os.environ, {}, clear=True):
            settings = describe_app_settings()

        self.assertEqual(settings.vision_model.value, "model-b")
        self.assertEqual(settings.comfy_base_url.source, "default")


class SecretTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_the_key_never_leaves_in_a_description(self) -> None:
        settings = update_app_settings(AppSettingsUpdate(vision_api_key="sk-local-secret"))

        self.assertNotIn("sk-local-secret", settings.model_dump_json())
        self.assertTrue(settings.vision_api_key.is_set)
        self.assertEqual(settings.vision_api_key.source, "saved")

    def test_the_placeholder_key_reads_as_not_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            state = describe_app_settings().vision_api_key

        self.assertFalse(state.is_set)
        self.assertEqual(state.source, "default")

    def test_a_refused_key_is_not_echoed(self) -> None:
        with self.assertRaises(InvalidSettingError) as caught:
            update_app_settings(AppSettingsUpdate(vision_api_key="sk secret"))

        self.assertNotIn("sk secret", str(caught.exception))


class GetterTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_every_getter_follows_a_saved_value(self) -> None:
        update_app_settings(
            AppSettingsUpdate(
                vision_base_url="http://127.0.0.1:8890/v1",
                vision_model="model-b",
                vision_api_key="sk-local",
                vision_max_tokens=4096,
                vision_top_k=40,
                instruct_temperature=0.2,
                thinking_repeat_penalty=1.1,
                image_max_pixels=900_000,
                video_max_keyframes=64,
                draft_caption_threshold=300,
                ai_toolkit_base_url="http://127.0.0.1:8700",
                thumbnail_cache_max_mb=64,
            )
        )

        self.assertEqual(get_openai_base_url(), "http://127.0.0.1:8890/v1")
        self.assertEqual(get_openai_model(), "model-b")
        self.assertEqual(get_openai_api_key(), "sk-local")
        self.assertEqual(get_max_tokens(), 4096)
        self.assertEqual(get_top_k(), 40)
        self.assertEqual(get_sampling_profile("instruct").temperature, 0.2)
        self.assertEqual(get_sampling_profile("thinking").repeat_penalty, 1.1)
        self.assertEqual(get_image_max_pixels(), 900_000)
        self.assertEqual(get_max_video_keyframes(), 64)
        self.assertEqual(get_draft_caption_threshold(), 300)
        self.assertEqual(get_ostris_base_url(), "http://127.0.0.1:8700")
        self.assertEqual(get_thumbnail_cache_budget_bytes(), 64 * 1024 * 1024)

    def test_the_timeout_is_read_from_the_environment_only(self) -> None:
        set_preference(APP_SETTINGS_KEY, json.dumps({"vision_timeout_seconds": 90}))
        load_saved_settings()

        with patch.dict(os.environ, {"OPENAI_TIMEOUT": "120"}, clear=True):
            self.assertEqual(get_openai_timeout(), 120.0)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_openai_timeout(), 600.0)

    def test_the_ai_toolkit_url_reads_the_environment(self) -> None:
        with patch.dict(os.environ, {"OSTRIS_BASE_URL": "http://gpu-box:8675/"}, clear=True):
            self.assertEqual(get_ostris_base_url(), "http://gpu-box:8675")

    def test_the_ai_toolkit_url_defaults_to_its_stock_port(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_ostris_base_url(), "http://127.0.0.1:8675")


if __name__ == "__main__":
    unittest.main()
