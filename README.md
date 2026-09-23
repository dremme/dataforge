# DataForge

**A local gallery and automation app for image and video caption datasets.**

[![Checks](https://github.com/dremme/dataforge/actions/workflows/checks.yml/badge.svg)](https://github.com/dremme/dataforge/actions/workflows/checks.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20.19%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](docs/getting-started.md#requirements)

![DataForge gallery showing a local dataset, bulk caption controls, completion status, and generated descriptions beneath media cards.](docs/gallery.png)

DataForge is for people who curate training data for LoRAs and fine-tunes. Point it at a folder you already have: captions stay plain `.txt` files next to the media, and nothing is imported, uploaded, or locked into a library.

## Quick start

**Windows** — run `setup.bat` once, then `start.bat`. Setup downloads its own Python and Node; nothing global is needed.

**Linux and macOS** — install Python 3.12+ and Node 20.19+, then:

```bash
./setup.sh
./start.sh
```

The app opens at `http://localhost:18081`. Try it on [`sample_images/`](sample_images/), a small dataset with one of everything. More in [Getting started](docs/getting-started.md).

## What it does

- **Browse** large folders with live updates, search (including regex), filters, sorting, and card or list views.
- **Caption** by hand with autosave, backups, and word completion, or in bulk with set, find & replace, and AI rewrite.
- **Auto-caption** images and video with any OpenAI-compatible vision model, optionally including the audio track.
- **Review quality**: have the model check captions against the media, find near-duplicates, and read folder statistics.
- **Edit media** without losing the original: crop, resize, color, trim, speed, and blur or blackout regions. Watermark copies or strip metadata in bulk.
- **Process** media through ComfyUI workflows, and review every result before it replaces a source.
- **Train** a LoRA on the current folder through AI-Toolkit.

AI is optional. Browsing, manual captioning, editing, and most bulk tools work without a model. Each AI feature talks to a separate service you run yourself:

| Service                         | Default address            | Setup                                                         |
| ------------------------------- | -------------------------- | ------------------------------------------------------------- |
| OpenAI-compatible vision server | `http://127.0.0.1:8888/v1` | [Connect a vision model](docs/configuration.md#connect-a-vision-model) |
| ComfyUI                         | `http://127.0.0.1:9000`    | [ComfyUI guide](docs/comfyui.md)                              |
| AI-Toolkit                      | `http://127.0.0.1:8675`    | [AI-Toolkit guide](docs/ai-toolkit.md)                        |

## Your data stays local

- Captions, AI instructions (`.sysprompt`), and review findings are small files beside your media.
- Edits keep the original beside the file, so they can always be reverted.
- App state and thumbnails live in `backend/data/`.
- AI and ComfyUI endpoints default to `127.0.0.1`. If you point one at another machine, the media for that job goes there. See [what each job sends](docs/configuration.md#data-sent-to-integrations).

## Documentation

| Guide                                      | Covers                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md) | Install, run, update, and troubleshoot startup                            |
| [User guide](docs/user-guide.md)           | Gallery, captions, jobs, media editing, formats, files, shortcuts         |
| [Configuration](docs/configuration.md)     | Connect a vision model, tune it, and change ports, paths, and logging     |
| [ComfyUI](docs/comfyui.md)                 | Process media through workflows and review the results                    |
| [AI-Toolkit](docs/ai-toolkit.md)           | Start and monitor LoRA training                                           |
| [Development](docs/development.md)         | Hot reload, project layout, generated code, and checks                    |

## Contributing

Issues and pull requests are welcome. Read [Development](docs/development.md) and [AGENTS.md](AGENTS.md), then run the full check suite from the project root before you submit:

```bash
backend/.venv/Scripts/python scripts/run_checks.py --fix
```

On Linux and macOS, use `backend/.venv/bin/python`. Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
