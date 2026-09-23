# Development

[Documentation](README.md)

How to work on DataForge itself. To just run it, see [Getting started](getting-started.md). Repository rules for contributors and agents are in [AGENTS.md](../AGENTS.md).

## Stack

- **Backend:** Python 3.12+, FastAPI, SQLite, Pillow, ffmpeg, and the OpenAI client
- **Frontend:** React 19, TypeScript, Vite, SCSS
- **AI:** any OpenAI-compatible vision endpoint

## Run with hot reload

Run `dev.bat` (or `.\dev.ps1`) on Windows, or `./dev.sh` on Linux and macOS. It:

1. Regenerates the [API types](#generated-code)
2. Starts the API with auto-reload on `http://localhost:18080`
3. Starts Vite on `http://localhost:18081`, which proxies `/api` to the API
4. Waits until both answer, opens the browser, and keeps them running until you stop it

| Windows                          | Linux and macOS                      | Effect                                                            |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `-BackendOnly` / `-FrontendOnly` | `--backend-only` / `--frontend-only` | Start one server only                                             |
| `-NoBrowser`                     | `--no-browser`                       | Do not open a browser                                             |
| `-NoReload`                      | `--no-reload`                        | Turn off API reload. Use it during long jobs: a reload re-runs job recovery and restarts their workers |
| `-Detach`                        | `--detach`                           | Exit once ready; stop later with `stop.bat` / `./stop.sh`         |

On Windows, each server gets its own console. On Unix, both share one terminal, with output prefixed `[api]` and `[ui]`. On Windows, `start-backend.ps1` and `start-frontend.ps1` also run one dev server in the current terminal.

Stopping the launcher stops its servers. `stop.bat` / `./stop.sh` frees both ports when nothing is supervising them: after `--detach`, after a console was closed by hand, or for servers you started directly.

The launchers share `scripts/dev-common.ps1` and `scripts/dev-common.sh`. **Those two files mirror each other**: port defaults, `.env` precedence, stamp file names, and the rule that only leftover `python`/`node` processes are ever killed. When you change one, change the other.

### Development variables

| Variable                   | Effect                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATAFORGE_RELOAD`         | Set to `0` to run `scripts/dev_server.py`, and so the dev launcher, without auto-reload by default |
| `DATAFORGE_DISABLE_DOTENV` | Set to `1` to ignore every `.env` file. Tests and CI set it so a local `.env` can't leak in       |
| `DATAFORGE_PYTHON`         | Python interpreter for `./setup.sh`                                                              |

The app's own settings are in [Configuration](configuration.md).

## Project layout

```text
backend/               FastAPI app, jobs, captions, media handling
  automation/          Job runners
  routes/              HTTP API
  data/                SQLite and thumbnails (gitignored)
frontend/              React UI
  src/shared/          Includes the generated files below (gitignored)
  dist/                Production build (gitignored)
scripts/               Servers, launcher helpers, checks, type generation, git hooks
docs/                  These guides
comfy_workflows/       ComfyUI presets
ostris_templates/      AI-Toolkit training templates
llm_templates/         Chat templates for local model servers
sample_images/         Small example dataset
.github/workflows/     CI, which runs run_checks.py and the end-to-end suite
setup / start / dev / stop (.bat, .ps1, .sh)   Launchers
.env.example           Every setting, commented out; copy to .env
```

## Generated code

`backend/schemas.py` and `backend/constants.py` define the API contract. [`scripts/generate_types.py`](../scripts/generate_types.py) turns them into three frontend files, so nothing is mirrored by hand:

| File                                | Contains                                                  |
| ----------------------------------- | --------------------------------------------------------- |
| `frontend/src/shared/types.ts`      | Every request and response type, from the OpenAPI schema  |
| `frontend/src/shared/constants.ts`  | The values in `constants.SHARED_CONSTANTS`                |
| `frontend/src/shared/wireGuards.ts` | Runtime checks for `schemas.GUARDED_WIRE_MODELS`          |

They are gitignored and **must never be edited by hand**; the next run overwrites them. A fresh clone doesn't have them, and the frontend won't build until they exist. Setup, every launcher, and `run_checks.py` regenerate them, so a branch switch can't leave a stale contract behind. A file is rewritten only if its content changed, so regenerating doesn't trigger a UI rebuild by itself.

If you change `schemas.py` or `constants.py` while the dev servers are running, run the generator yourself. Types used only by the frontend belong in the module that uses them, not in `schemas.py`.

## Commands

Run from the project root. `<python>` is `backend/.venv/Scripts/python` on Windows and `backend/.venv/bin/python` on Linux and macOS.

**Before you finish any change, run the full suite.** CI runs the same thing:

```bash
<python> scripts/run_checks.py --fix
```

It runs lint, formatting, comment checks, type checks, and tests for both halves: Ruff and ty for the backend, and ESLint, Prettier, TypeScript, and Vitest for the frontend. `--fix` applies lint and formatting fixes; type errors have to be fixed by hand. Add `--lint-only` to skip tests, or `--scope backend` / `--scope frontend` to check one side. Ruff and ty are pinned in `backend/requirements-dev.txt` and configured in `backend/pyproject.toml`.

| Task                    | Command                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| API only, with reload   | `<python> scripts/dev_server.py` (`--no-reload`, `--port`, `--host`)         |
| Production server       | `<python> scripts/prod_server.py` (`--port`, `--host`, `--access-log`); needs a UI build |
| Build the UI            | `cd frontend && npm run build`: typechecks, then writes `frontend/dist`      |
| Regenerate API types    | `<python> scripts/generate_types.py`                                         |
| Backend lint            | `<python> scripts/run_lint.py`, with `--fix` to apply fixes                  |
| Backend typecheck       | `<python> scripts/run_typecheck.py`                                          |
| Backend tests           | `<python> scripts/run_tests.py`                                              |
| Frontend lint / format  | `cd frontend && npm run lint` / `npm run format`                             |
| Frontend tests          | `cd frontend && npm test`                                                    |
| End-to-end tests        | `cd frontend && npm run test:e2e`, after `npx playwright install chromium` once |
| Install git hooks       | `scripts/install-git-hooks.ps1` or `.sh`; the pre-commit hook fixes lint and formatting |

The end-to-end suite drives Chromium against its own backend on port 18090 and Vite on 18091, with a temporary workspace and a stand-in vision model. It needs no running servers or real model, and currently covers auto-captioning an image and a video. CI runs it separately from `run_checks.py`.

## Testing Unix launcher changes

PowerShell launchers can be tested on Windows. For the shell launchers, `bash -n` only catches syntax errors, so check these on a real Linux or macOS machine from a clean clone:

- `./setup.sh`, then `./start.sh`. The app loads, and after `Ctrl+C` both ports are free (`./stop.sh` confirms).
- `./dev.sh`. Hot reload works, and `Ctrl+C` also stops uvicorn's reload child, the most likely orphan. Check that the port is actually free.
- `./start.sh` right after `./dev.sh`. The leftover Vite listener on the UI port is cleared, not fatal.
- `./start.sh` twice. The second run prints "Frontend build is up to date". After `touch frontend/src/main.tsx`, the next run rebuilds.
- `nc -l 18081`, then `./start.sh`. The launcher names the foreign process and refuses to kill it.
