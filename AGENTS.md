# Agent instructions

These are common instructions for agents across all scenarios.

## General Guidelines

- **Never** stage changes yourself to Git.
- When fixing a bug, write a test case **instead** of leaving a comment or docstring/heredoc in the code. **Never** use unnecessary comments, docstrings, or heredocs in the code and **remove** unnecessary ones if you come across them.
    The code should **always** be written in a way that is self-explanatory.
    A comment states a constraint the code cannot show - a platform quirk, a protocol requirement, an ordering dependency.
    **Never** write one about the change: not the alternatives you considered, not what you rejected, not why your version is correct.
    That belongs in the commit message or a test name, and it is the failure mode this rule exists to stop.
    One line. If it needs a paragraph, it is a test.
    `scripts/check_comments.py` enforces width and a two-line cap, and runs as part of
    `run_checks.py`; it cannot judge the altitude, so that part is on you.
- **Never** use lewd, explicit, or NSFW terms in test fixtures, examples, placeholders, or production default values in the frontend or backend.
    Use neutral, professional sample content instead (e.g. landscapes, vehicles, everyday objects).
- **Never** add personal data to source files.
    This includes real usernames, home directories, machine-specific paths, secrets, API keys, tokens, passwords, private hostnames, real timestamps from local sessions, or identifiable project or dataset names.
    Use generic placeholders instead (e.g. `C:\Photos`, `C:\datasets\sample`, `sample_train_v1`, `2026-01-01T00:00:00.000Z`).
- **Never** manually modify CHANGELOG.md, TODO.md, or any files that are marked as auto-generated.
- When making technical decisions, do not give much weight to development cost.
    Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When doing bug fixes, always start with reproducing the bug using test driven design (TDD) principles.
    This makes sure you find the real problem.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
    If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
    If you see one, even if it is not caused by what you are working on right now, still get it fixed.
- Apply the 'good camper' principle of programming and improve code you come across, if it is a quick win with low effort.

## Engineering

These are more project specific engineering rules.

- **Always** format your code according to the linting rules.
- Verify your work with `scripts/run_checks.py --fix`, run from the project root using the venv Python -
  `backend/.venv/Scripts/python` on Windows, `backend/.venv/bin/python` on Linux and macOS.
    This covers lint, formatting, comments, typechecking, and tests for both halves of the stack, and is what CI and the pre-commit hook run.
    Narrow it with `--lint-only` to skip tests, or `--scope backend` / `--scope frontend` when you touched only one side.
    Per-tool commands such as `npm test` or `ruff check` cover half the project at best, so never finish on those alone.
- `backend/schemas.py` is the single source of truth for the wire format.
    `frontend/src/shared/types.ts` is generated from it by `scripts/generate_types.py` and must never be edited by hand; it falls under the auto-generated-files rule above.
    Change a request or response shape in `schemas.py` and re-run `scripts/run_checks.py --fix` to regenerate.
- **Never** use barrel files (`index.ts`), import directly instead.
- Use `@/shared/lib/classNames` for toggling HTML classes, when it makes sense.
- Spell file formats by register. Wire values and type unions are bare lowercase (`"yaml"`,
    `"markdown"`), filesystem constants are dotted lowercase (`".issue.json"`, `".txt"`),
    user-facing text naming the format is uppercase (`not valid YAML`), and user-facing text
    naming a literal filename suffix stays dotted lowercase (`written as .txt sidecars`).
    List caption sidecars via `CAPTION_SIDECAR_EXTENSION_LIST`, never as a literal.
- Spell an ellipsis by role. `...` is the default: UI labels (`"Starting..."`), job messages, logs, and CLI output.
    Use `…` **only** where it stands in for text that was cut, so a hand-rolled elision matches what
    `text-overflow: ellipsis` already paints - see `captionDiff.ts` and `verify_captions._response_preview`.
    Anything printed to a console stays `...`: stdout falls back to the OEM codepage, which cannot encode `…`.
    `...` is also syntax (`tuple[str, ...]`, `Query(...)`, JS spread), so never convert between the two mechanically.
