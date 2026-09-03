# Train LoRAs with AI-Toolkit

[DataForge documentation](README.md)

DataForge can create and monitor training jobs in a separately running Ostris AI-Toolkit installation. It does not install, start, or host AI-Toolkit for you.

## What DataForge controls

From the current dataset folder, **Quick LoRA training** creates an AI-Toolkit job, queues it on the reported GPU, and starts the queue. DataForge then shows the matching external job in its jobs drawer, including status, progress, stop controls, and the newest generated samples when AI-Toolkit exposes them.

DataForge uses the folder’s `.txt` caption sidecars. It always trains the whole current folder; an active gallery selection does not narrow an AI-Toolkit run.

## Prerequisites

- Install and configure AI-Toolkit separately, including the models and hardware required by the selected template.
- Start the AI-Toolkit API at `http://127.0.0.1:8675`.
- Open a dataset folder with the media and `.txt` captions you want the template to read.
- Choose a unique LoRA name and at least one sample prompt.

The **Quick LoRA training** action is disabled while AI-Toolkit cannot be reached. Starting DataForge does not start the training service.

## Connect AI-Toolkit

The API endpoint is fixed at `http://127.0.0.1:8675`. It is not an environment variable and cannot be changed with `OSTRIS_TOOLKIT_ROOT`.

Set `OSTRIS_TOOLKIT_ROOT` in the project-root `.env` only when DataForge needs help resolving AI-Toolkit state from a toolkit-relative path, such as `aitk_db.db`:

```dotenv
OSTRIS_TOOLKIT_ROOT=C:\AI-Toolkit
```

Restart DataForge after changing `.env`. The root does not start AI-Toolkit, change the API address, or move AI-Toolkit output folders. See the [configuration guide](configuration.md#integrations) for the variable reference.

## Start a training run

1. Open the dataset folder in DataForge.
2. Choose **Quick LoRA training** from the automation menu.
3. Pick a model template, then enter a unique LoRA name.
4. Optionally enter a trigger word. DataForge passes an empty trigger word as no trigger word rather than a blank token.
5. Add sample prompts. AI-Toolkit renders one sample for each prompt while training.
6. Review any per-run template changes, then select **Start training**.

DataForge sends the folder path, chosen model, LoRA name, trigger word, sample prompts, and resulting YAML configuration to the local AI-Toolkit API. AI-Toolkit reads the dataset itself from that path; DataForge does not upload media bytes through this API.

## Choose a model

| DataForge choice      | Dataset type | Template                           |
| --------------------- | ------------ | ---------------------------------- |
| **Krea 2 Turbo**      | Images       | `ostris-templates/krea2-turbo.yml` |
| **MiniMax H3**        | Videos       | `ostris-templates/h3-fl2va.yml`    |
| **MiniMax H3 Ref2VA** | Videos       | `ostris-templates/h3-ref2va.yml`   |

The template determines its own resolution, steps, optimizer, sampling, frame count, and model architecture. Choose the template that matches your data and installed AI-Toolkit support rather than mixing image and video templates in the same run.

## Customize the run template

**Edit template** opens the selected template as YAML for the run you are about to start. Use it to adjust settings such as steps, learning rate, resolution, or sample settings.

DataForge validates the YAML before it queues the job. The edited text is sent only with that run; the tracked files under `ostris-templates/` are never overwritten. Switching models loads that model’s stock template for a new per-run draft.

Keep the required template shape intact: a `config.process` entry with a dataset and sample configuration. DataForge fills the job name, training folder, dataset folder, trigger word, and sample prompts; it leaves the rest of the template unchanged.

## Monitor jobs and samples

Open the jobs drawer to see local automation jobs and external AI-Toolkit jobs. DataForge associates an external job with the dataset folder stored in that job’s configuration, so the drawer can open the matching folder.

An external job card shows queued/running state, progress when AI-Toolkit supplies it, a time estimate when available, and the most recent sample set. Select **Stop** to ask AI-Toolkit to stop the job and save a checkpoint; saving can take time before the status changes.

DataForge displays samples from AI-Toolkit’s training folder. It does not own their retention, checkpoint files, or final output locations.

## Files and ownership

| Item                                                | Owner                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Dataset media and `.txt` captions                   | Your dataset folder                                                    |
| Tracked stock templates                             | `ostris-templates/` in this repository                                 |
| Per-run edited YAML                                 | Sent with the AI-Toolkit job; not written back to the tracked template |
| Job records, checkpoints, samples, training folders | AI-Toolkit configuration and storage                                   |
| DataForge job history and UI state                  | DataForge app database under `backend/data/` by default                |

## Troubleshooting

### The menu item is disabled

Start AI-Toolkit and confirm its API responds at `http://127.0.0.1:8675`. DataForge deliberately leaves the menu disabled when the service is unavailable.

### DataForge cannot find state or samples

Check that AI-Toolkit reports accessible local training folders. If its job references a relative SQLite path, set `OSTRIS_TOOLKIT_ROOT` to the installation root and restart DataForge. The variable does not redirect the API.

### AI-Toolkit rejects a job name

LoRA names must be nonempty, at most 80 characters, and cannot contain Windows-invalid filename characters such as `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, or `*`. AI-Toolkit also rejects names that already exist.

### The template is not valid YAML

Return to **Edit template** and repair the reported YAML syntax or required shape. Start from the stock template when a change removed the dataset or sample configuration.

### No samples appear

Confirm that the template generates samples and that AI-Toolkit’s training folder is readable by the process running DataForge. Sample previews update from the latest completed sample step; a queued run has none yet.

## Related guides

- [Getting started](getting-started.md)
- [User guide](user-guide.md#automation-jobs)
- [Configuration](configuration.md#integrations)
- [Development](development.md)
