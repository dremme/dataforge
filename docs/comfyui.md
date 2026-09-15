# Process media with ComfyUI

[DataForge documentation](README.md)

Run a folder of images, GIFs, or video through a ComfyUI workflow, then inspect every result before it changes the dataset.

## How the safe review workflow works

**Process with ComfyUI** never writes directly over source media. Each successful result is staged under `<folder>/staging/` in whatever format ComfyUI produced — a PNG from a still graph, an MP4 or GIF from a video graph — paired with a `.comfy.json` record of the run. **Review candidates** is the point where a result becomes part of the dataset.

- **Accept** publishes the candidate in place of its source, keeping the candidate's own format. A JPEG, WebP, or BMP source becomes a PNG with the same stem, and a MOV or MKV source becomes an MP4; captions keep working because the caption sidecar stem stays the same. Related issue and duplicate findings are renamed to follow the published file.
- **Reject** deletes the staged file and its `.comfy.json`; the source is never opened or modified.
- **Skip** and **Back** move through the queue without deciding.

Accepting permanently replaces the source; DataForge does not keep a copy. If the source has an unreverted edit, **Accept** asks you to confirm first. Confirming discards the edit backup and settings, then makes the candidate the new original. The previous edit cannot be re-applied. Canceling leaves both the source and candidate unchanged.

Candidates must decode before they enter the review queue, and are checked again on acceptance. An invalid result leaves an existing candidate and the original untouched. Video validation requires FFmpeg.

For a video, review shows the source and candidate frame rates and durations. It warns if their running times differ significantly or if the candidate has dropped the source's audio track. You can still accept the candidate, so check these warnings before replacing the source.

## Prerequisites and connection

Processing sends every image, GIF, and video in the folder. DataForge does not check a file against the graph first: if the workflow's loader cannot read it, that file fails with ComfyUI's own error and the rest of the run continues. Point an image graph at a folder of images, and a video graph at a folder of clips.

The default expects ComfyUI Desktop at `http://127.0.0.1:9000`. Set another origin in the project-root `.env` when needed:

```dotenv
COMFY_BASE_URL=http://127.0.0.1:9000
COMFY_WORKFLOWS_DIR=
COMFY_IMAGE_TIMEOUT=900
COMFY_VIDEO_TIMEOUT=7200
```

`COMFY_WORKFLOWS_DIR` defaults to the repository’s `comfy_workflows/` directory. `COMFY_IMAGE_TIMEOUT` is the per-image wait limit in seconds; values below 30 seconds fall back to the default. `COMFY_VIDEO_TIMEOUT` is the same limit for a GIF or video source, where an upscale plus an interpolation runs for minutes; values below 60 seconds fall back to its default. Restart DataForge after changing `.env`.

The menu item appears whenever a preset exists, even when ComfyUI is stopped. Its dialog reports whether the configured endpoint is currently available. DataForge uploads sources into ComfyUI’s `input/dataforge/` directory. ComfyUI provides no cleanup endpoint, so remove old uploads from that folder periodically.

