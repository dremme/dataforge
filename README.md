# DataForge

**Local-first gallery and automation for image and video caption datasets.**

Browse folders of media, edit captions, run automated AI jobs, and keep every sidecar next to your files.
Built for people who curate training data for generative models — LoRAs, fine-tunes, and similar workflows.

[![Checks](https://github.com/dremme/dataforge/actions/workflows/checks.yml/badge.svg)](https://github.com/dremme/dataforge/actions/workflows/checks.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#system-requirements)

[Quick start](#quick-start) · [Features](#features) · [Requirements](#system-requirements) · [Configuration](#configuration) · [Development](#development) · [Security](SECURITY.md) · [License](#license)

<!-- A screenshot or short GIF of the gallery belongs here once one is available. -->

## Overview

Most dataset tools either push you into a cloud UI or leave you juggling scripts and folders.
DataForge is a **desktop web app** you run locally — no cloud account, no upload step, nothing leaves your machine.

- Your media and sidecars stay in **your** folder structure
- Captions save as standard `.json` / `.txt` files next to each image or video
- Optional vision LLMs talk to a **local** OpenAI-compatible server
- Jobs run in the background with progress, cancel, and history

Ideal when you already keep datasets on disk and want a fast, visual workflow over them.

## Quick start

### Windows

**1. Setup (once)** — double-click `setup.bat` in the project root.
It downloads Python 3.12.6 → `.python/` and Node 20.19.0 → `.node/`, creates `backend/.venv`, installs all dependencies,
and generates the frontend's view of the backend API — see [Generated frontend code](#generated-frontend-code).

**2. Run** — double-click `start.bat`, or run `.\start.ps1` in PowerShell. The launcher:

- Frees the dev ports first, if a previous run left a server behind
- Opens the backend and frontend in separate consoles
- Waits until the API answers `/api/health` and Vite is listening, *then* opens **http://localhost:8081**
- Stays open as a supervisor — press any key in it to stop both servers

The API listens on **http://localhost:8080** and Vite proxies `/api` to it. Both ports are configurable; see [Dev server ports](#dev-server-ports).

**3. Optional AI config** — copy `.env.example` to `.env` in the project root and set the `OPENAI_*` variables.
The backend loads `.env` automatically on startup. See [Configuration](#configuration).

**4. Daily use** — only `start.bat` is needed from then on. Re-run `setup.bat` to refresh dependencies.

To stop the servers: press any key in the launcher window, hit **Ctrl+C** in each console, or run `stop.bat`.
`stop.bat` also clears a uvicorn reload child left behind by closing a console with the X button.

`start.bat` passes flags through to `start.ps1`:

| Flag | Effect |
| --- | --- |
| `-BackendOnly` / `-FrontendOnly` | Start just one server |
| `-NoBrowser` | Do not open the browser |
| `-NoReload` | Run the API without the uvicorn reloader — use this while a long job is running, since a reload re-runs job recovery and re-spawns worker threads mid-flight |
| `-Detach` | Exit once both are ready instead of supervising; stop them later with `stop.bat` |

### Linux, macOS, or a global Python/Node

Requires Python **3.11+** and Node **20+** with npm. From the **project root**:

```bash
# One-time setup
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend && npm install && cd ..

# Required before the frontend will start — see "Generated frontend code"
backend/.venv/bin/python scripts/generate_types.py

# Terminal 1 — API
backend/.venv/bin/python scripts/dev_server.py

# Terminal 2 — UI
cd frontend && npm run dev
```

Then open **http://localhost:8081**.

On Windows, `start-backend.ps1` and `start-frontend.ps1` run a single server in the current terminal and prefer
`.python` / `.node` when present. They share `scripts/dev-common.ps1` with `start.ps1` / `stop.ps1`, so port cleanup
and the dependency-drift warning behave identically everywhere.

### Try the sample dataset

Point the app at [`sample-images/`](sample-images/) in this repo — a tiny folder with mixed caption states (`.json`, `.txt`, and uncaptioned).

## Features

### Gallery and navigation

- Virtualized grid that stays smooth on large folders
- Live updates — the server watches the open folder and pushes changes, so files added, edited, or removed
  outside DataForge appear without a refresh
- Subfolders, breadcrumbs, favorites, and recent history
- Copy the current folder path, or open it in File Explorer (Windows)
- Drive and folder picker
- Search by file name, folder name, or caption, with optional regex (**Ctrl+K** / **⌘K** focuses search)
- Filters for all / captioned / issues / missing caption, and images / videos (GIFs count as videos)
- Sort by name, modified date, caption length, or megapixels
- WebP thumbnails and a responsive layout
- Folder cards flag when a folder has caption issues

### Captions and metadata

- In-place caption editing for `.json` and `.txt` sidecars
- JSON caption editor with a bounding-box overlay — view and edit when present
- Issue resolver — step through flagged files to edit, resolve, or skip
- Click-to-zoom in the detail and issue-resolver views
- Open the current image in the OS image viewer (Windows)
- Save any video or GIF frame as a JPG beside the source; scrub to the frame and the filename carries its timestamp (video) or frame index (GIF), so each frame is its own file
- Per-folder `.sysprompt` (markdown) to steer AI captioning
- Caption status on cards and in the detail view
- Detection of embedded ComfyUI workflows in PNGs
- Drag-and-drop import for media, sidecars, and `.sysprompt`
- Delete media along with matching sidecars, including `.issue.json`
- Move or copy selected files, and create subfolders

### Automation jobs

Jobs run in the background, with a drawer for progress, cancel, and history. Progress is pushed over the same
event stream the gallery uses, so the drawer and automation panel follow a running job as it goes:

| Job | What it does |
| --- | --- |
| **Auto-caption** | Completes short drafts with a local vision LLM (thinking or instruct mode) |
| **Set captions** | Apply the same text to many files |
| **Verify captions** | Checks captions against the media — videos and GIFs via keyframes — and writes `.issue.json` when something is wrong |
| **Quick LoRA training** | Start a Krea 2 Turbo LoRA run on the current folder in AI-Toolkit |
| **Batch rename** | Numbered rename of media plus related sidecars |
| **Batch watermark** | Burn text onto JPG, PNG, and MP4 copies in a `watermarked` subfolder (size, opacity, position) |
| **Strip metadata** | Remove embedded data from PNGs and MP4s |
| **Backup captions** | Copy captions and caption issues into `.backup` |
| **Restore captions** | Restore captions and issues from `.backup` |

External **Ostris / AI-Toolkit** training jobs also appear in the jobs drawer once [configured](#paths-integrations-and-logging).

Quick LoRA training needs AI-Toolkit running on `http://127.0.0.1:8675`; the menu entry stays disabled otherwise.
AI-Toolkit owns the run and its training folder, while DataForge tracks it like any other job — progress and sample
images in the automation panel, and an external card in the jobs drawer.

### Where your data lives

| Kind | Location |
| --- | --- |
| Captions, issues, `.sysprompt` | Next to your media, so they travel with the dataset |
| App preferences, job history, thumbnails | `backend/data/` — gitignored SQLite plus cache |
| UI session state (search, gallery filters) | Browser session storage |

Verify-captions **additional context** is stored **per folder** in the app database, and UI preferences
(sort order, automation spec visibility) are stored server-side rather than only in the browser.

## System requirements

### App only

Enough for gallery browsing, caption editing, strip metadata, watermark, set captions, and batch rename.

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Windows 10/11, Linux, or macOS | Windows 11 or a recent Linux |
| **CPU** | Dual-core, 64-bit | Quad-core or better |
| **RAM** | 8 GB | 16 GB |
| **Disk** | ~2 GB free for app and dependencies | SSD, with room for datasets and thumbnails |
| **Software** | Python / Node, or Windows `setup.bat` — see [Quick start](#quick-start) | Same |

### Vision LLM jobs

Hardware here is driven by **the model you load** in llama.cpp, Unsloth, or similar — not by DataForge,
which only calls an OpenAI-compatible HTTP endpoint.

| | Minimum (lighter models) | Optimal (recommended models) |
| --- | --- | --- |
| **GPU** | NVIDIA with **8–12 GB** VRAM | NVIDIA with **24 GB** VRAM (RTX 3090 / 4090 class) |
| **System RAM** | **16 GB** | **32 GB** or more |
| **Storage** | Fast SSD with room for weights (several GB to tens of GB per quant) | NVMe SSD |
| **Typical models** | [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct), [Qwen3.5 9B](https://huggingface.co/Qwen/Qwen3.5-9B) (quantized) | [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), [Qwen3.6 27B](https://huggingface.co/Qwen/Qwen3.6-27B) |
| **Software** | A local OpenAI-compatible vision server with a vision model loaded | Same, with VRAM for quality quants and longer contexts |

## Configuration

### The `.env` file

On startup the backend loads the **first** file that exists:

1. Project root `.env` — next to `start.bat`
2. `backend/.env`

OS and shell environment variables always win over the file. `.env` is gitignored — copy
[`.env.example`](.env.example) to get started, and restart the backend after editing.

### Dev server ports

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATAFORGE_API_PORT` | `8080` | Port the API binds. Also the Vite `/api` proxy target, and the port the launchers free and probe |
| `DATAFORGE_UI_PORT` | `8081` | Port the Vite dev server binds. Also drives the backend CORS allowlist |
| `DATAFORGE_API_HOST` | `127.0.0.1` | Interface the API binds (`scripts/dev_server.py` only) |

All four readers — [`frontend/vite.config.ts`](frontend/vite.config.ts), [`backend/server_settings.py`](backend/server_settings.py),
[`scripts/dev_server.py`](scripts/dev_server.py), and [`scripts/dev-common.ps1`](scripts/dev-common.ps1) — resolve these
from the same project-root `.env`, and an OS environment variable overrides the file in each.
Restart both servers after a change; Vite reads its port once at startup.

### Vision LLM

DataForge talks to any **OpenAI-compatible** vision endpoint. Load a model in llama.cpp, Unsloth, or similar before
running AI jobs, and set `OPENAI_MODEL` to the **id your server exposes** — not necessarily the Hugging Face repo name.

**Suggested models, best first:**

| Model | Notes |
| --- | --- |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | Recommended MoE default |
| [Qwen3.6 35B A3B Uncensored](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive) | MoE alternative with fewer refusals |
| [Qwen3.6 27B](https://huggingface.co/Qwen/Qwen3.6-27B) | Dense alternative |
| [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) | Lighter VLM for smaller GPUs |
| [Qwen3.5 9B](https://huggingface.co/Qwen/Qwen3.5-9B) | Weak; usable only when VRAM is tight |

[Gemma 4 31B it](https://huggingface.co/google/gemma-4-31B-it) and [Gemma 4 26B A4B it](https://huggingface.co/google/gemma-4-26B-A4B-it)
also work with some tuning. Gemma-family models typically want `OPENAI_INSTRUCT_REPEAT_PENALTY` around `1.1`, where the
Qwen3.6 defaults leave it disabled. They have no thinking mode, so run them in instruct mode and leave `OPENAI_THINKING_*` alone.

**Connection settings** — defaults target a local server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_BASE_URL` | `http://127.0.0.1:8888/v1` | OpenAI-compatible base URL |
| `OPENAI_API_KEY` | `EMPTY` | Not a credential. Local servers ignore it unless started with `--api-key` |
| `OPENAI_MODEL` | `qwen35moe` | Chat `model` id, matching what your server exposes |
| `OPENAI_MAX_TOKENS` | `8192` | Completion max tokens |
| `OPENAI_TIMEOUT` | `600` | Seconds to wait for a response before giving up |

Many single-model servers answer even with a wrong `OPENAI_MODEL`. Multi-model servers need the id to match.

`llama-server` defaults to port `8080`, which DataForge's API already uses. Start it on `8888` to match
`OPENAI_API_BASE_URL` above:

```bash
llama-server --port 8888 -m <model.gguf> --mmproj <mmproj.gguf>
```

`--mmproj` loads the multimodal projector, which llama.cpp keeps separate from the weights. Without it you get a
server that answers text but silently ignores images — which shows up here as captions describing nothing in
your media. No API key is needed unless you start the server with `--api-key`.

<details>
<summary><b>Sampling knobs</b> — per-mode temperature, penalties, and top-p/k</summary>

<br>

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_THINKING_TEMPERATURE` | `1.0` | Sampling temperature in thinking mode |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0` | Presence penalty in thinking mode |
| `OPENAI_THINKING_TOP_P` | `0.95` | Top-p in thinking mode |
| `OPENAI_THINKING_MIN_P` | `0.0` | Min-p in thinking mode (via `extra_body`) |
| `OPENAI_THINKING_REPEAT_PENALTY` | `1.0` | Repetition penalty in thinking mode (via `extra_body`) |
| `OPENAI_INSTRUCT_TEMPERATURE` | `0.7` | Sampling temperature in instruct mode |
| `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5` | Presence penalty in instruct mode |
| `OPENAI_INSTRUCT_TOP_P` | `0.8` | Top-p in instruct mode |
| `OPENAI_INSTRUCT_MIN_P` | `0.0` | Min-p in instruct mode (via `extra_body`) |
| `OPENAI_INSTRUCT_REPEAT_PENALTY` | `1.0` | Repetition penalty in instruct mode (via `extra_body`) |
| `OPENAI_TOP_K` | `20` | Top-k (via `extra_body`) |

`repeat_penalty` follows llama.cpp naming. Hugging Face– and vLLM-style stacks call the same knob
`repetition_penalty`, which is the spelling you will see on model cards — rename it if you point
DataForge at one of those servers.

</details>

### Paths, integrations, and logging

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` | Auth for gated SAM weights |
| `OSTRIS_TOOLKIT_ROOT` | Path to an AI-Toolkit install, so external train jobs can be listed |
| `DATAFORGE_DB_PATH` | Override the SQLite path (default is under `backend/data/`) |
| `DATAFORGE_THUMBNAIL_CACHE` | Override the thumbnail cache directory |
| `DATAFORGE_THUMBNAIL_CACHE_MAX_MB` | Thumbnail cache size ceiling (default `2048`). Least recently used entries are dropped past it; `0` never deletes |
| `DATAFORGE_LOG_LEVEL` | Backend log level (default `INFO`) |

## Development

### Tech stack

- **Backend** — Python 3.11+, FastAPI, SQLite, Pillow, with an optional OpenAI client and Ultralytics
- **Frontend** — React 19, TypeScript, Vite, SCSS
- **Local AI** — any OpenAI-compatible vision endpoint

### Project layout

```text
DataForge/
├── backend/           # FastAPI, jobs, captions, media I/O, automation
│   ├── automation/    # Job runners + YOLO/SAM weights (downloaded locally)
│   ├── data/          # Local SQLite + thumbnails (gitignored)
│   └── routes/        # HTTP API
├── frontend/          # React + TypeScript + Vite UI
│   └── src/shared/    # types.ts, constants.ts, wireGuards.ts are generated (gitignored)
├── scripts/           # Dev server, launcher helpers, lint, tests, git hooks
├── .github/workflows/ # CI (run_checks.py)
├── sample-images/     # Tiny example dataset
├── .env.example       # Sample env vars: ports, AI config (copy to .env)
├── .env               # Local secrets/config (gitignored; optional)
├── setup.bat          # Windows self-contained install
├── start.bat / .ps1   # Launchers
├── stop.bat / .ps1    # Frees the dev ports
├── SECURITY.md
└── LICENSE            # Apache-2.0
```

### Generated frontend code

`backend/schemas.py` and `backend/constants.py` are the single source of truth for the API contract.
[`scripts/generate_types.py`](scripts/generate_types.py) writes three files from them, so nothing is mirrored by hand:

| File | Contents |
| --- | --- |
| `frontend/src/shared/types.ts` | Every wire shape, from the published OpenAPI schema |
| `frontend/src/shared/constants.ts` | `constants.SHARED_CONSTANTS` |
| `frontend/src/shared/wireGuards.ts` | Runtime guards for `schemas.GUARDED_WIRE_MODELS` |

All three are **gitignored**, so a fresh clone does not have them, and two of them carry real values rather
than types alone — the frontend will not build or start until they exist. `setup.bat` generates them, and
`scripts/run_checks.py` regenerates them before anything compiles, lints, or tests. Generate them by hand after
a fresh clone on Linux or macOS, and whenever you change `schemas.py` or `constants.py` without running checks.

**Never edit these files.** They carry a `Do not edit` header and the next generator run overwrites them;
frontend-only shapes belong in the module that uses them.

### Commands

Run these from the **project root** using the backend venv Python — `backend\.venv\Scripts\python.exe` on
Windows, `backend/.venv/bin/python` on Unix:

| Task | Command |
| --- | --- |
| API with hot reload | `python scripts/dev_server.py` — accepts `--no-reload`, `--port`, `--host` |
| Full checks | `python scripts/run_checks.py` — the same suite CI runs |
| Regenerate API types | `python scripts/generate_types.py` — see [Generated frontend code](#generated-frontend-code) |
| Backend lint | `python scripts/run_lint.py` — add `--fix` to auto-fix |
| Backend tests | `python scripts/run_tests.py` |
| Frontend tests | `cd frontend && npm test` |
| Frontend lint / format | `cd frontend && npm run lint` / `npm run format` |
| Install git hooks | `scripts/install-git-hooks.ps1` or `.sh` |

## Security and privacy

- Sidecars live alongside your datasets; app state stays under gitignored `backend/data/`
- Do not commit real API keys, personal paths, or local caches
- See **[SECURITY.md](SECURITY.md)** for reporting issues and local-data guidance

## Contributing

Issues and pull requests are welcome — open one if something is missing or broken.

Before submitting, run `python scripts/run_checks.py` from the project root; it runs the same lint, typecheck,
and test suite as [CI](.github/workflows/checks.yml). Installing the git hooks with `scripts/install-git-hooks.ps1`
(or `.sh`) does this automatically. Coding conventions live in [AGENTS.md](AGENTS.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
