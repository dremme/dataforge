# Security Policy

## Reporting a Vulnerability

If you find a security issue in DataForge, please report it privately rather than opening a public issue.

Prefer contacting the repository maintainers through GitHub Security Advisories (if enabled) or a private channel listed on the project page.

Please include:

- A clear description of the issue
- Steps to reproduce
- Affected versions or commits if known
- Impact assessment if possible

## Local Data

DataForge is local-first. Caption sidecars live next to your media. App state (preferences, job history, thumbnail cache) is stored under `backend/data/` on the machine that runs the app.

Do not commit:

- `backend/data/`
- `.env` files or real API keys
- Personal dataset folders
- Local session logs (`agent-tools/`, `terminals/`, IDE caches)

The LLM client sends a non-credential placeholder (`EMPTY`) when `OPENAI_API_KEY` is unset; local servers ignore it. Set a real key only if your server was started with one — and only in `.env`, never in source.
