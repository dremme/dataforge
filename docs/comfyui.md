# Process with ComfyUI

Upscale, restore, or otherwise run a folder of stills through a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) graph, then review each result before it replaces anything.

The job never writes into the dataset. Each result lands in `<folder>/staging/` as `<stem>.png` (ComfyUI only saves PNG), beside a `.comfy.json` recording what produced it. **Review candidates** is what makes a result real — accept publishes that PNG in place of the source; reject discards it. A cancelled run, a crashed run, or a preset that turned out to be wrong all cost nothing.

Stills only: a ComfyUI image graph has nothing to say about a video.

## Connecting ComfyUI

The defaults assume [ComfyUI Desktop](https://www.comfy.org/download), which serves its API on `http://127.0.0.1:9000`. Point DataForge somewhere else with `COMFY_BASE_URL` in `.env`. Presets live in [`comfy-workflows/`](../comfy-workflows/) at the repo root, or wherever `COMFY_WORKFLOWS_DIR` says.

The job is listed whenever any preset exists. ComfyUI itself is started and stopped all day, so the menu entry stays visible when it happens to be closed — the dialog says so instead of hiding the feature. See [Configuration](configuration.md#paths-integrations-and-logging) for the variables.

Uploads accumulate in ComfyUI's `input/dataforge/` folder. DataForge cannot clean them up (ComfyUI has no endpoint for it), so empty that folder by hand now and then.

## Running the job

**Process with ComfyUI** is under the automation panel's Files menu. Pick a preset (the filename stem of a `.json` in the workflows folder), optionally a seed, and whether to overwrite candidates that are already staged. Existing candidates are skipped unless that overwrite is on, so a second run on the same folder does not throw away a review queue you have not finished.

The **Review candidates** button appears on the automation panel once any image in the folder has a staged result. The gallery's **Candidates** file filter and a **Candidate** badge on cards and list rows mark the same files.

For each image the job uploads it to ComfyUI, points the input node at the upload, runs the graph, and writes ComfyUI's PNG into `staging/` under the source's stem.

## Review candidates

The review modal walks the queue side by side: the dataset file on the left, ComfyUI's result on the right, with a bar beneath reading each measurement as a change — dimensions, megapixels, file size, the resolution gain, and a difference score.

**Difference** is the share of perceptual-hash bits that disagree. Sharpening and added detail barely move it; content that moves, vanishes, or is reframed does. Expect low single digits from a clean upscale, more from de-watermarking, and 15%+ where the picture has genuinely been rearranged; two unrelated images sit near 50%.

It is a triage aid, not a verdict. The hash is a 16×16 grid, so a small local defect — a mangled hand, a botched eye — barely registers. It tells you which images deserve a longer look; decide from the two panes.

The score is stored in the candidate's `.comfy.json` during the run. Candidates staged before a score existed are scored when you open them.

| Action              | What it does |
| ------------------- | ------------ |
| **Accept**          | Publishes the candidate as PNG, replacing the dataset file. A JPEG, WebP, or BMP becomes a PNG of the same stem; a PNG is overwritten in place. The caption stays (`photo.txt` already matches `photo.png`); issue and duplicate sidecars are renamed onto the new file. |
| **Reject**          | Discards the candidate and its `.comfy.json`. The dataset file is never opened. |
| **Skip** / **Back** | Move through the queue without settling. |

A candidate whose source has been renamed, moved, or deleted since the run stays in the queue — it is a real file taking up real space. Discard it from here.

Accept is refused while the image has an unreverted edit. The image editor always re-renders from `.bak`, so publishing a candidate on top would leave the next crop silently rendering from pre-ComfyUI pixels. Revert the edit, then accept.

**Accepting is final.** No copy of the replaced file is kept; reject first if you might want it back. There is deliberately no "accept the rest" action: one irreversible replacement per look at the image is the whole safeguard.

A candidate does not travel with its source. Move, copy, rename, and delete leave it in `staging/`.

Pairing is by stem: `photo.jpg` claims `staging/photo.png`. A candidate already staged under the source's exact filename still matches, so a queue from before this change keeps working. If a sibling already uses that PNG name (`photo.jpg` next to `photo.png`), the staged file belongs to the PNG alone.

## Adding a preset

Each `.json` file in the workflows folder is one preset the job can run. The filename stem is the name shown in the dialog, so `upscale-2x.json` appears as `upscale-2x`.

1. Build the workflow in ComfyUI and get it working on a single image.
2. Title the node that loads the image **`DataForge Input`**, and the node that saves the result **`DataForge Output`**. Right-click a node → _Title_.
3. Export with **Save (API Format)** — not the regular Save, which writes the editor's own format and cannot be run through the API.
4. Drop the file in the workflows folder. It shows up the next time the dialog is opened. Extra `.json` files there are gitignored; only [`example-lanczos-2x.json`](../comfy-workflows/example-lanczos-2x.json) is tracked.

The two titles are only needed to break a tie: a graph with exactly one `LoadImage` and one `SaveImage` is understood without them. Title the nodes as soon as there is a second of either, or the job refuses to start rather than guessing.

## Optional titles

- **`DataForge Seed`** — a node whose `seed` (or `noise_seed`) the job overwrites when a seed is set in the dialog. Left alone otherwise, so a seed you baked into the graph stays put.
- **`DataForge Prompt`** — a text node whose `text` the job overwrites with the prompt typed in the dialog, the same text for every image in the run. Left alone when the box is empty. The node has to hold its own text: a `text` input wired in from another node cannot be written to, and the preset is refused rather than quietly running the graph's own prompt. Typing a prompt for a preset that has no such node is refused for the same reason — the alternative is a run that looks like the model ignored you.

## Viewing an embedded workflow

A PNG or MP4-family file that ComfyUI wrote carries the graph in its metadata. The detail view shows a **ComfyUI** badge when that is there; click it to read the prompts, LoRAs, and settings on the path that produced the file. A graph with several outputs lists each one, and flags the save node whose filename matches.

This is independent of Process with ComfyUI — it reads what is already in the file, including images made outside DataForge.

## `example-lanczos-2x.json`

A plain Lanczos 2× resize. It uses only core nodes and loads no models, so it runs on any ComfyUI install — useful for checking the whole path works before pointing the job at a real restoration graph, and as a skeleton to copy. The file is [`comfy-workflows/example-lanczos-2x.json`](../comfy-workflows/example-lanczos-2x.json); [`sample-images/`](../sample-images/) already has one staged result from it, so **Review candidates** has something to open without a ComfyUI run.
