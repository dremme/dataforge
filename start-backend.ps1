# Starts only the backend API server in this terminal.
# Use this (or start-frontend.ps1) in separate terminals when you want fully
# independent control. For both servers at once, use start.bat / start.ps1.

$Host.UI.RawUI.WindowTitle = "DataForge - Backend"
$ROOT = $PSScriptRoot
$BACKEND = Join-Path $ROOT "backend"
$SCRIPTS = Join-Path $ROOT "scripts"
Set-Location $ROOT

$venvPy = Join-Path $BACKEND ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "[ERROR] Python venv not found. Run setup.bat from the project root, or:" -ForegroundColor Red
    Write-Host "  python -m venv backend\.venv"
    Write-Host "  backend\.venv\Scripts\pip install -r backend\requirements.txt -r backend\requirements-dev.txt"
    Read-Host "Press Enter to exit"
    exit 1
}

# Kill anything already listening (robust)
Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }

Write-Host "Starting backend on http://127.0.0.1:8080 (reload enabled, tests excluded)..."
& $venvPy (Join-Path $SCRIPTS "dev_server.py")
