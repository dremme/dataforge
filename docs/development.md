# Development

Working on DataForge itself. For running the app, see the [README](../README.md#quick-start).

## Running with hot reload

`dev.bat` (or `.\dev.ps1`) is the development launcher. It opens **two** consoles — the API with the uvicorn
reloader on **http://localhost:8080** and the Vite dev server on **http://localhost:8081**, with Vite proxying
`/api` to the API — waits until both are serving, then opens the browser and supervises them. Separate windows
keep uvicorn's reload output from stepping on Vite's.

| Flag | Effect |
| --- | --- |
| `-BackendOnly` / `-FrontendOnly` | Start just one server |
| `-NoBrowser` | Do not open the browser |
| `-NoReload` | Run the API without the uvicorn reloader — use this while a long job is running, since a reload re-runs job recovery and re-spawns worker threads mid-flight |
| `-Detach` | Exit once both are ready instead of supervising; stop them later with `stop.bat` |

`start-backend.ps1` and `start-frontend.ps1` run a single dev server in the current terminal and prefer
`.python` / `.node` when present. All of them share `scripts/dev-common.ps1` with `dev.ps1`, `start.ps1`, and
`stop.ps1`, so port cleanup and the dependency-drift warning behave identically everywhere.

On Linux or macOS, run the two halves yourself from the project root:

```bash
# Terminal 1 — API
backend/.venv/bin/python scripts/dev_server.py

# Terminal 2 — UI
cd frontend && npm run dev
```

`stop.bat` frees both ports and covers either launcher. You should rarely need it: closing a launcher window
stops the servers it started. It is for `-Detach`, for a server console closed by hand, and for the Linux/macOS
shape above where nothing is supervising.

## Tech stack

- **Backend** — Python 3.11+, FastAPI, SQLite, Pillow, with an optional OpenAI client and Ultralytics
- **Frontend** — React 19, TypeScript, Vite, SCSS
- **Local AI** — any OpenAI-compatible vision endpoint

## Project layout

```text
DataForge/
├── backend/           # FastAPI, jobs, captions, media I/O, automation
│   ├── automation/    # Job runners + YOLO/SAM weights (downloaded locally)
│   ├── data/          # Local SQLite + thumbnails (gitignored)
│   └── routes/        # HTTP API
├── frontend/          # React + TypeScript + Vite UI
│   ├── dist/          # Production build output (gitignored)
│   └── src/shared/    # types.ts, constants.ts, wireGuards.ts are generated (gitignored)
├── scripts/           # Dev + prod servers, launcher helpers, lint, tests, git hooks
├── docs/              # Configuration and development guides
├── .github/workflows/ # CI (run_checks.py)
├── sample-images/     # Tiny example dataset
├── .env.example       # Sample env vars: ports, AI config (copy to .env)
├── .env               # Local secrets/config (gitignored; optional)
├── setup.bat          # Windows self-contained install
├── start.bat / .ps1   # Production launcher - builds the UI, serves both halves
├── dev.bat / .ps1     # Dev launcher - two servers with hot reload
├── stop.bat / .ps1    # Frees the ports
├── SECURITY.md
└── LICENSE            # Apache-2.0
```

## Generated frontend code

`backend/schemas.py` and `backend/constants.py` are the single source of truth for the API contract.
[`scripts/generate_types.py`](../scripts/generate_types.py) writes three files from them, so nothing is mirrored by hand:

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

## Commands

Run these from the **project root** using the backend venv Python — `backend\.venv\Scripts\python.exe` on
Windows, `backend/.venv/bin/python` on Unix:

| Task | Command |
| --- | --- |
| API with hot reload | `python scripts/dev_server.py` — accepts `--no-reload`, `--port`, `--host` |
| Production server | `python scripts/prod_server.py` — accepts `--port`, `--host`, `--access-log`; needs a build |
| Build the UI | `cd frontend && npm run build` — typechecks, then writes `frontend/dist` |
| Full checks | `python scripts/run_checks.py` — the same suite CI runs |
| Regenerate API types | `python scripts/generate_types.py` — see [Generated frontend code](#generated-frontend-code) |
| Backend lint | `python scripts/run_lint.py` — add `--fix` to auto-fix |
| Backend tests | `python scripts/run_tests.py` |
| Frontend tests | `cd frontend && npm test` |
| Frontend lint / format | `cd frontend && npm run lint` / `npm run format` |
| Install git hooks | `scripts/install-git-hooks.ps1` or `.sh` |
