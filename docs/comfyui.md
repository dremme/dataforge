# Process with ComfyUI

Upscale, restore, or otherwise run a folder of stills through a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) graph, then review each result before it replaces anything.

The job never writes into the dataset. Each result lands in `<folder>/staging/` under the source's own filename, beside a `.comfy.json` recording what produced it. **Review candidates** is what makes a result real — accept publishes the candidate under the real name; reject discards it. A cancelled run, a crashed run, or a preset that turned out to be wrong all cost nothing.

Stills only: a ComfyUI image graph has nothing to say about a video.

## Connecting ComfyUI

The defaults assume [ComfyUI Desktop](https://www.comfy.org/download), which serves its API on `http://127.0.0.1:9000`. Point DataForge somewhere else with `COMFY_BASE_URL` in `.env`. Presets live in [`comfy-workflows/`](../comfy-workflows/) at the repo root, or wherever `COMFY_WORKFLOWS_DIR` says.

The job is listed whenever any preset exists. ComfyUI itself is started and stopped all day, so the menu entry stays visible when it happens to be closed — the dialog says so instead of hiding the feature. See [Configuration](configuration.md#paths-integrations-and-logging) for the variables.

Uploads accumulate in ComfyUI's `input/dataforge/` folder. DataForge cannot clean them up (ComfyUI has no endpoint for it), so empty that folder by hand now and then.

## Running the job

**Process with ComfyUI** is under the automation panel's Files menu. Pick a preset (the filename stem of a `.json` in the workflows folder), optionally a seed, and whether to overwrite candidates that are already staged. Existing candidates are skipped unless that overwrite is on, so a second run on the same folder does not throw away a review queue you have not finished.

The **Review candidates** button appears on the automation panel once any image in the folder has a staged result. The gallery's **Candidates** file filter and a **Candidate** badge on cards and list rows mark the same files.

## Review candidates

The review modal walks the queue side by side: the dataset file on the left, ComfyUI's result on the right, with a bar beneath reading each measurement as a change — dimensions, megapixels, file size, the resolution gain, and a difference score.

**Difference** is the share of perceptual-hash bits that disagree between the source and the candidate. A hash bit compares a pixel with its neighbour, so the score is deliberately blind to the thing a prep run is _for_ — added sharpness and detail leave it where it was — and moves when content moves, vanishes, or is reframed. Expect low single digits from a clean upscale, more from de-watermarking, and 15%+ where the picture has genuinely been rearranged; two unrelated images sit near 50%.

It is a triage aid, not a verdict. The grid is 16×16, so on a large image each cell covers roughly 128 pixels and a small local defect — a mangled hand, a botched eye — barely registers. It tells you which images deserve a longer look; the two panes are still what you decide from.

The score is computed during the run, while both images are already decoded, and stored in the candidate's `.comfy.json`. Candidates staged before a score existed are scored on demand when you open them.

| Action              | What it does                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept**          | Publishes the candidate under the real name, replacing the dataset file. Caption, issue, and duplicate sidecars stay with the file because the candidate was re-encoded into the source's format. |
| **Reject**          | Discards the candidate and its `.comfy.json`. The dataset file is never opened.                                                                                                                   |
| **Skip** / **Back** | Move through the queue without settling.                                                                                                                                                          |

A candidate whose source has been renamed, moved, or deleted since the run is kept in the queue rather than hidden — it is a real file taking up real space. It can only be discarded from here.

Accept is refused while the image has an unreverted edit. The image editor always re-renders from `.bak`, so publishing a candidate on top would leave the next crop silently rendering from pre-ComfyUI pixels. Revert the edit, then accept.

**Accepting is final.** No copy of the replaced file is kept, so the way back is to reject before accepting — which is what the side-by-side view is for. There is deliberately no "accept the rest" action: one irreversible replacement per look at the image is the whole safeguard, and a button that settled a queue of them would spend it in one click. A candidate does not travel with its source either: move, copy, rename, and delete leave it in `staging/`, because writing it to the media's own destination would overwrite the file that just moved.

## Adding a preset

Each `.json` file in the workflows folder is one preset the job can run. The filename stem is the name shown in the dialog, so `upscale-2x.json` appears as `upscale-2x`.

1. Build the workflow in ComfyUI and get it working on a single image.
2. Title the node that loads the image **`DataForge Input`**, and the node that saves the result **`DataForge Output`**. Right-click a node → _Title_.
3. Export with **Save (API Format)** — not the regular Save, which writes the editor's own format and cannot be run through the API.
4. Drop the file in the workflows folder. It shows up the next time the dialog is opened. Extra `.json` files there are gitignored; only [`example-lanczos-2x.json`](../comfy-workflows/example-lanczos-2x.json) is tracked.

The two titles are only needed to break a tie: a graph with exactly one `LoadImage` and one `SaveImage` is understood without them. Title the nodes as soon as there is a second of either, or the job refuses to start rather than guessing.

## Optional titles

- **`DataForge Seed`** — a node whose `seed` (or `noise_seed`) the job overwrites when a seed is set in the dialog. Left alone otherwise, so a seed you baked into the graph stays put.
- **`DataForge Prompt`** — a text node whose `text` the job overwrites with the prompt typed in the dialog, the same text for every image in the run. Left alone when the box is empty, so a prompt baked into the graph stays put. The node has to hold its own text: a `text` input wired in from another node cannot be written to, and the preset is refused rather than quietly running the graph's own prompt. Typing a prompt for a preset that has no such node is refused for the same reason — the alternative is a run that looks like the model ignored you.

## What the job does with a preset

For each image: uploads it to ComfyUI, points the input node at the upload, runs the graph, and writes the result into the dataset's `staging/` folder under the source's own filename. Nothing in the dataset changes until you accept the candidate in the review queue.

Results are re-encoded into the source's format, because the candidate has to be able to stand in for the source — a `photo.jpg` whose candidate was a PNG would orphan its caption and finding sidecars on accept.

## `example-lanczos-2x.json`

A plain Lanczos 2× resize. It uses only core nodes and loads no models, so it runs on any ComfyUI install — useful for checking the whole path works before pointing the job at a real restoration graph, and as a skeleton to copy. The file is [`comfy-workflows/example-lanczos-2x.json`](../comfy-workflows/example-lanczos-2x.json); [`sample-images/`](../sample-images/) already has one staged result from it, so **Review candidates** has something to open without a ComfyUI run.
