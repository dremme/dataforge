# Process images with ComfyUI

[DataForge documentation](README.md)

Run a folder of still images through a ComfyUI workflow, then inspect every result before it changes the dataset.

## How the safe review workflow works

**Process with ComfyUI** never writes directly over source media. Each successful result is staged as a PNG under `<folder>/staging/`, paired with a `.comfy.json` record of the run. **Review candidates** is the point where a result becomes part of the dataset.

- **Accept** publishes the candidate in place of its source. A JPEG, WebP, or BMP source becomes a PNG with the same stem; captions keep working because the caption sidecar stem stays the same. Related issue and duplicate findings are renamed to follow the published PNG.
- **Reject** deletes the staged PNG and its `.comfy.json`; the source is never opened or modified.
- **Skip** and **Back** move through the queue without deciding.

Accepting is final. DataForge does not retain a copy of the source that was replaced. It also refuses acceptance while the source has an unreverted edit, because the image editor’s `.bak` would otherwise point at pre-ComfyUI pixels.

## Prerequisites and connection

Processing accepts JPG/JPEG, PNG, WebP, and BMP source images. ComfyUI image graphs do not process videos or GIFs.

The default expects ComfyUI Desktop at `http://127.0.0.1:9000`. Set another origin in the project-root `.env` when needed:

```dotenv
COMFY_BASE_URL=http://127.0.0.1:9000
COMFY_WORKFLOWS_DIR=
COMFY_IMAGE_TIMEOUT=900
```

`COMFY_WORKFLOWS_DIR` defaults to the repository’s `comfy-workflows/` directory. `COMFY_IMAGE_TIMEOUT` is the per-image wait limit in seconds; values below 30 seconds fall back to the default. Restart DataForge after changing `.env`.

The menu item appears whenever a preset exists, even when ComfyUI is stopped. Its dialog reports whether the configured endpoint is currently available. DataForge uploads sources into ComfyUI’s `input/dataforge/` directory. ComfyUI provides no cleanup endpoint, so remove old uploads from that folder periodically.

See [configuration](configuration.md#integrations) for every integration setting and [data sent to integrations](configuration.md#data-sent-to-integrations) before pointing ComfyUI at another machine.

## Try the included preset

`comfy-workflows/example-lanczos-2x.json` is a plain Lanczos 2× resize using only core ComfyUI nodes. It needs no model downloads, so it is useful for testing the path before trying a restoration, upscale, or generation graph.

`sample-images/` includes one result staged from this preset. Open that folder and choose **Review candidates** to inspect the workflow without running ComfyUI first.

## Run a folder

1. Put an API-format workflow preset in `comfy-workflows/`, or configure `COMFY_WORKFLOWS_DIR`.
2. Open the source dataset folder, not its `staging/` child.
3. Open **Process with ComfyUI** from the automation menu.
4. Choose the preset. Optionally set a seed and prompt, if the workflow provides the matching titled nodes.
5. Choose whether to overwrite candidates already staged for the same source, then start the job.

DataForge uploads one image at a time, points the workflow input at that upload, waits for the result, and writes the returned PNG to `staging/<stem>.png`. Existing candidates are skipped by default, so a later run does not silently replace a review queue. Enable overwrite only when you intend to replace those staged outputs.

Cancellation removes DataForge’s queued prompt when possible and interrupts it only when it is the running prompt. A cancelled, failed, or unsuitable run leaves source images untouched.

## Review candidates

The candidate review modal compares source and result side by side. It shows dimension, megapixel, file-size, resolution-gain, and perceptual difference changes.

Difference is the percentage of perceptual-hash bits that differ. It helps triage broad changes: a clean upscale usually scores low, while reframed or rearranged content scores higher. It cannot catch every small local defect, so inspect the images before accepting.

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

Extra workflow JSON files are gitignored. Only `example-lanczos-2x.json` is tracked by this repository.

### Required input and output nodes

DataForge can infer a graph with exactly one `LoadImage` and one `SaveImage`. When a graph has multiple candidates, title the intended nodes to avoid ambiguity.

| Node title         | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `DataForge Input`  | Image-load node to receive the uploaded source            |
| `DataForge Output` | Image-save node whose output becomes the staged candidate |

DataForge refuses an ambiguous graph rather than guessing which node to modify.

### Optional seed and prompt nodes

| Node title         | Behavior                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataForge Seed`   | DataForge overwrites a `seed` or `noise_seed` input when a seed is set in the dialog. Without a dialog seed, the graph’s own value stays in place. |
| `DataForge Prompt` | DataForge overwrites that node’s own `text` input when the dialog prompt is nonempty.                                                              |

A prompt field connected from another node cannot be written. DataForge refuses a typed prompt when the preset has no writable `DataForge Prompt` node rather than running the graph with an unexpected built-in prompt.

## Inspect embedded workflows

A PNG or MP4/MOV/M4V file written by ComfyUI can contain its graph in embedded metadata. In the item detail view, select the **ComfyUI** badge to inspect prompts, LoRAs, settings, and output paths from that graph.

This is independent of **Process with ComfyUI**. It reads workflow metadata already present in compatible files, including files produced outside DataForge. The [format matrix](user-guide.md#supported-formats-and-capability-matrix) lists the supported containers.

## Troubleshooting

### The preset is missing

Confirm that `COMFY_WORKFLOWS_DIR` exists and contains `.json` files exported in API format. Reopen the dialog after adding a preset.

### The dialog says ComfyUI is unavailable

Start ComfyUI and confirm `COMFY_BASE_URL` is its origin, not a browser page route. Restart DataForge after changing the URL. The menu stays visible while the service is off so you can see the configured failure instead of losing the feature.

### The workflow rejects a prompt or is ambiguous

Use `DataForge Prompt` only on a node that owns a writable `text` input. Add `DataForge Input` and `DataForge Output` titles whenever the graph has multiple load or save candidates, then export the graph again in API format.

### Processing times out or leaves uploads behind

Increase `COMFY_IMAGE_TIMEOUT` for workflows that legitimately take longer. Inspect ComfyUI’s queue/history for graph errors. Empty `input/dataforge/` manually when accumulated uploads are no longer needed.

## Related guides

- [User guide](user-guide.md)
- [Configuration](configuration.md)
- [Train LoRAs with AI-Toolkit](ai-toolkit.md)
- [Development](development.md)
