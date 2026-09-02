#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath .githooks

echo "Installed git hooks from .githooks/"
echo "Pre-commit will auto-fix lint/format issues, then run backend Ruff, frontend ESLint, and Prettier."
echo
echo "Dev dependencies required (from project root):"
echo "  backend: backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt"
echo "  frontend: cd frontend && npm ci"