# DataForge

**A local-first gallery and automation app for image and video caption datasets.**

DataForge is for people who curate training data for LoRAs, fine-tunes, and similar workflows. It puts browsing, captioning, quality review, media editing, and bulk operations over the folders you already keep on disk.

[![Checks](https://github.com/dremme/dataforge/actions/workflows/checks.yml/badge.svg)](https://github.com/dremme/dataforge/actions/workflows/checks.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20.19%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#requirements)

[Quick start](#quick-start) · [What you can do](#what-you-can-do) · [Documentation](#documentation) · [Configuration](docs/configuration.md) · [Contributing](#contributing)

![DataForge gallery showing a local dataset, bulk caption controls, completion status, and generated descriptions beneath media cards.](docs/gallery.png)

_Browse a folder, track caption status, and review generated descriptions from one gallery._

## Why DataForge

DataForge works directly with filesystem datasets. Captions remain ordinary `.txt` sidecars beside the media, and app state stays on your machine. Browsing, manual captioning, media editing, and most bulk tools need no cloud account or AI service.

AI and processing integrations are optional. Their default endpoints are local, but DataForge also accepts configurable URLs. If you point one at a remote server, the data required for that operation leaves your machine.

## Quick start

### Windows

1. Run `setup.bat` once. It downloads project-local Python and Node runtimes and installs the dependencies.
2. Run `start.bat` to build when needed, start DataForge, and open `http://localhost:18081`.

### Linux and macOS

1. Install Python 3.12+ and Node 20.19+ with npm, then run `./setup.sh` once.
2. Run `./start.sh` to build when needed, start DataForge, and open `http://localhost:18081`.

See [Getting started](docs/getting-started.md) for launcher options, stopping and updating, manual setup, the sample dataset, and startup troubleshooting.

## Your first workflow

AI is optional; you can browse, organize, and write captions by hand without configuring a model.

1. Open a dataset folder or start with [`sample-images/`](sample-images/).
2. Inspect the gallery, then search, sort, or filter to find the files that need work.
3. If you use AI captioning, edit the folder's `.sysprompt` to describe the captions you want.
4. Select files to scope a job, or leave the selection empty to work on the current folder.
5. Review the results, edit captions, and resolve any issues, duplicates, or staged candidates.

The [user guide](docs/user-guide.md) covers job scope and the complete folder-to-caption workflow.

## What you can do

### Browse and organize

Browse large folders in a virtualized gallery with live filesystem updates, breadcrumbs, favorites, recent locations, drag-and-drop import, and large-card, small-card, or list views. Search names and captions with optional regex; filter by caption state, media type, issues, duplicates, or candidates; and sort by name, modified time, caption length, megapixels, or duration. Create folders and copy, move, delete, or **Rename** media with its related sidecars.

DataForge catalogs JPG/JPEG, PNG, WebP, BMP, GIF, MP4, AVI, MOV, MKV, WMV, M4V, and FLV files. The [format and capability matrix](docs/user-guide.md#supported-formats-and-capability-matrix) records which formats support playback, editing, metadata tools, and integrations.

### Write and inspect captions

Edit `.txt` captions in place, see caption state in the gallery and detail view, and keep per-folder AI instructions in `.sysprompt`. Inspect embedded ComfyUI prompts, LoRAs, and settings where supported.

- **Auto-caption** completes short drafts from media with a configured vision model and can include video audio.
- **Set captions** applies the same text to many files.
- **Find & replace** changes literal or regex matches and can prepend or append text.
- **Edit captions** rewrites caption text from an instruction without sending the media.

### Review dataset quality

Step through caption issues, compare perceptual duplicate groups, and accept or reject staged processing candidates. Sweep `.issue.json` or `.duplicate.json` findings without deleting media. Folder statistics cover caption coverage, issues, duplicate files and groups, caption length, frequent words, media types and extensions, video duration, megapixels, aspect ratio, and unknown metadata.

- **Verify captions** compares captions with media and records problems in `.issue.json`.
- **Find duplicates** groups perceptual matches for side-by-side resolution.
- **Backup captions** copies `.txt` sidecars into `.backup` while preserving existing copies unless overwrite is selected.
- **Restore captions** restores backed-up captions only when matching media still exists.

### Edit media

Crop, rotate, mirror, resize, and adjust brightness, contrast, saturation, warmth, or hue on images. Trim and change the speed or volume of videos, or crop, resize, and apply the same color controls. Add multiple blur, pixelate, or blackout regions to images and videos; capture GIF and video frames as JPG files; and convert GIFs to MP4. Stored originals keep edits reversible.

- **Watermark** writes marked copies to a `watermarked` folder and can strip their metadata.
- **Strip metadata** removes supported embedded metadata without changing captions.

### Automate in bulk

Jobs run in the background with progress, cancellation, and history. A selection scopes most jobs to those paths; without a selection, they use the current folder. See the [job reference](docs/user-guide.md#job-reference) for outputs, prerequisites, and reversibility.

### Train and process with integrations

- **Quick LoRA training** starts a whole-folder AI-Toolkit run with Krea 2 Turbo, MiniMax H3, or MiniMax H3 Ref2VA templates.
- **Process with ComfyUI** sends still images through a preset and places PNG candidates in `staging/` for review before publication.

## Optional integrations

| Integration                     | Required | Default endpoint           | Setup and behavior                                                      |
| ------------------------------- | -------- | -------------------------- | ----------------------------------------------------------------------- |
| OpenAI-compatible vision server | No       | `http://127.0.0.1:8888/v1` | [Vision LLM configuration](docs/configuration.md#vision-llm-connection) |
| ComfyUI                         | No       | `http://127.0.0.1:9000`    | [ComfyUI guide](docs/comfyui.md)                                        |
| AI-Toolkit                      | No       | `http://127.0.0.1:8675`    | [AI-Toolkit guide](docs/ai-toolkit.md)                                  |

For AI jobs, copy `.env.example` to `.env`, set the connection values, and restart DataForge:

```dotenv
OPENAI_API_BASE_URL=http://127.0.0.1:8888/v1
OPENAI_API_KEY=
OPENAI_MODEL=qwen38
```

The [configuration recipes and environment reference](docs/configuration.md) cover model choices, media input budgets, audio, sampling, ports, storage, logging, and data sent to each integration.

## How DataForge stores your data

- Dataset sidecars stay beside the media: `.txt` captions, `.sysprompt` instructions, quality findings, and related metadata.
- Reversible media edits keep an original and an edit specification next to the source; gallery actions carry related edit files with the media.
- Generated copies, review candidates, and caption backups use `watermarked/`, `staging/`, and `.backup/`. Caption backup and restore operate on `.txt` sidecars only; they do not include `.issue.json` findings.
- Preferences, job history, per-folder context, and thumbnails live in the gitignored app database and cache under `backend/data/` by default.

See [Files DataForge creates](docs/user-guide.md#files-dataforge-creates) for the full artifact and lifecycle table.

## Requirements

DataForge supports Windows 10/11, Linux, and macOS. The Windows setup script installs self-contained project runtimes; Linux and macOS require Python 3.12+ and Node 20.19+ with npm.

The core app does not require a GPU. AI hardware requirements depend on the model and server you choose. See the [core and vision requirements](docs/getting-started.md#system-requirements) for current guidance.

## Documentation

| Page                                       | Use it for                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [Documentation home](docs/README.md)       | Find a guide by audience or task                                         |
| [Getting started](docs/getting-started.md) | Install, launch, update, stop, and troubleshoot DataForge                |
| [User guide](docs/user-guide.md)           | Learn gallery workflows, jobs, editing, formats, sidecars, and shortcuts |
| [Configuration](docs/configuration.md)     | Connect models and services or change app settings                       |
| [ComfyUI](docs/comfyui.md)                 | Configure safe processing and candidate review workflows                 |
| [AI-Toolkit](docs/ai-toolkit.md)           | Configure and monitor LoRA training                                      |
| [Development](docs/development.md)         | Run hot reload, understand the codebase, and use contributor commands    |
| [Agent instructions](AGENTS.md)            | Follow repository conventions and generated-file rules                   |
| [Security policy](SECURITY.md)             | Report vulnerabilities and review local-data guidance                    |
| [License](LICENSE)                         | Read the Apache 2.0 terms                                                |

## Contributing

Issues and pull requests are welcome. Before submitting a change, run the repository quality gate from the project root:

```text
# Windows
backend/.venv/Scripts/python scripts/run_checks.py --fix

# Linux and macOS
backend/.venv/bin/python scripts/run_checks.py --fix
```

See [Development](docs/development.md) for setup and commands, and [AGENTS.md](AGENTS.md) for repository conventions.

## Security and privacy

DataForge does not upload datasets on its own. Configured AI and processing endpoints receive the inputs required by their jobs; remote endpoint URLs therefore move those inputs off-machine. Keep `.env`, app data, personal paths, and real datasets out of commits, and read the [security policy](SECURITY.md) for reporting and local-data guidance.

## License

Licensed under the [Apache License 2.0](LICENSE).
