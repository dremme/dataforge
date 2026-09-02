from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import Mock

from external.ostris_training import (
    MAX_TEMPLATE_TEXT_LENGTH,
    OstrisTrainingError,
    build_training_config,
    create_and_start_training,
    list_training_samples,
    load_training_template,
    parse_training_template,
    read_training_template_text,
    validate_lora_name,
)


def _template() -> dict[str, object]:
    return {
        "job": "extension",
        "config": {
            "name": "",
            "process": [
                {
                    "type": "diffusion_trainer",
                    "training_folder": "",
                    "trigger_word": None,
                    "datasets": [{"folder_path": "", "caption_ext": "txt"}],
                    "train": {"steps": 1000},
                    "model": {"name_or_path": "krea/Krea-2-Turbo"},
                    "sample": {"sample_every": 250, "samples": [{"prompt": "example prompt"}]},
                }
            ],
        },
        "meta": {"name": "[name]", "version": "1.0"},
    }


class LoadTrainingTemplateTests(unittest.TestCase):
    def test_loads_the_shipped_krea2_turbo_template(self) -> None:
        template = load_training_template()

        process = template["config"]["process"][0]
        self.assertEqual(process["type"], "diffusion_trainer")
        self.assertEqual(process["model"]["name_or_path"], "krea/Krea-2-Turbo")
        self.assertEqual(process["train"]["steps"], 1000)
        self.assertEqual(process["sample"]["sample_every"], 200)

    def test_loads_the_shipped_h3_fl2va_template(self) -> None:
        template = load_training_template("h3_fl2va")

        process = template["config"]["process"][0]
        self.assertEqual(process["model"]["name_or_path"], "Comfy-Org/MiniMax-H3")
        # ``minimax_h3`` is the fl2va-capable class; ``minimax_h3_ref2va`` is a different model.
        self.assertEqual(process["model"]["arch"], "minimax_h3")
        # AI-Toolkit keeps the AdaLN projections out of the trained network for this arch.
        self.assertEqual(process["network"]["network_kwargs"]["ignore_if_contains"], ["adaln_proj"])

    def test_loads_the_shipped_h3_ref2va_template(self) -> None:
        template = load_training_template("h3_ref2va")

        process = template["config"]["process"][0]
        self.assertEqual(process["model"]["arch"], "minimax_h3_ref2va")
        self.assertTrue(process["model"]["model_kwargs"]["image_refs_as_video"])
        self.assertEqual(
            process["model"]["assistant_lora_path"],
            "ostris/minimax_h3_training_adapter/minimax_h3_ref2va_training_adapter_v1.safetensors",
        )

    def test_h3_frame_counts_are_aligned_to_the_vae(self) -> None:
        """MiniMax-H3 snaps frame counts down to 17n+5, so unaligned values waste decode."""
        process = load_training_template("h3_fl2va")["config"]["process"][0]

        for frames in (process["datasets"][0]["num_frames"], process["sample"]["num_frames"]):
            self.assertEqual(frames % 17, 5, f"{frames} is not of the form 17n+5")

    def test_rejects_an_unknown_model(self) -> None:
        with self.assertRaises(OstrisTrainingError):
            load_training_template("no_such_model")


