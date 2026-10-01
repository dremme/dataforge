# Development

[Documentation](README.md)

For running the app, see [Getting started](getting-started.md). Contributor and agent rules are in [AGENTS.md](../AGENTS.md).

## Stack

- **Backend:** Python 3.12+, FastAPI, SQLite, Pillow, ffmpeg, and the OpenAI client.
- **Frontend:** React 19, TypeScript, Vite, and SCSS.
- **Integrations:** OpenAI-compatible model servers, ComfyUI, and AI-Toolkit; see [Configuration](configuration.md).

## Run with hot reload

Complete [setup](getting-started.md#install-and-run), then run `dev.bat` (or `.\dev.ps1`) on Windows, or `./dev.sh` on Linux/macOS. The launcher regenerates API files, starts the API at `http://localhost:18080` and Vite at `http://localhost:18081`, waits for both, and opens the browser. Vite proxies `/api` to the backend.

| Windows                          | Linux and macOS                      | Effect                                                                                                        |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `-BackendOnly` / `-FrontendOnly` | `--backend-only` / `--frontend-only` | Start one server                                                                                              |
| `-NoBrowser`                     | `--no-browser`                       | Do not open the browser                                                                                       |
| `-NoReload`                      | `--no-reload`                        | Disable API reload; use during long jobs, because reload triggers job recovery and restarts resumable workers |
| `-Detach`                        | `--detach`                           | Exit once ready; stop later with `stop.bat` or `./stop.sh`                                                    |

Windows opens a console per server; Unix uses one terminal with `[api]` and `[ui]` prefixes. Windows also provides `start-backend.ps1` and `start-frontend.ps1` to run one server in the current terminal.

Stopping the launcher stops its servers. Use the stop script for detached/directly started servers or leftovers, after stopping any supervising launcher.

`scripts/dev-common.ps1` and `scripts/dev-common.sh` mirror port defaults, environment precedence, dependency/build stamps, and leftover-process cleanup. Keep both implementations aligned; never kill foreign processes to free a port.

### Development variables

| Variable                   | Default       | Effect                                                                                       |
| -------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `DATAFORGE_PYTHON`         | auto-detected | Interpreter override for Unix setup; set in the shell when running `./setup.sh`              |
| `DATAFORGE_RELOAD`         | on            | Development API reload; `0`, `false`, `no`, `off`, or blank disables it                      |
| `DATAFORGE_DISABLE_DOTENV` | off           | `1`, `true`, `yes`, or `on` skips `.env` loading in the Python backend; used by tests and CI |

These are startup settings. Command-line launcher options override reload preferences.

## Project layout

```text
backend/               API, media handling, captions, and persistence
  automation/          Job runners
  routes/              HTTP endpoints
  data/                SQLite and thumbnails (gitignored)
frontend/              React UI
  src/shared/          Shared modules and generated API files
  dist/                Production build (gitignored)
scripts/               Launchers, checks, generation, and Git hooks
docs/                  User and contributor documentation
comfy_workflows/       ComfyUI presets
ostris_templates/      AI-Toolkit training templates
llm_templates/         Local model chat templates
sample_images/         Example dataset
.github/workflows/     Checks and separate end-to-end CI
.env.example           Commented app environment settings
setup / start / dev / stop (.bat, .ps1, .sh)   Launchers
```

## Generated code

`backend/schemas.py` defines the wire format; `backend/constants.py` supplies shared values. [`scripts/generate_types.py`](../scripts/generate_types.py) generates:

| File                                    | Contents                                                     |
| --------------------------------------- | ------------------------------------------------------------ |
| `frontend/src/shared/types.ts`          | Request/response types from OpenAPI                          |
| `frontend/src/shared/constants.ts`      | `constants.SHARED_CONSTANTS`                                 |
| `frontend/src/shared/wireGuards.ts`     | Runtime guards for `schemas.GUARDED_WIRE_MODELS`             |
| `frontend/src/test/colorAdjustCases.ts` | Python Adjust outputs used to verify the TypeScript pipeline |

These files are gitignored and must never be edited by hand. A fresh clone needs generation before the frontend can build. Setup, launchers, and checks regenerate them, writing only changed content. If you change schemas, constants, or the Adjust pipeline during development, rerun generation yourself. Frontend-only types belong with the module using them.

## Commands

Run from the project root. `<python>` means `backend/.venv/Scripts/python` on Windows or `backend/.venv/bin/python` on Linux/macOS.

Before finishing a change, run:

```bash
<python> scripts/run_checks.py --fix
```

This generates API files and runs formatting, lint, type checks, comment/theme/transition checks, and backend/frontend tests. Backend tools include Ruff and ty; frontend tools include ESLint, Prettier, TypeScript, and Vitest. Tool configuration and pins live in the respective project manifests.

`--fix` applies formatting/lint fixes. If it changes files, the runner completes checks but returns a failure requiring review; rerun after reviewing the changes. Failed steps print their output and stop the run; successful steps show a compact result. `--lint-only` skips tests but still checks types. `--scope backend` or `--scope frontend` narrows checks; frontend checks still need the backend venv for generation. CI uses this runner for each side separately.

The tests run under coverage, and the run ends with one line per side (coverage.py and Vitest's v8 provider). `--no-coverage` skips that and makes the tests noticeably faster. While coverage is on, Vitest's per-test timeout is 20s instead of 5s, because instrumentation slows tests enough to time out the heaviest ones; plain `npm test` keeps the 5s budget.

| Task                         | Command                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API with reload              | `<python> scripts/dev_server.py` (`--reload`, `--no-reload`, `--port`, `--host`)                              |
| Production server            | `<python> scripts/prod_server.py` (`--port`, `--host`, `--access-log`); needs a UI build                      |
| UI build                     | `cd frontend && npm run build` (typecheck, then build)                                                        |
| Generate API files           | `<python> scripts/generate_types.py`                                                                          |
| Backend lint/typecheck/tests | `<python> scripts/run_lint.py` / `run_typecheck.py` / `run_tests.py`; lint accepts `--fix`, tests accept `-v` |
| Frontend lint/format         | `cd frontend && npm run lint` / `npm run format`                                                              |
| Frontend tests               | `cd frontend && npm test`                                                                                     |
| End-to-end tests             | `cd frontend && npm run test:e2e`; install Chromium once with `npx playwright install chromium`               |
| Install Git hooks            | `scripts/install-git-hooks.ps1` or `.sh`                                                                      |

### CI and end-to-end tests

Backend CI checks Python 3.12 and 3.13; frontend CI generates files with Python and runs its scoped checks. End-to-end CI runs separately from `run_checks.py` and the pre-commit hook.

The E2E suite drives Chromium against its own backend on 18090 and Vite on 18091, using temporary data and a stand-in vision model. It needs no existing servers or real model and covers image/video auto-captioning. Avoid using those ports for another service during the run.

## Versioning

Settings > About reads `version` from `backend/pyproject.toml`. The installed pre-commit hook runs checks and bumps the patch version. For a minor/major release, a contributor can edit and stage the version explicitly; the hook keeps a staged value different from the parent commit, preventing a second bump on amend. An unstaged manual version edit is not overwritten.

After a path-limited commit (`git commit <paths>`), the post-commit hook stages the bumped version to keep the index aligned. Commits using `--no-verify` bypass the bump. Agents must follow AGENTS.md's prohibition on staging changes themselves.

## Testing Unix launcher changes

PowerShell launchers can be tested on Windows. `bash -n` checks Unix syntax only; test behavior on Linux/macOS from a clean clone:

- Setup and production start succeed; stopping frees the port.
- Development hot reload works; Ctrl+C also stops uvicorn's reload child.
- Production start clears a leftover DataForge Vite listener.
- An unchanged build is reused; a frontend source change triggers a rebuild.
- A foreign process occupying the UI port is identified and left running.
