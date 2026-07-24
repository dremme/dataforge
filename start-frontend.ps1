# Starts only the frontend dev server (Vite) in this terminal.
# Use this (or start-backend.ps1) in separate terminals when you want fully
# independent control. For both servers at once, use start.bat / start.ps1.

$Host.UI.RawUI.WindowTitle = "DataForge - Frontend"
$ROOT = $PSScriptRoot
$FRONTEND = Join-Path $ROOT "frontend"
Set-Location $FRONTEND

# Kill anything already listening on the UI port (robust)
$ports = @(8081)
foreach ($port in $ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
        }
}

$NODE_DIR = Join-Path $ROOT '.node'
if (Test-Path (Join-Path $NODE_DIR 'npm.cmd')) {
    $NPM = Join-Path $NODE_DIR 'npm.cmd'
} else {
    $NPM = 'npm.cmd'
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[ERROR] Frontend dependencies not installed. From the project root, run:" -ForegroundColor Red
    Write-Host "  cd frontend"
    Write-Host "  $NPM install"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Starting frontend on http://localhost:8081 (Vite dev server)..."
& $NPM run dev
