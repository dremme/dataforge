<#
.SYNOPSIS
  Launches the backend API and frontend dev server in two separate Command Prompt
  windows. Keeps logs isolated so uvicorn hot reload never disturbs the Vite process.

  Use this directly, or double-click start.bat for the same behavior.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ROOT = $PSScriptRoot
$BACKEND = Join-Path $ROOT 'backend'
$FRONTEND = Join-Path $ROOT 'frontend'
$SCRIPTS = Join-Path $ROOT 'scripts'
$VENV_PY = Join-Path $BACKEND '.venv\Scripts\python.exe'
$URL = 'http://127.0.0.1:8081'

$NODE_DIR = Join-Path $ROOT '.node'
if (Test-Path (Join-Path $NODE_DIR 'npm.cmd')) {
    $NPM = Join-Path $NODE_DIR 'npm.cmd'
} else {
    $NPM = 'npm.cmd'
}

function Write-ErrorAndExit($msg) {
    Write-Host $msg -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to exit'
    exit 1
}

if (-not (Test-Path $VENV_PY)) {
    Write-ErrorAndExit @"
[ERROR] Python venv not found. Run setup.bat from the project root, or:
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt -r backend\requirements-dev.txt
"@
}

if (-not (Test-Path (Join-Path $FRONTEND 'node_modules'))) {
    Write-ErrorAndExit @"
[ERROR] Frontend dependencies not installed. From the project root, run:
  cd frontend
  npm install
"@
}

Write-Host '================================================'
Write-Host '  Starting DataForge Dev Servers'
Write-Host '  Backend  : http://127.0.0.1:8080'
Write-Host '  Frontend : http://127.0.0.1:8081'
Write-Host '================================================'
Write-Host ''

Write-Host '[1/2] Starting backend on port 8080 with hot reload...'
$backendCmd = @(
    'title DataForge - Backend',
    "cd /d `"$ROOT`"",
    'echo DataForge Backend - http://127.0.0.1:8080',
    'echo Hot reload: uvicorn --reload',
    'echo.',
    "`"$VENV_PY`" `"$(Join-Path $SCRIPTS 'dev_server.py')`""
) -join ' && '
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $backendCmd -WindowStyle Normal | Out-Null

Start-Sleep -Seconds 2

Write-Host '[2/2] Starting frontend on port 8081 with Vite HMR...'
$frontendCmd = @(
    'title DataForge - Frontend',
    "cd /d `"$FRONTEND`"",
    'echo DataForge Frontend - http://127.0.0.1:8081',
    'echo Hot reload: Vite HMR',
    'echo.',
    "call `"$NPM`" run dev"
) -join ' && '
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $frontendCmd -WindowStyle Normal | Out-Null

Start-Sleep -Seconds 3
try {
    Start-Process $URL | Out-Null
} catch {}

Write-Host ''
Write-Host 'Both servers are running in separate windows.'
Write-Host ''
Write-Host 'Hot reload:'
Write-Host '  Frontend - Vite HMR on save'
Write-Host '  Backend  - uvicorn reloader on .py changes (tests excluded)'
Write-Host ''
Write-Host 'To stop: close each server window or press Ctrl+C inside it.'
Write-Host ''
Read-Host 'Press Enter to close this launcher window'

exit 0