class ParseTrainingTemplateTests(unittest.TestCase):
    """The editor shows these messages verbatim, so they name the missing piece."""

    VALID = textwrap.dedent("""
        config:
          process:
            - datasets:
                - {}
              sample: {}
    """)

    def test_accepts_a_minimal_well_formed_template(self) -> None:
        parsed = parse_training_template(self.VALID)

        self.assertEqual(parsed["config"]["process"][0]["sample"], {})

    def test_rejects_broken_yaml(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("a: [1, 2")

        self.assertIn("not valid YAML", str(caught.exception))

    def test_rejects_yaml_that_is_not_a_mapping(self) -> None:
        with self.assertRaises(OstrisTrainingError):
            parse_training_template("- one\n- two\n")

    def test_rejects_a_template_with_no_process(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("config: {}\n")

        self.assertIn("process", str(caught.exception))

    def test_rejects_a_template_with_no_datasets(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("config:\n  process:\n    - sample: {}\n")

        self.assertIn("dataset", str(caught.exception))

    def test_rejects_a_template_with_no_sample_block(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("config:\n  process:\n    - datasets:\n        - {}\n")

        self.assertIn("sample", str(caught.exception))

    def test_rejects_something_far_too_large_to_be_a_template(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("#" * (MAX_TEMPLATE_TEXT_LENGTH + 1))

        self.assertIn("larger than", str(caught.exception))

    def test_the_source_name_reaches_the_message(self) -> None:
        with self.assertRaises(OstrisTrainingError) as caught:
            parse_training_template("config: {}", source="edited training template")

        self.assertIn("edited training template", str(caught.exception))


class ReadTrainingTemplateTextTests(unittest.TestCase):
    def test_returns_the_file_verbatim_so_comments_survive(self) -> None:
        raw = read_training_template_text("h3_fl2va")

        # Parsing and re-dumping would lose these, and the editor shows this text.
        self.assertIn("---", raw)
        self.assertIn('arch: "minimax_h3"', raw)
        self.assertEqual(parse_training_template(raw)["config"]["process"][0]["device"], "cuda")

    def test_rejects_an_unknown_model(self) -> None:
        with self.assertRaises(OstrisTrainingError):
            read_training_template_text("no_such_model")


class BuildTrainingConfigTests(unittest.TestCase):
    def test_fills_placeholders_and_leaves_everything_else_alone(self) -> None:
        template = _template()

        config = build_training_config(
            template,
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="sampletoken",
            prompts=["a mountain lake at sunrise", "a red hatchback on a wet street"],
        )

        process = config["config"]["process"][0]
        self.assertEqual(config["config"]["name"], "sample_train_v1")
        self.assertEqual(config["meta"]["name"], "sample_train_v1")
        self.assertEqual(process["training_folder"], "C:\\AI-Toolkit\\output")
        self.assertEqual(process["trigger_word"], "sampletoken")
        self.assertEqual(process["datasets"][0]["folder_path"], "C:\\datasets\\landscapes")
        self.assertEqual(
            process["sample"]["samples"],
            [
                {"prompt": "a mountain lake at sunrise"},
                {"prompt": "a red hatchback on a wet street"},
            ],
        )

        # Untouched settings keep the template's values.
        self.assertEqual(process["train"]["steps"], 1000)
        self.assertEqual(process["sample"]["sample_every"], 250)
        self.assertEqual(process["datasets"][0]["caption_ext"], "txt")
        self.assertEqual(process["model"]["name_or_path"], "krea/Krea-2-Turbo")

    def test_blank_trigger_word_becomes_null(self) -> None:
        config = build_training_config(
            _template(),
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="   ",
            prompts=["a mountain lake at sunrise"],
        )

        self.assertIsNone(config["config"]["process"][0]["trigger_word"])

    def test_does_not_mutate_the_template(self) -> None:
        template = _template()

        build_training_config(
            template,
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="",
            prompts=["a mountain lake at sunrise"],
        )

        self.assertEqual(template["config"]["name"], "")
        self.assertEqual(template["config"]["process"][0]["datasets"][0]["folder_path"], "")


class CreateAndStartTrainingTests(unittest.TestCase):
    def test_creates_queues_and_starts_the_gpu_queue(self) -> None:
        client = Mock()
        client.post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "job-1"}))
        client.get.return_value = Mock(raise_for_status=Mock())

        job_id = create_and_start_training(client, name="sample_train_v1", gpu_ids="0", config={})

        self.assertEqual(job_id, "job-1")
        requested = [str(call.args[0]) for call in client.get.call_args_list]
        self.assertTrue(any(url.endswith("/api/jobs/job-1/start") for url in requested))
        self.assertTrue(any(url.endswith("/api/queue/0/start") for url in requested))

    def test_reports_a_duplicate_name_clearly(self) -> None:
        client = Mock()
        client.post.return_value = Mock(status_code=409)

        with self.assertRaises(OstrisTrainingError) as caught:
            create_and_start_training(client, name="sample_train_v1", gpu_ids="0", config={})

        self.assertIn("already exists", str(caught.exception))
        client.get.assert_not_called()


class ListTrainingSamplesTests(unittest.TestCase):
    def test_returns_only_the_latest_step_in_prompt_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            for filename in (
                "1780000000000__000000250_0.jpg",
                "1780000000000__000000250_1.jpg",
                "1780000600000__000000500_1.jpg",
                "1780000600000__000000500_0.jpg",
                "notes.txt",
            ):
                (samples_folder / filename).write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise", "a red hatchback on a wet street"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(
            [sample["name"] for sample in samples],
            ["1780000600000__000000500_0.jpg", "1780000600000__000000500_1.jpg"],
        )
        self.assertEqual(samples[0]["prompt"], "a mountain lake at sunrise")
        self.assertEqual(samples[1]["prompt"], "a red hatchback on a wet street")

    def test_uses_a_blank_prompt_when_the_job_config_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.jpg").write_text("", encoding="utf-8")

            samples, _ = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual(samples[0]["prompt"], "")

    def test_returns_nothing_before_the_first_sample(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples, step = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual(samples, [])
        self.assertIsNone(step)

    def test_prefers_the_video_when_a_still_preview_shares_the_stem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            for filename in (
                "1780000600000__000000500_0.jpg",
                "1780000600000__000000500_0.mp4",
                "1780000600000__000000500_1.jpg",
                "1780000600000__000000500_1.mp4",
            ):
                (samples_folder / filename).write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise", "a red hatchback on a wet street"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(
            [sample["name"] for sample in samples],
            ["1780000600000__000000500_0.mp4", "1780000600000__000000500_1.mp4"],
        )
        self.assertEqual(samples[0]["prompt"], "a mountain lake at sunrise")
        self.assertEqual(samples[1]["prompt"], "a red hatchback on a wet street")

    def test_keeps_a_video_sample_when_there_is_no_still(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.mp4").write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(samples[0]["name"], "1780000600000__000000500_0.mp4")

    def test_ignores_a_sidecar_that_shares_the_sample_stem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.jpg").write_text("", encoding="utf-8")
            (samples_folder / "1780000600000__000000500_0.txt").write_text("", encoding="utf-8")

            samples, _ = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual([sample["name"] for sample in samples], ["1780000600000__000000500_0.jpg"])


class ValidateLoraNameTests(unittest.TestCase):
    def test_rejects_names_that_would_escape_the_training_folder(self) -> None:
        for name in ("", "..", ".", "sub/name", "sub\\name", "name?"):
            with self.assertRaises(ValueError):
                validate_lora_name(name)

    def test_accepts_a_plain_name(self) -> None:
        validate_lora_name("sample_train_v1")


if __name__ == "__main__":
    unittest.main()
