# Process media with ComfyUI

[Documentation](README.md)

Run a folder of images or videos through a ComfyUI workflow, such as an upscale, restoration, or interpolation. Nothing changes your dataset until you accept each result.

## Connect ComfyUI

DataForge expects ComfyUI at `http://127.0.0.1:9000`, the ComfyUI Desktop default. To change anything, set it in `.env` and restart:

| Variable              | Default                 | Purpose                                                                          |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `COMFY_BASE_URL`      | `http://127.0.0.1:9000` | ComfyUI's origin, with or without a trailing slash; not a page URL               |
| `COMFY_WORKFLOWS_DIR` | `comfy_workflows/`      | Folder of workflow presets                                                       |
| `COMFY_IMAGE_TIMEOUT` | `900`                   | Seconds to wait for one image. Values under 30 use the default                   |
| `COMFY_VIDEO_TIMEOUT` | `7200`                  | Seconds to wait for one GIF or video, since upscaling plus interpolation can take many minutes per clip. Values under 60 use the default |

**Process with ComfyUI** appears in the automation menu whenever a preset exists, even if ComfyUI is stopped, and its dialog shows whether ComfyUI is reachable. DataForge uploads each source to ComfyUI's `input/dataforge/` folder. ComfyUI offers no way to clean that folder remotely, so empty it by hand now and then. Before pointing DataForge at a ComfyUI on another machine, see [what gets sent](configuration.md#data-sent-to-integrations).

## Try it

[`comfy_workflows/example_lanczos_2x.json`](../comfy_workflows/example_lanczos_2x.json) is a plain 2× resize that uses only core nodes and needs no downloads. It is a good first test.

To see the review step without running anything, open [`sample_images/`](../sample_images/) and choose **Review candidates**. One result is already waiting there.

## Run a folder

