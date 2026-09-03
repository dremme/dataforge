# Getting started

[DataForge documentation](README.md)

DataForge runs locally and works directly with the folders that hold your images, videos, and caption sidecars. Start with the production launcher unless you are changing DataForge itself.

## Choose your setup

### Windows

1. Double-click `setup.bat` in the project root once. It downloads Python 3.12.6 into `.python/` and Node 20.19.0 into `.node/`, creates `backend/.venv`, installs dependencies, and generates frontend API files.
2. Double-click `start.bat`. It builds the UI when needed, starts one production server, and opens `http://localhost:18081`.

You do not need a global Python or Node installation on Windows. Run `start.bat` again after pulling dependency changes; it checks for dependency drift and refreshes frontend dependencies when needed.

### Linux and macOS

Install Python 3.12 or newer and a supported Node version with npm first. Supported Node ranges are 20.19+, 22.13+, or 24+.

```bash
./setup.sh
./start.sh
```

`./setup.sh` checks the runtime versions, creates `backend/.venv`, installs backend and frontend dependencies, and generates frontend API files. It accepts `DATAFORGE_PYTHON=/path/to/python3.12 ./setup.sh` when the right Python is installed outside `PATH`.

The first production start can take a minute or two while Vite builds the frontend. Later starts normally reuse `frontend/dist` and start in seconds.

## Open your first dataset

Open a folder from the app, or point it at [`sample-images/`](../sample-images/). The sample folder has captioned and uncaptioned files, a caption issue, and a staged ComfyUI candidate under `staging/`.

A typical first pass is:

1. Open the dataset folder and inspect captions, filters, and statistics.
2. Write captions in the detail view, or create/edit the folder's `.sysprompt` if you will use AI.
3. Configure a vision endpoint only when you want **Auto-caption**, **Verify captions**, or **Edit captions**. Manual work and non-AI jobs do not need it.
4. Select files to narrow a job, or leave the selection empty to use the whole folder. **Quick LoRA training** always uses the whole folder.
5. Review captions and resolve issues, duplicate groups, or ComfyUI candidates.

See the [user guide](user-guide.md) for the full workflow and the [configuration guide](configuration.md) for model setup.

## Daily use

### Start and stop

Run `start.bat` on Windows or `./start.sh` on Linux and macOS. The launcher supervises the server: press a key in the launcher window, close it, or press `Ctrl+C` to stop cleanly.

Use `stop.bat` or `./stop.sh` only when nothing is supervising the server, such as after `-Detach` or `--detach`, or after closing the server console directly and leaving the port held.

