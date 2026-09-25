# Getting started

[Documentation](README.md)

## Install and run

### Windows

1. Run `setup.bat` once. It downloads Python 3.12 and Node 20 into the project (`.python/`, `.node/`), creates `backend/.venv`, installs all dependencies, and generates the frontend's API files.
2. Run `start.bat`. It builds the UI when needed, starts the server, and opens `http://localhost:18081`.

No global Python or Node is needed.

### Linux and macOS

Install Python 3.12+ and Node 20.19+, 22.13+, or 24+ with npm, then:

```bash
./setup.sh
./start.sh
```

If the right Python is not on `PATH`, point setup at it: `DATAFORGE_PYTHON=/path/to/python3.12 ./setup.sh`.

The first start takes a minute or two while the UI builds. Later starts reuse the build and take seconds.

## Open your first dataset

Open any folder from the app, or start with [`sample_images/`](../sample_images/). It has captioned and uncaptioned images, a flagged caption, an example `.sysprompt`, and a ComfyUI result waiting for review.

A typical first pass:

1. Look through the gallery. Filters and the statistics drawer show what still needs work.
2. Write captions in the detail view, or write a system prompt with **Create instructions** if you plan to auto-caption.
3. [Connect a vision model](configuration.md#connect-a-vision-model) only if you want **Auto-caption**, **Verify captions**, or **Edit captions**.
4. Select files to limit a job to them, or select nothing to run it on the whole folder.
5. Review the results and resolve any flagged captions, duplicates, or ComfyUI results.

The [user guide](user-guide.md) covers each step.

## Stop, restart, and update

The launcher stays open while DataForge runs. To stop, press a key in it, close it, or press `Ctrl+C`.

`stop.bat` and `./stop.sh` are only for a server nothing is supervising: one started with `-Detach`/`--detach`, or one left behind after its console was closed.

After pulling changes, just run `start.bat` or `./start.sh`. It notices dependency changes and rebuilds the UI when needed. Re-run setup after a runtime upgrade, or when the launcher asks you to.

### Launcher options

The production launcher serves the built UI and the API from one process, without hot reload. `start.bat` passes its flags to `start.ps1`.

| Windows      | Linux and macOS | Effect                                                           |
| ------------ | --------------- | ---------------------------------------------------------------- |
| `-Rebuild`   | `--rebuild`     | Rebuild the UI even if it looks current                          |
| `-NoBuild`   | `--no-build`    | Serve the existing build; fails if there is none                 |
| `-NoBrowser` | `--no-browser`  | Do not open a browser                                            |
| `-Detach`    | `--detach`      | Exit once the server is ready; stop it later with `stop.bat`/`./stop.sh` |

Don't combine the rebuild and no-build flags. To change the port, set `DATAFORGE_UI_PORT` in `.env`; see [Configuration](configuration.md#server-storage-and-logging). To work on DataForge itself, use the hot-reload launcher in [Development](development.md).

## Requirements

The app itself needs no GPU: a 64-bit dual-core CPU (quad-core recommended), 8 GB of memory (16 GB recommended), about 2 GB of disk for the app, and an SSD with room for your datasets and thumbnails. Windows 10/11, Linux, and macOS are supported. Image work uses Pillow; video work uses the ffmpeg bundled with the Python dependencies.

AI jobs run on whatever model server you choose, and that server sets the hardware bar:

|                | Smaller models                  | Recommended models                        |
| -------------- | ------------------------------- | ----------------------------------------- |
| GPU            | NVIDIA, 8–12 GB VRAM            | NVIDIA, 24 GB VRAM (RTX 3090 or 4090)     |
| System memory  | 16 GB                           | 32 GB or more                             |
| Storage        | SSD with room for model weights | NVMe SSD                                  |

Captioning audio needs an omni model and a server that accepts audio input.

## Run without the launchers

From the project root, on Linux and macOS:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend && npm ci && cd ..
backend/.venv/bin/python scripts/generate_types.py
cd frontend && npm run build && cd ..
backend/.venv/bin/python scripts/prod_server.py
```

On Windows:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend; npm ci; cd ..
backend/.venv/Scripts/python scripts/generate_types.py
cd frontend; npm run build; cd ..
backend/.venv/Scripts/python scripts/prod_server.py
```

Then open `http://localhost:18081`. Rebuild the UI after changing frontend sources.

## Troubleshooting

**Setup cannot find Python or Node.** Windows setup downloads its own. On Linux and macOS, install a supported version and re-run `./setup.sh`, setting `DATAFORGE_PYTHON` if Python lives elsewhere.

**`--no-build` says there is no build.** It only serves an existing build. Start once without it, or run `cd frontend && npm run build`.

**A port is in use.** Close the earlier launcher, or run `stop.bat`/`./stop.sh` to clear a leftover DataForge server. The launcher never kills a process that isn't DataForge's; if something else owns the port, pick another with `DATAFORGE_UI_PORT`.

**The server never becomes ready.** Read the server console the launcher left open. The usual causes are unfinished setup, a missing build, or a port conflict. Fix it and run setup again. For problems once the app is up, see [configuration troubleshooting](configuration.md#troubleshooting).
