# DataForge

**Local-first gallery and automation for image/video caption datasets.**

Browse folders of media, edit captions and bounding boxes, run background AI jobs, and keep every sidecar next to your files.
Built for people who curate training data for generative models (LoRAs, fine-tunes, and similar workflows).

No cloud account is required.
Processing stays on your machine.

[Features](#features) · [System requirements](#system-requirements) · [Quick start](#quick-start) · [Configuration](#configuration) · [Development](#development) · [Security](SECURITY.md) · [License](#license)

---

## Why DataForge?

Most dataset tools either push you into a cloud UI or leave you juggling scripts and folders.
DataForge is a **desktop web app** you run locally:

- Your media and sidecars stay in **your** folder structure
- Captions save as standard `.txt` / `.json` next to each file
- Optional vision LLMs talk to a **local** OpenAI-compatible server
- Jobs run in the background with progress, cancel, and history

Ideal when you already keep datasets on disk and want a fast, visual workflow.

---

## Features

### Gallery and navigation

- Virtualized grid for large folders
- Subfolders, breadcrumbs, favorites, and recent history
- Drive / folder picker
- Search by file name, folder name, or caption (regex optional; **Ctrl+K** / **⌘K** focuses search)
- Filters: all / captioned / issues / missing caption · images / videos
- Sort: name, modified date, caption length, megapixels
- WebP thumbnails and responsive layout
- Folder cards show a warning when the folder has caption issues

### Captions and metadata

- In-place caption editing (`.txt` and `.json` sidecars)
- JSON caption editor and bounding-box overlay (view and edit when present)
- Click-to-zoom on images in the detail and issue-resolver views
- Open the current image in the OS image viewer (Windows)
- Per-folder `.sysprompt` (markdown) to guide AI captioning
- Caption status on cards and in the detail view
- Detection of embedded ComfyUI workflows in PNGs
- Drag-and-drop import (media, sidecars, `.sysprompt`)
- Delete media (and matching sidecars, including `.issue.json`)
- Move selected files; create subfolders

### Automation jobs

Jobs run in the background with a drawer for progress, cancel, and history:

| Job | What it does |
| --- | --- |
| **Auto-caption** | Completes short drafts with a local vision LLM (thinking or instruct mode) |
| **Verify captions** | Checks captions against images; writes `.issue.json` when something is wrong |
| **Issue resolver** | Step through flagged files, edit captions, resolve or skip |
| **Body parts** | YOLO + SAM → Ideogram-style JSON elements (weights auto-download if missing) |
| **Strip metadata** | Strip embedded data from PNGs and MP4s |
| **Set captions** | Apply the same text to many files |
| **Batch rename** | Numbered rename of media + related sidecars |

External **Ostris / AI-Toolkit** training jobs can also appear in the jobs drawer when configured.

### Local-first data model

| Kind | Where it lives |
| --- | --- |
| Captions, issues, `.sysprompt` | Next to media (portable with the dataset) |
| App preferences, job history, thumbnails | `backend/data/` (gitignored SQLite + cache) |
| UI session state (search, gallery filters) | Browser session storage |

Verify-captions **additional context** is stored **per folder** in the app database.
Body-parts dialog fields and UI prefs (sort, automation specs visibility) are also stored server-side.

---

## System requirements

### App only (browse, edit captions, non-AI jobs)

Enough for gallery browsing, caption editing, strip metadata, set captions, and batch rename.

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Windows 10/11, Linux, or macOS | Windows 11 or recent Linux |
| **CPU** | Dual-core, 64-bit | Quad-core or better |
| **RAM** | 8 GB | 16 GB |
| **Disk** | ~2 GB free for app + deps | SSD; more free space for datasets and thumbnails |
| **Software** | See [Quick start](#quick-start) (Python / Node, or Windows `setup.bat`) | Same |

### Vision LLM jobs (auto-caption / verify)

Hardware is driven by the **model you load** in LM Studio, llama.cpp, vLLM, or similar—not by DataForge itself.
DataForge only calls an OpenAI-compatible HTTP endpoint.

| | Minimum (lighter models) | Optimal (recommended models) |
| --- | --- | --- |
| **GPU** | NVIDIA with **8–12 GB** VRAM | NVIDIA with **24 GB** VRAM (e.g. RTX 3090 / 4090 class) |
| **System RAM** | **16 GB** | **32 GB** or more |
| **Storage** | Fast SSD; room for model weights (several GB to tens of GB per quant) | NVMe SSD |
| **Typical models** | [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct), [Qwen3.5 9B](https://huggingface.co/Qwen/Qwen3.5-9B) (quantized) | [Qwen3.6 27B](https://huggingface.co/Qwen/Qwen3.6-27B), [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) (MoE alternative) |
| **Software** | Local OpenAI-compatible vision server with a vision model loaded | Same, with enough VRAM for quality quants and longer contexts |

### Body-parts job (YOLO + SAM)

Default `pip install` uses **CPU** PyTorch.
Install a CUDA torch build before relying on body-parts on GPU.

Body-parts weights when missing:

- `yolo26x.pt` — [Ultralytics assets](https://github.com/ultralytics/assets)
- `yolov8n-face.pt` — [yolov8-face](https://github.com/derronqi/yolov8-face)
- `sam3.1.pt` — [Meta SAM 3.1](https://huggingface.co/facebook/sam3.1) (gated; set `HF_TOKEN` if needed)

---

## Quick start

### Windows

1. **Setup (once)**  
   Double-click `setup.bat` in the project root.  
   This downloads Python 3.12.6 → `.python/`, Node 20.19.0 → `.node/`, creates `backend/.venv`, and installs dependencies.

2. **Run**  
   Double-click `start.bat` (or run `.\start.ps1` in PowerShell).  
   - Backend and frontend open in separate consoles  
   - Browser opens **http://localhost:8081**  
   - API listens on **http://localhost:8080** (Vite proxies `/api`)

3. **Optional AI config**  
   Copy `.env.example` to `.env` in the project root and set `OPENAI_*` (and other) variables.  
   The backend loads `.env` automatically on startup (see [Configuration](#configuration)).

4. **Daily use**  
   After the first setup, only `start.bat` is needed.  
   Re-run `setup.bat` when you want to refresh dependencies.

Stop servers with **Ctrl+C** in each console window, or by closing those windows.

### Linux / macOS (or global Python/Node)

- Python **3.11+** (venv)
- Node.js + npm (Node **20+** recommended)

From the **project root**:

```bash
# One-time setup
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend && npm install && cd ..

# Terminal 1 — API
backend/.venv/bin/python scripts/dev_server.py

# Terminal 2 — UI
cd frontend && npm run dev
```

Open **http://localhost:8081**.

Windows PowerShell helpers (`start-backend.ps1`, `start-frontend.ps1`) prefer `.python` / `.node` when present.

### Try the sample dataset

Point the app at `sample-images/` in this repo for a tiny folder with mixed caption states (`.txt`, `.json`, and uncaptioned).

---

## Configuration

### Local `.env` file (recommended with `start.bat`)

On startup the backend loads the first existing file:

1. Project root `.env` (next to `start.bat`)
2. `backend/.env`

OS / shell env vars are not overwritten. `.env` is gitignored — copy [`.env.example`](.env.example) and restart the backend after edits.

### Vision LLM (auto-caption / verify)

DataForge talks to any **OpenAI-compatible** vision endpoint.
Load one of the models below (or an equivalent quant) in LM Studio / llama.cpp / vLLM before running AI jobs.
Set `OPENAI_MODEL` to the **id your server exposes** (not necessarily the Hugging Face repo name).
Values can live in `.env` or the OS environment.

**Suggested models (best first):**

- [Qwen3.6 27B](https://huggingface.co/Qwen/Qwen3.6-27B) — recommended default
- [Qwen3.6 27B Fable Fusion by DavidAU](https://huggingface.co/DavidAU/Qwen3.6-27B-Fable-Fusion-711-Uncensored-Heretic-NM-DAU-NEO-MAX-MTP-GGUF) — strongest option; uncensored, multi-stage fine tune
- [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) — MoE alternative
- [Qwen3.6 35B A3B Uncensored by HauhauCS](https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive) — Uncensored MoE alternative with fewer refusals
- [Qwen3 VL 8B Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) — lighter VLM for smaller GPUs
- [Qwen3.5 9B](https://huggingface.co/Qwen/Qwen3.5-9B) — weak; usable only when VRAM is tight

**Also workable with some prompt/server tweaks:**

- [Gemma 4 31B it](https://huggingface.co/google/gemma-4-31B-it)
- [Gemma 4 26B A4B it](https://huggingface.co/google/gemma-4-26B-A4B-it)

**Environment variables** (optional; defaults target a local server; set in `.env` or the OS environment):

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_BASE_URL` | `http://127.0.0.1:1234/v1` | OpenAI-compatible base URL |
| `OPENAI_API_KEY` | `sk-1234` | Placeholder key for local servers |
| `OPENAI_MODEL` | `qwen35moe` | Chat `model` id (must match the id your server exposes) |
| `OPENAI_MAX_TOKENS` | `8192` | Completion max tokens |
| `OPENAI_THINKING_TEMPERATURE` | `1.0` | Sampling temperature in thinking mode |
| `OPENAI_THINKING_PRESENCE_PENALTY` | `0.0` | Presence penalty in thinking mode |
| `OPENAI_THINKING_TOP_P` | `0.95` | Top-p in thinking mode |
| `OPENAI_THINKING_MIN_P` | `0.0` | Min-p in thinking mode (via `extra_body`) |
| `OPENAI_INSTRUCT_TEMPERATURE` | `0.7` | Sampling temperature in instruct mode |
| `OPENAI_INSTRUCT_PRESENCE_PENALTY` | `1.5` | Presence penalty in instruct mode |
| `OPENAI_INSTRUCT_TOP_P` | `0.8` | Top-p in instruct mode |
| `OPENAI_INSTRUCT_MIN_P` | `0.0` | Min-p in instruct mode (via `extra_body`) |
| `OPENAI_TOP_K` | `20` | Top-k (via `extra_body`) |

Many single-model local servers ignore a wrong `OPENAI_MODEL` string and still answer.
Multi-model servers need the id to match the loaded model.

### Hugging Face (SAM download)

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` | Auth for gated SAM weights |

### Ostris / AI-Toolkit jobs (optional)

| Variable | Purpose |
| --- | --- |
| `OSTRIS_TOOLKIT_ROOT` | Path to an AI-Toolkit install so external train jobs can be listed |

### App database

| Variable | Purpose |
| --- | --- |
| `DATAFORGE_DB_PATH` | Override SQLite path (default under `backend/data/`) |
| `DATAFORGE_THUMBNAIL_CACHE` | Override thumbnail cache directory |

Preferences (UI sort, body-parts fields, verify mode, **per-folder verify context**, etc.) live in the SQLite app DB, not only in the browser.

---

## Project layout

```text
DataForge/
├── backend/           # FastAPI, jobs, captions, media I/O, automation
│   ├── automation/    # Job runners + YOLO/SAM weights (downloaded locally)
│   ├── data/          # Local SQLite + thumbnails (gitignored)
│   └── routes/        # HTTP API
├── frontend/          # React + TypeScript + Vite UI
├── scripts/           # Dev server, lint, tests, git hooks
├── .github/workflows/ # CI (run_checks.py)
├── sample-images/     # Tiny example dataset
├── .env.example       # Sample backend env vars (copy to .env)
├── .env               # Local secrets/config (gitignored; optional)
├── setup.bat          # Windows self-contained install
├── start.bat / .ps1   # Launchers
├── SECURITY.md
└── LICENSE            # Apache-2.0
```

---

## Development

Run tooling from the **project root** with the backend venv:

| Task | Command |
| --- | --- |
| API (hot reload) | `backend/.venv/.../python scripts/dev_server.py` |
| Full checks | `python scripts/run_checks.py` (also runs on GitHub Actions via `.github/workflows/checks.yml`) |
| Backend lint | `python scripts/run_lint.py` (`--fix` to auto-fix) |
| Backend tests | `python scripts/run_tests.py` |
| Frontend tests | `cd frontend && npm test` |
| Frontend lint / format | `cd frontend && npm run lint` / `npm run format` |
| Git hooks | `scripts/install-git-hooks.ps1` or `.sh` |

Windows venv Python: `backend\.venv\Scripts\python.exe`  
Unix venv Python: `backend/.venv/bin/python`

---

## Stack

- **Backend:** Python 3.11+, FastAPI, SQLite, Pillow, optional OpenAI client + Ultralytics  
- **Frontend:** React 19, TypeScript, Vite, SCSS  
- **Local AI:** Any OpenAI-compatible vision endpoint  

---

## Security and privacy

- Sidecars live with your datasets; app state stays under gitignored `backend/data/`
- Do not commit real API keys, personal paths, or local caches  
- See **[SECURITY.md](SECURITY.md)** for reporting issues and local-data guidance  

---

## License

Licensed under the [Apache License 2.0](LICENSE).

---

Feedback and contributions are welcome.
Open an issue or pull request if something is missing or broken.
