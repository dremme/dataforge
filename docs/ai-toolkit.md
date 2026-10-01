# Train LoRAs with AI-Toolkit

[Documentation](README.md)

**Quick LoRA training** starts a run on the open dataset and displays progress and samples in DataForge. Install and run [Ostris AI-Toolkit](https://github.com/ostris/ai-toolkit) separately; it performs the training and owns the outputs.

## Connect AI-Toolkit

Start AI-Toolkit, then open **Settings > Integrations**. Enter its origin in **AI-Toolkit URL**, **Test connection**, and **Save**. DataForge defaults to `http://127.0.0.1:8675`. Training is disabled while the service is unreachable.

AI-Toolkit must be able to read the dataset at the exact path DataForge supplies. DataForge also needs filesystem access to its state/training folder to show samples. A reachable API on another machine is not enough without the necessary shared paths.

If AI-Toolkit reports relative state paths, set its installation directory in `.env`, then restart DataForge:

```dotenv
OSTRIS_TOOLKIT_ROOT=C:\AI-Toolkit
```

This resolves AI-Toolkit's files; it does not start the service or change its address. Prefer an absolute installation path; relative overrides resolve against the server working directory, normally `backend/`.

| Variable              | Default                 | Effect                                                                      |
| --------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `OSTRIS_BASE_URL`     | `http://127.0.0.1:8675` | HTTP(S) origin; also available in Settings                                  |
| `OSTRIS_TOOLKIT_ROOT` | unset                   | Installation directory for resolving relative state paths; environment-only |

Environment changes require a restart. A saved URL in Settings takes precedence over `.env`; Reset, then Save, removes that override.

## Start a run

1. Open the dataset. Training uses **the whole folder** and its `.txt` captions, regardless of selection or filters.
2. Choose **Quick LoRA training** and a template that matches your media:

   | Model                 | Media  | Template                                                   |
   | --------------------- | ------ | ---------------------------------------------------------- |
   | **Krea 2 Turbo**      | Images | [`krea2_turbo.yml`](../ostris_templates/krea2_turbo.yml)   |
   | **Qwen Image 2.1**    | Images | [`qwen_image_2.yml`](../ostris_templates/qwen_image_2.yml) |
   | **MiniMax H3**        | Videos | [`h3_fl2va.yml`](../ostris_templates/h3_fl2va.yml)         |
   | **MiniMax H3 Ref2VA** | Videos | [`h3_ref2va.yml`](../ostris_templates/h3_ref2va.yml)       |

3. Enter a unique LoRA name and optional trigger word. An empty trigger means no trigger.
4. Add at least one sample prompt; training generates samples from these prompts at the template's sample intervals.
5. Optionally **Edit template**, then **Start training**. DataForge creates the job, queues it on the GPU AI-Toolkit reports, and starts that queue.

### Template settings

Templates define architecture, resolution, steps, optimizer, learning rate, sampling, and, for video, frame counts. Review these for your data rather than assuming all models use the same settings. The H3 templates currently train on 39 frames and generate 56-frame samples; training and sample lengths are separate settings.

Dialog edits apply to that run only; switching models restores the selected model's stock template. The files in `ostris_templates/` are unchanged. DataForge validates YAML and requires a `config.process` list whose first entry contains dataset and sample sections. It fills in the name, training folder, first dataset's path, trigger word, and sample prompts; other template values remain yours.

DataForge sends the path and configuration, not the media. AI-Toolkit reads the dataset and writes checkpoints/samples to its configured training folder.

## Monitor

The jobs drawer shows AI-Toolkit runs with status, progress, time remaining, latest samples, and a link to the dataset folder. Samples refresh after completed sample steps. **Stop** asks AI-Toolkit to save a checkpoint and stop; it can take a moment.

Checkpoints and samples remain in AI-Toolkit's training folder. DataForge displays them and stores its own app history separately.

## Troubleshooting

**Training disabled.** Start AI-Toolkit and test its URL in Settings.

**Name rejected.** Use a unique name of at most 80 characters, excluding `< > : " / \ | ? *`, `.` and `..`.

**Template rejected.** Correct the reported YAML/structure error, or switch models and back to restore the stock template.

**Dataset unreadable or samples missing.** Check filesystem access from both services. For relative state paths, set `OSTRIS_TOOLKIT_ROOT`. Check the template enables sampling; queued runs have no samples yet.