The default browser URL is `http://localhost:18081`. Change it with `DATAFORGE_UI_PORT`; see [server and app settings](configuration.md#server-and-app-settings).

### Refresh dependencies

Re-run `setup.bat` or `./setup.sh` after changing branches with dependency updates, after a runtime upgrade, or when the launcher reports dependency drift. The scripts preserve an existing suitable environment when possible.

## Launcher options

### Production launcher

`start.bat` passes its flags to `start.ps1`. Unix uses the corresponding long flag with `./start.sh`.

| Windows      | Linux and macOS | Effect                                                                                     |
| ------------ | --------------- | ------------------------------------------------------------------------------------------ |
| `-Rebuild`   | `--rebuild`     | Build the frontend even when `frontend/dist` appears current                               |
| `-NoBuild`   | `--no-build`    | Serve the existing `frontend/dist` without building; fails if it does not exist            |
| `-NoBrowser` | `--no-browser`  | Do not open the browser after the health check succeeds                                    |
| `-Detach`    | `--detach`      | Let the launcher exit after the server is ready; stop later with `stop.bat` or `./stop.sh` |

Do not combine rebuild and no-build. Production serves the built UI and API from one process, with no hot reload.

### Development launcher

Use `dev.bat` or `./dev.sh` when changing DataForge. It starts the API at `http://localhost:18080` and Vite at `http://localhost:18081`; Vite proxies `/api` to the API.

| Windows         | Linux and macOS   | Effect                                                         |
| --------------- | ----------------- | -------------------------------------------------------------- |
| `-BackendOnly`  | `--backend-only`  | Start only the API                                             |
| `-FrontendOnly` | `--frontend-only` | Start only Vite                                                |
| `-NoBrowser`    | `--no-browser`    | Do not open a browser                                          |
| `-NoReload`     | `--no-reload`     | Run the API without uvicorn reload; use this during a long job |
| `-Detach`       | `--detach`        | Exit after the requested server or servers are ready           |

The development guide explains hot reload, generated types, and launcher maintenance.

## System requirements

### Core app

The gallery, caption editing, image/video editing, watermarking, metadata stripping, set captions, and rename tools do not require a GPU. Video work uses the ffmpeg bundled through Python dependencies; image work uses Pillow.

|           | Minimum                                                 | Recommended                                       |
| --------- | ------------------------------------------------------- | ------------------------------------------------- |
| OS        | Windows 10/11, Linux, or macOS                          | Windows 11 or a recent Linux release              |
| CPU       | 64-bit dual core                                        | Quad core or better                               |
| Memory    | 8 GB                                                    | 16 GB                                             |
| Free disk | About 2 GB for the app and dependencies                 | SSD storage plus room for datasets and thumbnails |
| Software  | Windows setup script, or Python/Node as described above | Same                                              |

### Vision LLM jobs

DataForge sends requests to a model server; the model and server determine the hardware requirement.

|               | Lighter models                               | Larger recommended models                                         |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| GPU           | NVIDIA GPU with 8–12 GB VRAM                 | NVIDIA GPU with 24 GB VRAM, such as an RTX 3090 or 4090           |
| System memory | 16 GB                                        | 32 GB or more                                                     |
| Storage       | SSD with room for model weights              | NVMe SSD                                                          |
| Software      | OpenAI-compatible server with a vision model | Same, with capacity for longer contexts and higher-quality quants |

Audio captioning also needs an omni model and server that accept audio input. These are practical model-server guidelines, not DataForge requirements for normal dataset work.

## Run without launchers

The launchers are convenience scripts. These commands perform the same setup and production launch from the project root.

### Windows

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend
npm ci
cd ..
backend/.venv/Scripts/python scripts/generate_types.py
cd frontend
npm run build
cd ..
backend/.venv/Scripts/python scripts/prod_server.py
```

### Linux and macOS

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd frontend && npm ci && cd ..
backend/.venv/bin/python scripts/generate_types.py
cd frontend && npm run build && cd ..
backend/.venv/bin/python scripts/prod_server.py
```

Open `http://localhost:18081` after the server starts. Rebuild `frontend/dist` after changing frontend sources.

## Troubleshooting startup

### Setup cannot find a supported runtime

Windows setup downloads the required runtimes itself. On Linux and macOS, install Python 3.12+ and a supported Node release, then run `./setup.sh` again. If the correct Python is installed under another name or path, set `DATAFORGE_PYTHON` for that setup command.

### `--no-build` or `-NoBuild` reports no frontend build

The flag only serves an existing `frontend/dist`. Start without the flag once, or build manually with `cd frontend && npm run build`.

### The launcher says a port is in use

Stop the earlier DataForge launcher if it is still open. If a detached or orphaned DataForge process owns the port, run `stop.bat` or `./stop.sh`. The launcher refuses to kill an unrelated process; choose another port with `DATAFORGE_UI_PORT` if the listener is intentional.

### The server never becomes ready

Read the server console left open by the launcher. Common causes are incomplete setup, a missing frontend build, a port conflict, or an invalid dependency environment. Re-run setup after fixing the reported problem. If the API starts but configuration is involved, see [configuration troubleshooting](configuration.md#troubleshooting).

## Next steps

- [Use DataForge day to day](user-guide.md)
- [Configure models, ports, and integrations](configuration.md)
- [Develop DataForge with hot reload](development.md)
