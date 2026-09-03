[DataForge documentation](README.md)

# Development

Working on DataForge itself. To install, run, or update the app, use the
[getting-started guide](getting-started.md).

## Contents

- **Run:** [Running with hot reload](#running-with-hot-reload)
- **Understand:** [Tech stack](#tech-stack) and [Project layout](#project-layout)
- **Generate:** [Generated frontend code](#generated-frontend-code)
- **Verify:** [Commands](#commands) and [Validate launcher changes](#validate-launcher-changes)

## Running with hot reload

`dev.bat` (or `.\dev.ps1`) on Windows, `./dev.sh` on Linux and macOS. Either one:

- Regenerates the API types first; see [Generated frontend code](#generated-frontend-code)
- Starts the API with the uvicorn reloader on **http://localhost:18080**
- Starts the Vite dev server on **http://localhost:18081**, proxying `/api` to the API
- Waits until both are serving, then opens the browser and supervises them

| Windows                          | Unix                                 | Effect                                                                                                                                                |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-BackendOnly` / `-FrontendOnly` | `--backend-only` / `--frontend-only` | Start just one server                                                                                                                                 |
| `-NoBrowser`                     | `--no-browser`                       | Do not open the browser                                                                                                                               |
| `-NoReload`                      | `--no-reload`                        | Run the API without the uvicorn reloader. Use this while a long job is running: a reload re-runs job recovery and re-spawns worker threads mid-flight |
| `-Detach`                        | `--detach`                           | Exit once both are ready instead of supervising; stop them later with `stop.bat` / `./stop.sh`                                                        |

Windows opens **two consoles** so uvicorn and Vite do not interleave. Unix runs both as background
children in one terminal and tags their output `[api]` and `[ui]`.

`start-backend.ps1` and `start-frontend.ps1` run a single dev server in the current terminal and
prefer `.python` / `.node` when present. On Unix, `./dev.sh --backend-only` and `--frontend-only`
cover the same ground.

Each platform's launchers share one helper — `scripts/dev-common.ps1` and `scripts/dev-common.sh` —
so type regeneration, port cleanup, and the dependency-drift warning behave identically. The two
helpers are deliberate mirrors: port defaults, `.env` precedence, stamp filenames, and the rule that
only leftover `python`/`node` processes are ever killed all match. Change one and change the other.

Use the direct server commands in [Commands](#commands) when you do not want launcher supervision.
`stop.bat` / `./stop.sh` frees both ports. You should rarely need it: stopping a launcher stops the
servers it started. It is for `-Detach` / `--detach`, for a server console closed by hand, and for
manually started servers where nothing is supervising.

## Tech stack

- **Backend** — Python 3.12+, FastAPI, SQLite, Pillow, with an optional OpenAI client
- **Frontend** — React 19, TypeScript, Vite, SCSS
- **Local AI** — any OpenAI-compatible vision endpoint

## Project layout

```text
DataForge/
├── backend/           # FastAPI, jobs, captions, media I/O, automation
│   ├── automation/    # Job runners
│   ├── data/          # Local SQLite + thumbnails (gitignored)
│   └── routes/        # HTTP API
├── frontend/          # React + TypeScript + Vite UI
│   ├── dist/          # Production build output (gitignored)
│   └── src/shared/    # types.ts, constants.ts, wireGuards.ts are generated (gitignored)
├── scripts/           # Dev + prod servers, launcher helpers, lint, tests, git hooks
├── docs/              # Configuration, development, and integration guides
├── comfy-workflows/   # ComfyUI API-format presets for Process with ComfyUI
├── ostris-templates/  # Quick LoRA YAML templates
├── llm-templates/     # Chat templates for local vision servers
├── .github/workflows/ # CI (run_checks.py)
├── sample-images/     # Tiny example dataset
├── .env.example       # Sample env vars: ports, AI config (copy to .env)
├── .env               # Local secrets/config (gitignored; optional)
├── setup.bat/.ps1/.sh # One-time install: venv, dependencies, generated types
├── start.bat/.ps1/.sh # Production launcher - builds the UI, serves both halves
├── dev.bat/.ps1/.sh   # Dev launcher - two servers with hot reload
├── stop.bat/.ps1/.sh  # Frees the ports
├── SECURITY.md
└── LICENSE            # Apache-2.0
```

## Generated frontend code

`backend/schemas.py` and `backend/constants.py` are the single source of truth for the API contract.
[`scripts/generate_types.py`](../scripts/generate_types.py) writes three files from them, so nothing
is mirrored by hand:

| File                                | Contents                                            |
| ----------------------------------- | --------------------------------------------------- |
| `frontend/src/shared/types.ts`      | Every wire shape, from the published OpenAPI schema |
| `frontend/src/shared/constants.ts`  | `constants.SHARED_CONSTANTS`                        |
| `frontend/src/shared/wireGuards.ts` | Runtime guards for `schemas.GUARDED_WIRE_MODELS`    |

All three are **gitignored**. A fresh clone does not have them, and two of them carry real values
rather than types alone — the frontend will not build or start until they exist.

They are generated by the setup scripts, by `scripts/run_checks.py` before anything compiles, and by
every launcher on every run. The launchers do it so a branch switch cannot leave the other branch's
contract sitting in a gitignored file. Regenerating only rewrites a file whose content actually
changed, so an unchanged shape still leaves the launchers' build-freshness check alone.

Generate them by hand after editing `schemas.py` or `constants.py` during a running dev session —
nothing regenerates until the next launch or the next `run_checks.py`.

**Never edit these files.** They carry a `Do not edit` header and the next generator run overwrites
them. Frontend-only shapes belong in the module that uses them.

## Commands

Run commands from the **project root**. The canonical full quality gate uses the backend venv Python
and enables automatic lint and formatting fixes:

**Windows**

```powershell
backend/.venv/Scripts/python scripts/run_checks.py --fix
```

**Linux and macOS**

```bash
backend/.venv/bin/python scripts/run_checks.py --fix
```

In the remaining commands, `<venv-python>` means the corresponding interpreter shown above.

| Task                   | Command                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| API with hot reload    | `<venv-python> scripts/dev_server.py` — accepts `--no-reload`, `--port`, `--host`                   |
| Production server      | `<venv-python> scripts/prod_server.py` — accepts `--port`, `--host`, `--access-log`; needs a build  |
| Build the UI           | `cd frontend && npm run build` — typechecks, then writes `frontend/dist`                            |
| Full checks            | `<venv-python> scripts/run_checks.py --fix` — the same suite CI runs                                |
| Regenerate API types   | `<venv-python> scripts/generate_types.py` — see [Generated frontend code](#generated-frontend-code) |
| Backend lint           | `<venv-python> scripts/run_lint.py` — add `--fix` to auto-fix                                       |
| Backend tests          | `<venv-python> scripts/run_tests.py`                                                                |
| Frontend tests         | `cd frontend && npm test`                                                                           |
| Frontend lint / format | `cd frontend && npm run lint` / `npm run format`                                                    |
| Install git hooks      | `scripts/install-git-hooks.ps1` or `.sh`                                                            |

## Validate launcher changes

PowerShell launcher changes can be exercised on Windows. Unix launchers cannot: `bash -n` catches
syntax errors from anywhere, but nothing past that. On a real Unix host, from a clean clone:

- `./setup.sh` → `./start.sh` → the app answers on http://localhost:18081 → Ctrl+C leaves both ports
  free (`./stop.sh` confirms).
- `./dev.sh` → both servers come up, HMR works, Ctrl+C reaps the **uvicorn reload child**. This is
  the case most likely to leave an orphan, so check the port is actually free afterwards.
- `./start.sh` immediately after `./dev.sh` — the leftover Vite listener on the UI port must be
  cleared, not fatal.
- `./start.sh` twice — the second run should print "Frontend build is up to date" and skip the
  build. Then `touch frontend/src/main.tsx` and confirm the next run rebuilds.
- `nc -l 18081`, then `./start.sh` — `clear_port` must name the process and refuse, rather than
  killing something that is not ours.

## Related guides

- [DataForge documentation](README.md)
- [Configuration](configuration.md)
