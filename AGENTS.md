# Agent instructions

## Scope and efficiency

- Complete the requested outcome and necessary verification. Keep edits focused; nearby cleanup is allowed **only** when small and directly related. Report unrelated defects instead of fixing them.
- Inspect the existing diff and preserve user changes. **Never** stage changes yourself to Git.
- Use targeted file and text searches, then read relevant sections. Expand **only** when evidence requires it; avoid full-repository surveys, speculative refactors, and repeated reads.
- Reuse findings and passing checks. Repeat verification **only** after relevant changes, failures, or new evidence. Keep updates and the final response concise: outcome, verification, and unresolved issues.

## Engineering

- Prefer the simplest robust solution that meets the requirements. Consider maintenance, runtime, dependencies, and review burden.
- Reproduce bugs before fixing them, preferably with a failing regression test. If automation is impractical, record the reproduction and verification limits. Test behavior rather than implementation details.
- Write clear code. Use concise comments or docstrings for non-obvious constraints, contracts, or rationale; avoid narration and change history. Remove obsolete explanations in touched code. Comment lines are limited to 100 characters by `scripts/check_comments.py`.
- Use neutral, professional fixtures and examples. **Never** add personal data, machine-specific paths, private project/dataset names, or secrets to source; use generic placeholders.
- **Never** manually modify CHANGELOG.md, TODO.md, or generated files.
- `backend/schemas.py` owns the wire format, including generated `frontend/src/shared/types.ts`; `backend/constants.py` owns shared values. Regenerate frontend API files with `scripts/generate_types.py` or the checks runner.
- Follow existing lint and formatting rules. **Do not** introduce barrel modules that re-export other modules; import directly. Use `@/shared/lib/classNames` for conditional classes.
- Format names: lowercase wire values (`"yaml"`), dotted lowercase suffixes (`".txt"`), uppercase user-facing formats (`YAML`). Keep displayed filename suffixes dotted lowercase. Use `CAPTION_SIDECAR_EXTENSION_LIST` to list caption sidecars.
- Use `...` for UI labels, messages, logs, and console output; use `…` **only** for truncated text. Preserve syntax such as spreads and `tuple[str, ...]`.

## Verification

- Run commands from the project root using `backend/.venv/Scripts/python` on Windows or `backend/.venv/bin/python` on Linux/macOS.
- Use focused checks while iterating. Before finishing code changes, run `scripts/run_checks.py --fix` with `--scope backend` or `--scope frontend` when isolated; omit scope for shared tooling or cross-stack changes. Review fixer changes and preserve unrelated work. Rerun if auto-fixes return a failure.
- `--lint-only` skips tests but retains type checks; use for changes that **do not** affect runtime behavior. Documentation-only changes need a content/diff review, not the code suite.
- For UI changes, inspect the affected UI and run relevant covered E2E tests with `npm run test:e2e` from `frontend/`; the checks runner does not include them. See `docs/development.md` for setup when needed.
- Fix failures caused by the task. Report unrelated failures and blockers without weakening checks. Inspect the final diff before reporting completion.
