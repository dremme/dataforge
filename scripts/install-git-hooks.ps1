# Install tracked git hooks for this repository.
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

git config core.hooksPath .githooks

Write-Host "Installed git hooks from .githooks/"
Write-Host "Pre-commit will auto-fix lint/format issues, then run backend Ruff, frontend ESLint, and Prettier."
Write-Host ""
Write-Host "Dependencies required (from project root):"
Write-Host "  backend: backend\.venv\Scripts\pip install -r backend\requirements.txt -r backend\requirements-dev.txt"
Write-Host "  frontend: cd frontend; npm install"