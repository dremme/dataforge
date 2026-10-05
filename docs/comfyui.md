# Process media with ComfyUI

[Documentation](README.md)

Run images or videos through workflows such as upscaling, restoration, or interpolation. DataForge stages each result for review; processing does not change the source. ComfyUI is installed and run separately.

## Connect ComfyUI

Start ComfyUI, then open **Settings > Integrations**. Enter its origin in **ComfyUI URL**, use **Test connection**, and **Save**. The default is `http://127.0.0.1:9000`. Use the service address, not a page URL.

You can also configure the connection in `.env`; environment changes require a restart. A saved Settings value takes precedence.

| Variable              | Default                 | Effect                                                                     |
| --------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `COMFY_BASE_URL`      | `http://127.0.0.1:9000` | HTTP(S) origin; also available in Settings                                 |
| `COMFY_WORKFLOWS_DIR` | `comfy_workflows/`      | Directory of API-format JSON presets                                       |
| `COMFY_IMAGE_TIMEOUT` | `900`                   | Seconds per image; values below 30 or malformed values use the default     |
| `COMFY_VIDEO_TIMEOUT` | `7200`                  | Seconds per GIF/video; values below 60 or malformed values use the default |

Remote ComfyUI receives source media and workflow inputs. Prefer absolute custom paths; relative overrides resolve against the server working directory, normally `backend/`.

The processing menu appears when presets exist, even if ComfyUI is stopped. The dialog reports availability. Uploaded sources accumulate in ComfyUI's `input/dataforge/` directory; ComfyUI has no remote cleanup endpoint, so clear old uploads there manually.

## Try it

The bundled [`example_lanczos_2x.json`](../comfy_workflows/example_lanczos_2x.json) resizes images 2× using core nodes, without model downloads. To try review without a run, open [`sample_images/`](../sample_images/) and choose **Review candidates**.

## Run a folder

1. Open the dataset itself, rather than `staging/`.
2. Select files to limit the run, or leave nothing selected to process the whole folder. Filters alone do not limit it.
3. Choose **Process with ComfyUI** and a preset suitable for those files.
4. Optionally enter Prompt or Seed; fields are enabled only when the workflow has the corresponding titled node.
5. Choose whether to overwrite previously staged results, then start.

DataForge uploads one file at a time and stages the workflow output with a `.comfy.json` run record. Existing candidates are skipped unless overwrite is enabled. Same-stem collisions are refused even with overwrite; rename those sources first. Results must decode before staging and again before acceptance; bad outputs do not replace sources or earlier candidates. Video validation needs ffmpeg.

The workflow decides which inputs it supports. An unsupported or failed file is reported, and processing continues. The panel shows ComfyUI's console, including output from other work on that server. Cancelling removes the queued prompt or interrupts the running prompt; already staged results remain.

## Review candidates

Open **Review candidates** for side-by-side comparison, or use the item's review control in the detail viewer. The comparison includes dimensions, sizes, resolution gain, and perceptual difference. Videos start muted and loop; playback, pause, and seeking synchronize when both sides are video. GIFs play as images.

- **Accept** (`Ctrl+Enter`) replaces the source in the result's format, retaining the stem and caption and updating issue/duplicate file names. **No source backup is kept; acceptance has no undo.**
- **Reject** (`Ctrl+Backspace`) removes the candidate and its run record, leaving the source unchanged.
- **Skip**, **Back**, arrows, and Home/End navigate without a decision.

**Keep original metadata** is on by default and remembered for individual and bulk acceptance. It replaces the result's EXIF, XMP, and text/workflow metadata with the source's metadata. Turn it off to keep the result's own metadata instead.

Metadata transfer supports image sources with PNG results and video sources with MP4 or MOV results. Other pairings keep the result's metadata. If a supported transfer fails, the result stays staged and the source is unchanged.

If the source has an edit, accepting asks before discarding its settings and retained original. The candidate becomes the new original. Cancelling that confirmation leaves both versions unchanged.

For videos, review warns about duration differences and lost audio. The difference score compares only the first frame; watch playback before accepting. An orphan whose source was moved/deleted outside DataForge can only be rejected.

### Bulk acceptance and deletion

In Quick actions (`Ctrl+P`), use **Accept all staged candidates** or **Delete all staged candidates**. With a selection, the labels become **Accept selected candidates** and **Delete selected candidates**; only those sources' candidates are included. Filters alone do not limit these commands.

Bulk acceptance asks for confirmation, includes **Keep original metadata**, and skips individual comparisons. It discards any source edit/original and retains no backup. Bulk deletion keeps sources and sends candidates to the Recycle Bin on Windows. Each command reports failures; unsuccessful candidates remain available for review.

