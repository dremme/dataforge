# Getting started

[Documentation](README.md)

## Install and run

Get the project from the [repository](https://github.com/dremme/dataforge): choose **Code > Download ZIP** and extract it to a writable folder, or clone it with Git. Open the extracted/cloned project folder before running the commands below.

### Windows

1. Run `setup.bat` once. It downloads portable Python 3.13.12 and Node 20 into `.python/` and `.node/`, creates `backend/.venv`, installs dependencies including bundled FFmpeg 7.1, and generates frontend API files.
2. Run `start.bat`. It builds the UI when needed, starts the server, and opens `http://localhost:18081`.

No global Python or Node is needed. Keep the launcher window open while using the app.

### Linux and macOS

Install Python 3.13.x, FFmpeg 7.1.x, and Node 20.19.x or later in the 20 series, 22.13.x or later in the 22 series, or 24+, with npm. Put the FFmpeg binary on PATH. From the project folder:

```bash
./setup.sh
./start.sh
```

Any final Python 3.13.x release is supported locally. `.python-version` records 3.13.12 as the default for CI and Windows setup. To use that default with pyenv, run `pyenv install 3.13.12` and `pyenv local 3.13.12`. To select another installed 3.13.x interpreter, use `DATAFORGE_PYTHON=/path/to/python3.13 ./setup.sh`. Setup rebuilds an existing virtual environment if it uses another Python release series or a prerelease. The first start builds the UI; later starts reuse it unless sources or dependencies have changed.

## Open your first dataset

Use **Open folder** (`Ctrl+O`) to choose a dataset, or try [`sample_images/`](../sample_images/). It includes captioned and uncaptioned media, flagged captions, folder instructions, caption rules, and a ComfyUI result ready for review.

1. Browse the gallery. Filters and statistics show missing captions and review work.
2. Open a file and write a caption; it autosaves as `.txt` beside the media.
3. For local quality checks, edit **Caption rules** through **Create instructions** or **Edit instructions**, then run **Lint captions**.
4. For AI jobs, [connect a model in Settings](configuration.md#connect-a-vision-model). Auto-caption also needs a **System prompt** in the folder or a parent.
5. Select files before starting a job to limit its scope. With no selection, most jobs use the whole open folder; filters alone do not limit them. Training always uses the whole folder.
6. Review flagged captions, duplicate groups, or staged ComfyUI results.

The [user guide](user-guide.md) explains these workflows. On macOS, use `⌘` instead of `Ctrl` for shortcuts.

## Stop, restart, and update

Stop by pressing a key in the launcher, closing it, or pressing `Ctrl+C`. Use `stop.bat` or `./stop.sh` for a detached server or one left behind after its console closed; stop the supervising launcher first if it is still running.

To update a Git clone, stop the app, pull changes, then start it again. For a ZIP installation, extract a new copy and transfer your local `.env`, custom presets, and `backend/data/` if you want to keep settings/history/cache; keep datasets in their existing folders. Run setup in the new copy.

The launcher detects dependency changes and rebuilds the UI when needed. Re-run setup after a runtime upgrade or when asked.

### Launcher options

The production launcher serves the built UI and API together, without hot reload. `start.bat` forwards flags to `start.ps1`.

| Windows      | Linux and macOS | Effect                                                     |
| ------------ | --------------- | ---------------------------------------------------------- |
| `-Rebuild`   | `--rebuild`     | Force a UI rebuild                                         |
| `-NoBuild`   | `--no-build`    | Use the existing build; fails if none exists               |
| `-NoBrowser` | `--no-browser`  | Do not open a browser                                      |
| `-Detach`    | `--detach`      | Exit once ready; stop later with `stop.bat` or `./stop.sh` |

Do not combine rebuild and no-build. To change the browser port, set `DATAFORGE_UI_PORT` in `.env` and restart; see [server settings](configuration.md#server-storage-and-logging). For hot reload, see [Development](development.md).

## Requirements

- **Platform:** Windows 10/11, Linux, or macOS; 64-bit CPU, dual-core or better.
- **Memory/storage:** allow about 8 GB RAM and 2 GB disk for the app, plus dataset/cache space. A quad-core CPU, 16 GB RAM, and an SSD are practical starting points.
- **Runtimes:** Python 3.13.x; Node `^20.19.0 || ^22.13.0 || >=24` with npm. Windows setup supplies Python 3.13.12 and Node 20.19.0.
- **Media:** Pillow handles images. Video work requires FFmpeg 7.1.x: DataForge uses a matching binary on PATH or its bundled copy, and rejects other release series. Windows dependencies include FFmpeg 7.1; Linux/macOS may need a separate installation. CI uses exactly 7.1.5. Browser playback depends on codec support.

DataForge needs no GPU. Model servers, ComfyUI, and AI-Toolkit set their own hardware requirements. Check the chosen model's memory needs, including context and media input; audio captioning also requires an audio-capable model/server.

## Troubleshooting

**Setup cannot find Python or Node.** Windows setup downloads both; check its reported download error. On Linux/macOS, install supported versions and rerun setup, using `DATAFORGE_PYTHON` if needed.

**Python is outside the supported 3.13.x series.** Run `setup.bat` on Windows. On Linux/macOS, install any final Python 3.13.x release and rerun `./setup.sh`. Other release series and prereleases are rejected; setup recreates an incompatible backend virtual environment.

**Setup cannot find FFmpeg 7.1.x.** Install a 7.1.x build and put its binary folder on PATH, then run setup again. A global 8.x, 9.x, or unversioned development build does not satisfy the pin. Windows setup normally supplies the matching bundled copy. The build must include the `drawtext` filter (libfreetype and libharfbuzz), which watermarking uses. Verify the application's selection with `backend/.venv/Scripts/python scripts/check_ffmpeg.py` on Windows or `backend/.venv/bin/python scripts/check_ffmpeg.py` on Linux/macOS.

**Shell scripts will not execute.** From an extracted ZIP, try `bash setup.sh` and `bash start.sh` if executable permissions were not retained.

**No build with `--no-build`.** Start once without that option, or build with `cd frontend && npm run build` after setup.

**A port is in use.** Close an earlier launcher or stop an unsupervised DataForge server. The launcher refuses to kill a foreign process; choose another `DATAFORGE_UI_PORT` if necessary.

**The server never becomes ready.** Read the server output for incomplete setup, a missing build, or a port conflict. Correct the reported problem before restarting. For problems after startup, see [configuration troubleshooting](configuration.md#troubleshooting).

## Run without the launchers

Install supported Python and Node versions yourself. From the project root, on Linux/macOS:

```bash
python3.13 -m venv backend/.venv
backend/.venv/bin/python scripts/py_version.py
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
backend/.venv/bin/python scripts/check_ffmpeg.py
cd frontend && npm ci && cd ..
backend/.venv/bin/python scripts/generate_types.py
cd frontend && npm run build && cd ..
backend/.venv/bin/python scripts/prod_server.py
```

On Windows, with Python 3.13.x on PATH:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python scripts/py_version.py
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
backend/.venv/Scripts/python scripts/check_ffmpeg.py
cd frontend; npm ci; cd ..
backend/.venv/Scripts/python scripts/generate_types.py
cd frontend; npm run build; cd ..
backend/.venv/Scripts/python scripts/prod_server.py
```

Open `http://localhost:18081`. Rebuild after frontend changes. Ctrl+C stops this directly started server.
