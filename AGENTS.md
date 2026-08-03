# Agent instructions

These are common instructions for agents across all scenarios.

## General Guidelines

- Never stage changes yourself to Git.
- Never use '…', even in user-facing code; always use '...'.
- Never use lewd, explicit, or NSFW terms in test fixtures, examples, placeholders, or production default values in the frontend or backend.
    Use neutral, professional sample content instead (e.g. landscapes, vehicles, everyday objects).
- Never add personal data to source files.
    This includes real usernames, home directories, machine-specific paths, secrets, API keys, tokens, passwords, private hostnames, real timestamps from local sessions, or identifiable project or dataset names.
    Use generic placeholders instead (e.g. `C:\Photos`, `C:\datasets\sample`, `sample_train_v1`, `2026-01-01T00:00:00.000Z`).
- Never manually modify CHANGELOG.md, TODO.md, or any files that are marked as auto-generated.
- When making technical decisions, do not give much weight to development cost.
    Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When doing bug fixes, always start with reproducing the bug using test driven design (TDD) principles.
    This makes sure you find the real problem.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
    If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
    If you see one, even if it is not caused by what you are working on right now, still get it fixed.
- When fixing a bug, rather write a test case instead of leaving a comment in the code. Never use unnecessary comments in the code and remove unnecessary comments if you come across them.
    The code should always be written in a way that is self-explanatory.
- Apply the 'good camper' principle of programming and improve code you come across, if it is a quick win with low effort.

## Engineering

These are more project specific engineering rules.

- Always format your code according to the linting rules.
- Verify your work with `backend/.venv/Scripts/python scripts/run_checks.py --fix`, run from the project root.
    This covers lint, formatting, and tests for both halves of the stack, and is what CI and the pre-commit hook run.
    Narrow it with `--lint-only` to skip tests, or `--scope backend` / `--scope frontend` when you touched only one side.
    Per-tool commands such as `npm test` or `ruff check` cover half the project at best, so never finish on those alone.
- `backend/schemas.py` and `frontend/src/shared/types.ts` mirror each other by hand; there is no codegen or generated client.
    Changing an API response shape means editing both, otherwise the frontend silently misdescribes the wire format.
- Never use barrel files (`index.ts`), import directly instead.
- Use `@/shared/lib/classNames` for toggling HTML classes, when it makes sense.
- Spell file formats by register. Wire values and type unions are bare lowercase (`"json"`, `"txt"`),
    filesystem constants are dotted lowercase (`".json"`, `".txt"`), user-facing text naming the
    format is uppercase (`Edit JSON`, `Invalid JSON`), and user-facing text naming a literal filename
    suffix stays dotted lowercase (`written as .txt sidecars`).
    List caption sidecars in precedence order via `CAPTION_SIDECAR_EXTENSION_LIST`, never as a literal.