See [configuration](configuration.md#integrations) for every integration setting and [data sent to integrations](configuration.md#data-sent-to-integrations) before pointing ComfyUI at another machine.

## Try the included preset

`comfy_workflows/example_lanczos_2x.json` is a plain Lanczos 2× resize using only core ComfyUI nodes. It needs no model downloads, so it is useful for testing the path before trying a restoration, upscale, or generation graph.

`sample_images/` includes one result staged from this preset. Open that folder and choose **Review candidates** to inspect the workflow without running ComfyUI first.

## Run a folder

1. Put an API-format workflow preset in `comfy_workflows/`, or configure `COMFY_WORKFLOWS_DIR`.
2. Open the source dataset folder, not its `staging/` child.
3. Open **Process with ComfyUI** from the automation menu.
4. Choose the preset. Set a prompt or seed if its field is enabled; each field needs a matching titled node in the workflow.
5. Choose whether to overwrite candidates already staged for the same source, then start the job.

DataForge uploads one file at a time, points the workflow input at that upload, and stages the designated output in its returned format. Existing candidates are skipped by default. Enable overwrite only when you intend to replace those staged outputs. A result whose name would belong to another source is refused even with overwrite enabled; rename files with conflicting stems before processing.

While a run is active the panel shows ComfyUI’s own console below the progress bar, which for a long render is the only sign of life. It is the whole ComfyUI console rather than DataForge’s prompt, so anything else running there appears too.

Cancellation removes DataForge’s queued prompt when possible and interrupts it only when it is the running prompt. A cancelled, failed, or unsuitable run leaves source media untouched.

## Review candidates

The candidate review modal compares the source and result side by side. It shows their dimensions, megapixels, and file sizes, plus resolution gain and perceptual difference. Video panes have playback controls; when both sides are videos, playing, pausing, or seeking either one also moves the other. Both players are muted. GIFs play in image panes, including when the other side is a video. While a video player has focus, arrow keys seek within it instead of moving through the queue.

Difference is the percentage of perceptual-hash bits that differ. Video scores compare the opening frame only. It cannot measure temporal consistency or interpolation quality, so inspect playback before accepting.

A candidate whose source was moved, renamed, or deleted stays in the queue because it is still a real file. It is an orphan and can only be rejected. Use left/right arrows to move through the queue and `Ctrl+Enter`/`⌘Enter` to accept when focus is not in an editable control.

## Candidate files and lifecycle

Candidates pair with sources by stem: `photo.jpg` uses `staging/photo.png`. A staged candidate already named exactly like the source’s old PNG form still matches, preserving queues made by earlier versions.

If `photo.jpg` and `photo.png` are siblings, `staging/photo.png` belongs to the PNG source. A candidate does not travel when its source is copied, moved, renamed, or deleted. Reject it from the review queue when it is no longer useful.

The `.comfy.json` sidecar records the workflow/run details and stored difference score. Candidates staged before difference scores existed are scored when opened for review.

The [artifact table](user-guide.md#files-dataforge-creates) describes candidate locations alongside backups, edit originals, and other DataForge files.

## Add a workflow preset

Each `.json` file in the workflow directory is one preset. Its filename stem is the name shown in DataForge; `upscale-2x.json` appears as `upscale-2x`.

1. Build and test the graph on one image in ComfyUI.
2. Export it with **Save (API Format)**, not regular Save.
3. Add the exported JSON to the workflow directory.
4. Give disambiguating nodes the titles in the tables below when the graph contains more than one possible input or output node.
5. Open the dialog again to refresh the preset list.

Extra workflow JSON files are gitignored. Only `example_lanczos_2x.json` is tracked by this repository.

### Required input and output nodes

DataForge can infer a graph with exactly one loader and one saver — `LoadImage`/`SaveImage` for stills, `VHS_LoadVideo`/`VHS_VideoCombine` for video. When a graph has multiple candidates, title the intended nodes to avoid ambiguity. A real video graph usually does, because an extra preview node counts as a second saver.

| Node title         | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `DataForge Input`  | Load node to receive the uploaded source; its `image` or `video` widget is filled in |
| `DataForge Output` | Save node whose output becomes the staged candidate; DataForge fills its `filename_prefix`, or its `filename` for a node that writes the file itself |

DataForge refuses an ambiguous graph rather than guessing which node to modify.

Filesystem-path loaders such as `VHS_LoadVideoPath` are refused: DataForge has only an uploaded name to give them, which is relative to ComfyUI's input directory. `VHS_BatchManager` workflows are refused too, because their continuation prompts cannot be tracked or cancelled as one DataForge run — use a shorter clip, or a workflow that chunks frames within one prompt. If the node titled `DataForge Output` returns no file the run fails; another node's preview is never substituted.

### Optional seed and prompt nodes

| Node title         | Behavior                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataForge Seed`   | DataForge overwrites a `seed` or `noise_seed` input when a seed is set in the dialog. Without a dialog seed, the graph’s own value stays in place. |
| `DataForge Prompt` | DataForge overwrites that node’s own `text` input when the dialog prompt is nonempty.                                                              |
| `DataForge FPS`    | DataForge overwrites that node’s own number with the source’s measured frame rate, per file. Without the node, the graph runs on whatever constant it was saved with. |

The dialog disables **Prompt** or **Seed** when the selected preset lacks the corresponding titled node. A preset with neither runs with its saved values. A prompt field connected from another node cannot be written; if you submit a prompt without a writable `DataForge Prompt` node, DataForge refuses the run.

### Interpolating frames

A frame-interpolation graph has to be told what rate to write, and getting it wrong is the most common way a result comes back wrong rather than failing. **The output frame rate must be the source rate multiplied by the interpolation factor.** A `multiplier` of 2 against 24 fps footage must write 48 fps, or the clip comes back twice as long, in slow motion.

DataForge flags a candidate that does not run as long as its source, so a rate mistake shows up in review rather than in the dataset. It is a warning, not a refusal — a render that already cost GPU time is worth a look before it is thrown away.

## Inspect embedded workflows

A PNG or MP4/MOV/M4V file written by ComfyUI can contain its graph in embedded metadata. In the item detail view, select the **ComfyUI** badge to inspect prompts, LoRAs, settings, and output paths from that graph.

This is independent of **Process with ComfyUI**. It reads workflow metadata already present in compatible files, including files produced outside DataForge. The [format matrix](user-guide.md#supported-formats-and-capability-matrix) lists the supported containers.

## Troubleshooting

### The preset is missing

Confirm that `COMFY_WORKFLOWS_DIR` exists and contains `.json` files exported in API format. Reopen the dialog after adding a preset.

### The dialog says ComfyUI is unavailable

Start ComfyUI and confirm `COMFY_BASE_URL` is its origin, not a browser page route. Restart DataForge after changing the URL. The menu stays visible while the service is off so you can see the configured failure instead of losing the feature.

### The workflow rejects a prompt or is ambiguous

Use `DataForge Prompt` only on a node that owns a writable `text` input, and `DataForge FPS` only on a node that owns its own number. Add `DataForge Input` and `DataForge Output` titles whenever the graph has multiple load or save candidates, then export the graph again in API format.

### Processing times out or leaves uploads behind

Increase `COMFY_IMAGE_TIMEOUT`, or `COMFY_VIDEO_TIMEOUT` for a GIF or video source, for workflows that legitimately take longer. Inspect ComfyUI’s queue/history for graph errors. Empty `input/dataforge/` manually when accumulated uploads are no longer needed.

## Related guides

- [User guide](user-guide.md)
- [Configuration](configuration.md)
- [Train LoRAs with AI-Toolkit](ai-toolkit.md)
- [Development](development.md)