### How results pair with sources

A result is staged under the source's stem, in the format produced by the workflow: `photo.jpg` can pair with `staging/photo.png` or `staging/photo.mp4`. If both `photo.jpg` and `photo.png` exist, `staging/photo.png` belongs to the PNG. Results named exactly like their source, including older `staging/photo.jpg` results, still pair.

Processing refuses output names that would collide with another source's candidate, even with overwrite enabled. Give same-stem sources unique names before processing.

Each result has a `<result-name>.comfy.json` record of the workflow, run details, and perceptual difference score. Older results without scores are scored when reviewed.

The difference score is the percentage of bits that differ in a perceptual hash, a compact representation of a frame's appearance. It helps spot large visual changes; it is not a measure of quality.

## Write a preset

1. Build a workflow in ComfyUI and test it on one file.
2. Export it with **Save (API Format)**. A regular workflow save is not accepted.
3. Put the `.json` file in `comfy_workflows/`, or the directory set by `COMFY_WORKFLOWS_DIR`.
4. Reopen **Process with ComfyUI** to load it.

The file name becomes the preset name: `upscale-2x.json` appears as `upscale-2x`. Only the bundled example preset is tracked by Git; user presets in the default directory are ignored.

### Input and output nodes

A workflow with one loader and one saver can work without titles: `LoadImage`/`SaveImage` for images, or `VHS_LoadVideo`/`VHS_VideoCombine` for video. If there are multiple candidates, assign these **node titles** (not node types):

| Node title         | Node          | Input DataForge changes                                  |
| ------------------ | ------------- | -------------------------------------------------------- |
| `DataForge Input`  | Source loader | `image` or `video`, set to the uploaded file name        |
| `DataForge Output` | Result saver  | `filename_prefix`, or `filename` for direct file writers |

A video preview node can count as another saver. DataForge refuses ambiguous workflows. If the designated output produces no file, processing that source fails; output from another node is not substituted.

The following are unsupported:

- Filesystem-path loaders such as `VHS_LoadVideoPath`: DataForge supplies uploaded file names, not paths on the ComfyUI machine.
- `VHS_BatchManager`: its follow-up prompts cannot be tracked and cancelled as one run. Use shorter clips or process chunks within one prompt.

### Optional nodes

| Node title         | Input DataForge changes                                               |
| ------------------ | --------------------------------------------------------------------- |
| `DataForge Prompt` | The node's own `text` value, if a prompt is entered                   |
| `DataForge Seed`   | `seed` or `noise_seed`, if a seed is entered                          |
| `DataForge FPS`    | The node's own numeric value, set to the source's measured frame rate |

Without these nodes, or with optional fields left empty, the workflow uses its saved values. The dialog disables Prompt or Seed when the matching node is absent. A prompt/FPS value must belong to the titled node, rather than be wired from another node; an unusable prompt node causes a supplied prompt to be refused.

For interpolation, multiply the source rate by the interpolation factor: doubling 24 fps footage requires 48 fps output to retain its duration. Use `DataForge FPS` as the source-rate input to that calculation. The review warns about duration mismatches.

## Inspect embedded workflows

Click the **ComfyUI** badge in a file's detail view to inspect embedded prompts, models, LoRAs, settings, and saved output names. **Copy workflow** copies the part of the workflow that leads to the selected output; paste it onto the ComfyUI canvas to load it, which replaces the open tab's graph. It needs the editor workflow ComfyUI embeds alongside the prompt, so it is missing for files that carry only the API format. This supports PNG, MP4, MOV, and M4V, including files made outside DataForge. Stripping metadata removes the embedded workflow.

When a workflow has several outputs, select one to inspect its details. DataForge shows the generation stage feeding that output, rather than combining settings from earlier stages.

A filename match is marked as a **Likely output**. This is a hint: the embedded workflow cannot confirm which node wrote the file. If several outputs match, or the file was renamed, compare the listed outputs yourself.

## Troubleshooting

**Preset missing.** Check the preset directory and `.json` extension. Export API format, then reopen the dialog.

**ComfyUI unavailable.** Start it, check its origin in Settings, and test the connection before saving.

**Ambiguous workflow or refused prompt.** Set `DataForge Input` and `DataForge Output` titles. Optional prompt/FPS nodes must own their values, not receive them through a connection. Export again.

**Timeout or failed output.** Inspect ComfyUI's queue/history and DataForge's per-file result. Increase `COMFY_IMAGE_TIMEOUT` or `COMFY_VIDEO_TIMEOUT` for slow renders. GIFs use the video timeout; video validation needs ffmpeg.