1. Open the dataset folder itself, not its `staging/` subfolder.
2. Choose **Process with ComfyUI** and pick a preset.
3. Optionally set a prompt or seed. These fields are enabled only if the preset has the matching [titled node](#optional-nodes).
4. Choose whether to overwrite results already staged for the same sources, then start.

DataForge uploads one file at a time, points the workflow's input at it, and stages the output in whatever format the workflow produced, next to a `.comfy.json` record of the run. Every image, GIF, and video in the scope is sent. A file the workflow can't read fails with ComfyUI's own error, and the run carries on, so point image workflows at images and video workflows at videos.

- Sources that already have a staged result are skipped unless you chose to overwrite.
- A result whose name would collide with another source's is refused, even with overwrite. Rename files that share a stem, such as `a.jpg` and `a.png`, first.
- A result must decode before it is staged, and is checked again on accept. An invalid result never replaces a staged one or the source. Checking videos needs ffmpeg.

While the job runs, the panel shows ComfyUI's console, which is the only sign of life during a long render. It is the whole console, so output from anything else running in ComfyUI appears too. Cancelling removes DataForge's prompt from ComfyUI's queue, or interrupts it if it is already running. Source files are never modified during a run.

## Review candidates

**Review candidates** shows each source and its result side by side, with dimensions, megapixels, file sizes, resolution gain, and a difference score. The score is the percentage of perceptual-hash bits that differ. Videos play in both panes; when both sides are videos, they play, pause, and seek together, muted. GIFs play as images. While a video player has focus, the arrow keys seek in it instead of moving through the queue.

- **Accept** (`Ctrl+Enter`) replaces the source with the result, in the result's format. A JPEG, WebP, or BMP source becomes a PNG, and a MOV or MKV source becomes an MP4, with the same stem. The caption keeps working, and issue and duplicate findings are renamed to follow. **No copy of the source is kept.**
- **Reject** deletes the result and its `.comfy.json`. The source is never touched.
- **Skip**, **Back**, and the arrow keys move through the queue without deciding.

If the source has an edit, **Accept** asks first. Confirming discards the edit and its original, and the result becomes the new original; the old edit can't be re-applied. Cancelling leaves both files unchanged.

For videos, review compares frame rate and duration and warns if the result runs a different length or has lost the source's audio. These are warnings, not refusals, so read them before accepting. The difference score for video compares only the first frame and says nothing about motion, so watch the result play.

### How results pair with sources

A result pairs with its source by stem: `photo.jpg` pairs with `staging/photo.png`, `staging/photo.mp4`, and so on. If `photo.jpg` and `photo.png` both exist, `staging/photo.png` belongs to the PNG. A result named exactly like its source, such as `staging/photo.jpg` from older versions, still pairs.

Moving, copying, renaming, or deleting a source inside DataForge takes its result along. If the source is moved or deleted outside DataForge, its result stays in the queue as an orphan that can only be rejected.

The `.comfy.json` file records the workflow, the run details, and the difference score. Results staged before scores existed are scored when first reviewed.

## Write a preset

Every `.json` file in the workflow folder is a preset, named after the file: `upscale-2x.json` appears as `upscale-2x`.

1. Build the workflow in ComfyUI and test it on one file.
2. Export it with **Save (API Format)**. A regular save won't work.
3. Put the file in the workflow folder. Only the example preset is tracked by git; your own are ignored.
4. Reopen the dialog to see it.

### Input and output nodes

A workflow with exactly one loader and one saver works as-is: `LoadImage`/`SaveImage` for images, `VHS_LoadVideo`/`VHS_VideoCombine` for video. If there are more, which is common in video workflows because a preview node counts as a saver, set these **node titles** so DataForge knows which to use:

| Node title         | Put it on                  | DataForge sets                                                            |
| ------------------ | -------------------------- | ------------------------------------------------------------------------- |
| `DataForge Input`  | The load node for sources  | Its `image` or `video` input, to the uploaded file                        |
| `DataForge Output` | The save node for results  | Its `filename_prefix`, or `filename` for nodes that write the file directly |

DataForge refuses ambiguous workflows rather than guessing. If the `DataForge Output` node produces no file, that file fails; another node's output is never used instead.

Two kinds of workflow are refused:

- **Loaders that take a filesystem path**, such as `VHS_LoadVideoPath`. DataForge can only supply an uploaded file name.
- **`VHS_BatchManager` workflows.** Their follow-up prompts can't be tracked or cancelled as one run. Use shorter clips, or a workflow that processes frames in chunks within one prompt.

### Optional nodes

| Node title         | DataForge sets                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| `DataForge Prompt` | The node's own `text` input, when you enter a prompt                        |
| `DataForge Seed`   | The node's `seed` or `noise_seed`, when you enter a seed                    |
| `DataForge FPS`    | The node's own number, set to each source's measured frame rate             |

Without these nodes, or when you leave a field empty, the workflow runs with its saved values. The dialog disables **Prompt** or **Seed** when the preset lacks the node. The prompt node needs its own `text` value, not one wired in from another node; if it has none, DataForge refuses a run with a prompt.

**Interpolation:** the output frame rate must be the source rate times the interpolation factor. Doubling 24 fps footage must write 48 fps, or the clip comes back twice as long, in slow motion. A `DataForge FPS` node gives the workflow each source's real rate to multiply. If the math is off, review flags the length mismatch.

## Inspect embedded workflows

PNG, MP4, MOV, and M4V files made by ComfyUI usually carry their workflow. Click the **ComfyUI** badge in the detail view to see its prompts, LoRAs, settings, and output paths. This works for any such file, not just ones DataForge processed.

## Troubleshooting

**The preset is missing.** Check that `COMFY_WORKFLOWS_DIR` exists and that the preset is a `.json` file exported in API format. Reopen the dialog after adding it.

**ComfyUI shows as unavailable.** Start it, and check that `COMFY_BASE_URL` is its origin, such as `http://127.0.0.1:9000`, not a page within it. Restart DataForge after changing the URL.

**The workflow is refused as ambiguous, or the prompt is refused.** Add `DataForge Input` and `DataForge Output` titles, and put `DataForge Prompt` and `DataForge FPS` only on nodes that own their value. Export in API format again.

**Runs time out.** Raise `COMFY_IMAGE_TIMEOUT`, or `COMFY_VIDEO_TIMEOUT` for GIFs and videos, and check ComfyUI's queue and history for workflow errors.
