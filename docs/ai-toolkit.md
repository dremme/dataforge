# Train LoRAs with AI-Toolkit

[Documentation](README.md)

**Quick LoRA training** starts a training run in [Ostris AI-Toolkit](https://github.com/ostris/ai-toolkit) on the current folder, then tracks its progress and samples in DataForge. AI-Toolkit is installed and run separately.

## Connect AI-Toolkit

Start AI-Toolkit so that its API answers at `http://127.0.0.1:8675`. DataForge always uses that address, and it cannot be changed. The menu item is disabled while AI-Toolkit is unreachable.

If AI-Toolkit refers to its state by a relative path, such as `aitk_db.db`, tell DataForge where it is installed, then restart:

```dotenv
OSTRIS_TOOLKIT_ROOT=C:\AI-Toolkit
```

This only helps DataForge find AI-Toolkit's files. It doesn't start AI-Toolkit or change its address.

## Start a run

1. Open the dataset folder. Training always uses **the whole folder** and its `.txt` captions, whatever is selected.
2. Choose **Quick LoRA training** and pick a model:

   | Model                 | For    | Template                                                          |
   | --------------------- | ------ | ----------------------------------------------------------------- |
   | **Krea 2 Turbo**      | Images | [`krea2_turbo.yml`](../ostris_templates/krea2_turbo.yml)          |
   | **MiniMax H3**        | Videos | [`h3_fl2va.yml`](../ostris_templates/h3_fl2va.yml)                |
   | **MiniMax H3 Ref2VA** | Videos | [`h3_ref2va.yml`](../ostris_templates/h3_ref2va.yml)              |

3. Enter a unique LoRA name and, optionally, a trigger word. Leaving the trigger word empty means none, not a blank token.
4. Add at least one sample prompt. AI-Toolkit renders one sample per prompt as training goes.
5. Optionally use **Edit template** to change steps, learning rate, resolution, and so on, then **Start training**. DataForge creates the job, queues it on the GPU AI-Toolkit reports, and starts the queue.

Each template sets its own resolution, steps, optimizer, sampling, frame count, and architecture, so pick the one that matches your data. Template edits apply to this run only; switching models loads that model's stock template again. The files in `ostris_templates/` are never changed, and DataForge checks the YAML before sending it. Keep the `config.process` entry with its dataset and sample sections; DataForge fills in the name, folder, trigger word, and prompts.

DataForge sends AI-Toolkit the folder path and the finished config. AI-Toolkit reads the media itself, and nothing is uploaded.

## Monitor

The jobs drawer lists AI-Toolkit runs next to DataForge's own jobs, with status, progress, time remaining, and the latest samples. Each run is linked to its dataset folder, so you can open that folder from the drawer. Samples update after each completed sample step. **Stop** asks AI-Toolkit to save a checkpoint and stop, which can take a moment.

Checkpoints, samples, and outputs belong to AI-Toolkit and stay in its training folder; DataForge only displays them. DataForge's own job history stays in `backend/data/`.

## Troubleshooting

**The menu item is disabled.** AI-Toolkit isn't answering at `http://127.0.0.1:8675`. Start it.

**The name is rejected.** Names must be unique and at most 80 characters, and can't contain `< > : " / \ | ? *`.

**The template is rejected.** Fix the reported YAML error, or switch models and back to start again from the stock template.

**No samples or state appear.** Check that the template generates samples and that DataForge can read AI-Toolkit's training folder. If AI-Toolkit uses a relative database path, set `OSTRIS_TOOLKIT_ROOT`. A queued run has no samples yet.
