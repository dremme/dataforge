# DataForge

**Local-first gallery and automation for image and video caption datasets.**

Browse folders of media, edit captions, run automated AI jobs, and keep every sidecar next to your files.
Built for people who curate training data for generative models — LoRAs, fine-tunes, and similar workflows.

[![Checks](https://github.com/dremme/dataforge/actions/workflows/checks.yml/badge.svg)](https://github.com/dremme/dataforge/actions/workflows/checks.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20.19%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#system-requirements)

[Quick start](#quick-start) · [Features](#features) · [Requirements](#system-requirements) · [Configuration](docs/configuration.md) · [ComfyUI](docs/comfyui.md) · [Development](docs/development.md) · [Security](SECURITY.md) · [License](#license)

![The DataForge gallery: a thumbnail grid of a caption dataset, with per-card caption status badges, the folder breadcrumb bar, and the search and filter toolbar.](docs/gallery.png)

## Overview

Most dataset tools either push you into a cloud UI or leave you juggling scripts and folders.
DataForge is a **desktop web app** you run locally — no cloud account, no upload step, nothing leaves your machine.

- Your media and sidecars stay in **your** folder structure
- Captions save as standard `.txt` files next to each image or video
- Optional vision LLMs talk to a **local** OpenAI-compatible server
- Jobs run in the background with progress, cancel, and history

Ideal when you already keep datasets on disk and want a fast, visual workflow over them.

## Quick start

### Windows

**1. Setup (once)** — double-click `setup.bat` in the project root.
It downloads Python 3.12.6 → `.python/` and Node 20.19.0 → `.node/`, creates `backend/.venv`, and
installs dependencies.

**2. Run** — double-click `start.bat`, or `.\start.ps1` in PowerShell.
The launcher builds the UI if needed, starts **one** server, and opens **http://localhost:18081**.
The first launch spends a minute or two on the frontend build; later ones start in seconds.
The port is configurable; see [Server ports](docs/configuration.md#server-ports).

`start.bat` passes flags through to `start.ps1`:

| Flag | Effect |
| --- | --- |
| `-Rebuild` | Build the frontend even when it looks up to date |
| `-NoBuild` | Never build; serve whatever is already in `frontend/dist` |
| `-NoBrowser` | Do not open the browser |
| `-Detach` | Exit once the server is ready instead of supervising; stop it later with `stop.bat` |

### Linux and macOS

Requires Python **3.12+** and Node **20.19+** with npm. `./setup.sh` checks both before it does
anything. From the **project root**:

**1. Setup (once)** — `./setup.sh`. It verifies the interpreters, creates `backend/.venv`, and
installs dependencies.

```bash
./setup.sh
```

**2. Run** — same as Windows: build if needed, start the server, open **http://localhost:18081**.

```bash
./start.sh
```

| Flag | Effect |
| --- | --- |
| `--rebuild` | Build the frontend even when it looks up to date |
| `--no-build` | Never build; serve whatever is already in `frontend/dist` |
| `--no-browser` | Do not open the browser |
| `--detach` | Exit once the server is ready instead of supervising; stop it later with `./stop.sh` |

### After setup

**Optional AI config** — copy `.env.example` to `.env` in the project root and set the `OPENAI_*`
variables. The backend loads `.env` on startup. See [Configuration](docs/configuration.md).

**Daily use** — `start.bat` / `./start.sh`. Re-run setup to refresh dependencies.

**Stop** — press any key in the launcher, close that window, or **Ctrl+C** in the server console.
`stop.bat` / `./stop.sh` is the fallback when nothing is supervising: after `-Detach` / `--detach`,
or when the *server* console was closed with the X button and left its port held.

Working on DataForge itself? Use `dev.bat` / `./dev.sh` instead — see
[Running with hot reload](docs/development.md#running-with-hot-reload).

<details>
<summary>Without the scripts</summary>

The launchers are convenience only. The same thing by hand, from the project root:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend && npm ci && cd ..

# Required before the frontend will build — see docs/development.md
backend/.venv/bin/python scripts/generate_types.py

# Build the UI, then serve both halves from one process
cd frontend && npm run build && cd ..
backend/.venv/bin/python scripts/prod_server.py
```

Then open **http://localhost:18081**. Re-run `npm run build` after changing frontend sources —
`prod_server.py` serves whatever is in `frontend/dist`.

</details>

### Try the sample dataset

Point the app at [`sample-images/`](sample-images/) — mixed caption states (`.txt`, uncaptioned, and
one `.issue.json`), plus a ComfyUI candidate under `staging/` so **Review candidates** has something
to open.

## Features

### Supported formats

Images: JPG, JPEG, PNG, WebP, BMP, GIF. Videos: MP4, AVI, MOV, MKV, WMV, M4V, FLV — the same set
[AI-Toolkit](https://github.com/ostris/ai-toolkit) trains on, minus audio-only files and SVG.
Everything in that list lists, thumbnails, captions, and trains.

Some in-app tools are narrower:

- **Image editing** is JPG, JPEG, PNG, WebP, and BMP. GIF keeps frame saving instead (writes a new
  JPG) because a re-encode would flatten the animation to one frame.
- **Video playback, frame saving, and editing** need a container the browser can decode: MP4, MOV,
  and M4V. An AVI, WMV, FLV, or MKV still gets a thumbnail and a caption; it just will not play in
  the detail view.
- **Megapixels, watermarking, and ComfyUI workflows** on video are MP4, MOV, and M4V only. The other
  containers hide headers the readers here cannot reach, or cannot be re-muxed cleanly.

### Gallery and navigation

- Virtualized grid that stays smooth on large folders
- Live updates — files added, edited, or removed outside DataForge appear without a refresh
- Subfolders, breadcrumbs, favorites, and recent history
- Copy the current folder path, or open it in File Explorer (Windows)
- Drive and folder picker
- Search by file name, folder name, or caption, with optional regex (**Ctrl+K** / **⌘K**)
- Quick action bar (**Ctrl+Space**) — folders, jobs, and app commands; arrow keys to move, Enter to run
- Filters for captioned / issues / missing caption, images / videos (GIFs count as videos), and
  duplicates / candidates
- Sort by name, modified date, caption length, or megapixels
- Folder cards flag caption issues or duplicates

### Captions and metadata

- In-place caption editing for `.txt` sidecars, with caption status on cards and in the detail view
- Issue resolver — step through flagged files to edit, resolve, or skip
- Duplicate resolver — walk each group side by side, with a suggested keeper, and delete the rest
  (Recycle Bin on Windows; elsewhere the deletion is confirmed by name first)
- Review candidates — walk each ComfyUI result next to the original; accept publishes the PNG in
  place of the source, reject discards it
- Per-folder `.sysprompt` (markdown) to steer AI captioning
- Dataset statistics — caption coverage, issues, duplicates, length spread, frequent words, media
  types, and megapixel buckets; always the whole folder, not the filtered view
- Embedded ComfyUI workflows in PNGs and MP4-family videos — a ComfyUI badge in the detail view
  opens the prompts, LoRAs, and settings from the graph that wrote the file
- Drag-and-drop import for media, sidecars, and `.sysprompt`
- Delete, move, or copy selected files (sidecars, including `.issue.json`, `.duplicate.json`, and a
  stored edit original, travel with the file); create subfolders

### Image and video editing

- Click-to-zoom in the detail and issue-resolver views
- Open the current image in the OS image viewer (Windows)
- Save any playable video or GIF frame as a JPG beside the source. The filename carries a timestamp
  (video) or frame index (GIF), so each frame is its own file
- Image editing — crop, rotate in quarter turns, mirror, and rescale. One pass from a stored
  original, so a later change keeps the rest and Revert puts it back
- Video editing — trim, crop, speed, and rescale, applied in one pass. The original is stored as
  `<name>.<ext>.bak`; every edit re-renders from it, so nothing is an encode of an encode. Revert
  restores it

### Automation jobs

Jobs run in the background, with a drawer for progress, cancel, and history:

| Job | What it does |
| --- | --- |
| **Auto-caption** | Completes short drafts with a local vision LLM (reasoning or instruct, with a **[reasoning effort](docs/configuration.md#reasoning-effort)** setting). Optionally sends each clip's **[audio](docs/configuration.md#audio-captioning)** with its keyframes |
| **Set captions** | Apply the same text to many files |
| **Find & replace** | Replace matching text (literal or regex), or prepend / append a trigger word, with a live count and highlighted before/after samples |
| **Edit captions** | Rewrite every caption from an instruction you write, without sending the media. Originals go to `.backup` so **Restore captions** can undo the run; empty or wildly longer/shorter replies are rejected and left untouched |
| **Verify captions** | Check captions against the media (videos via keyframes, GIFs as stills) and write `.issue.json` when something is wrong, leaving the rest of the folder's findings alone |
| **Find duplicates** | Group perceptual matches at an **exact**, **near**, or **loose** threshold; the duplicates filter and resolver then work through the groups |
| **Quick LoRA training** | Start a LoRA run on the current folder in AI-Toolkit, on Krea 2 Turbo (images) or MiniMax H3 (video) |
| **Rename** | Numbered rename of media plus related sidecars |
| **Watermark** | Burn text onto JPG, PNG, WebP, BMP, MP4, MOV, and M4V copies in a `watermarked` subfolder |
| **Process with ComfyUI** | Run stills through a workflow; each result lands as a PNG in `staging/` until **Review candidates** publishes it in place of the source |
| **Strip metadata** | Remove embedded data from PNGs and MP4s |
| **Backup captions** | Copy captions and caption issues into `.backup`, keeping copies already stored there unless you opt to overwrite |
| **Restore captions** | Restore captions and issues from `.backup` |

External **Ostris / AI-Toolkit** training jobs also appear in the jobs drawer once
[configured](docs/configuration.md#paths-integrations-and-logging).

Quick LoRA training needs AI-Toolkit on `http://127.0.0.1:8675`; the menu entry stays disabled
otherwise. **Edit template** opens that model's YAML from `ostris-templates/` for the current run
only — the file on disk is never written.

Process with ComfyUI needs ComfyUI at `http://127.0.0.1:9000` (override with `COMFY_BASE_URL`). The
menu entry is listed whenever a preset exists in [`comfy-workflows/`](comfy-workflows/). See
**[Process with ComfyUI](docs/comfyui.md)**.

### Where your data lives

| Kind | Location |
| --- | --- |
| Captions, caption issues, duplicate groups, `.sysprompt` | Next to your media, so they travel with the dataset |
| Edit originals (`.bak`) and the edit that produced the current file (`.edit.json`) | Next to the image or video; hidden from the gallery, and carried along by move, copy, rename, and delete |
| ComfyUI candidates (`staging/` + `.comfy.json`) | Under the dataset folder, paired with the source by stem as `<stem>.png`. A move or copy of the source leaves the candidate behind |
| App preferences, job history, thumbnails | `backend/data/` — gitignored SQLite plus cache |
| Verify-captions additional context | Per folder, in the app database |
| UI session state (search, gallery filters) | Browser session storage |
| UI preferences (sort order, automation spec visibility) | Server-side, not only the browser |

## System requirements

### App only

Gallery browsing, caption editing, image and video editing, strip metadata, watermark, set captions,
and rename. Video work uses the ffmpeg that ships with the Python dependencies; image work uses
Pillow. No GPU.

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Windows 10/11, Linux, or macOS | Windows 11 or a recent Linux |
| **CPU** | Dual-core, 64-bit | Quad-core or better |
| **RAM** | 8 GB | 16 GB |
| **Disk** | ~2 GB free for app and dependencies | SSD, with room for datasets and thumbnails |
| **Software** | Python / Node, or Windows `setup.bat` — see [Quick start](#quick-start) | Same |

### Vision LLM jobs

Hardware here is driven by **the model you load** in llama.cpp, Unsloth, or similar — not by
DataForge, which only calls an OpenAI-compatible HTTP endpoint.

| | Minimum (lighter models) | Optimal (recommended models) |
| --- | --- | --- |
| **GPU** | NVIDIA with **8–12 GB** VRAM | NVIDIA with **24 GB** VRAM (RTX 3090 / 4090 class) |
| **System RAM** | **16 GB** | **32 GB** or more |
| **Storage** | Fast SSD with room for weights (several GB to tens of GB per quant) | NVMe SSD |
| **Typical models** | See [suggested models](docs/configuration.md#vision-llm) | Same |
| **Software** | A local OpenAI-compatible vision server with a vision model loaded | Same, with VRAM for quality quants and longer contexts |

[Audio captioning](docs/configuration.md#audio-captioning) additionally needs an omni model that
accepts audio input.

## Configuration

Copy [`.env.example`](.env.example) to `.env` in the project root and restart the backend after
editing. The file is gitignored. OS and shell environment variables always win over it.

For AI jobs, set the `OPENAI_*` variables so DataForge can reach a local OpenAI-compatible vision
server. The defaults assume that server is on `http://127.0.0.1:8888/v1`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATAFORGE_API_PORT` | `18080` | **Development only** — port the API binds, and the Vite `/api` proxy target |
| `DATAFORGE_UI_PORT` | `18081` | The port you open |

Ports, model choices, audio captioning, sampling knobs, and integration paths are in
**[Configuration](docs/configuration.md)**.

## Development

Working on DataForge itself? Use `dev.bat` (or `.\dev.ps1`) instead of `start.bat` — two consoles,
hot reload, and Vite proxying `/api`.

Launcher flags, project layout, generated frontend types, and the command list are in
**[Development](docs/development.md)**.

## Security and privacy

- Sidecars live alongside your datasets; app state stays under gitignored `backend/data/`
- Do not commit real API keys, personal paths, or local caches
- See **[SECURITY.md](SECURITY.md)** for reporting issues and local-data guidance

## Contributing

Issues and pull requests are welcome — open one if something is missing or broken.

Before submitting, run `python scripts/run_checks.py` from the project root; it runs the same lint,
typecheck, and test suite as [CI](.github/workflows/checks.yml). Installing the git hooks with
`scripts/install-git-hooks.ps1` (or `.sh`) does this automatically. Coding conventions live in
[AGENTS.md](AGENTS.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
