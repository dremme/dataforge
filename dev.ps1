<#
.SYNOPSIS
  Launches the DataForge backend and frontend dev servers in two separate console
  windows, waits until each is actually serving, then supervises them.

.DESCRIPTION
  Separate windows keep the logs isolated, so uvicorn hot reload never disturbs
  the Vite output. This launcher window stays open as a supervisor: press any key
  in it, or just close it, to stop both servers cleanly - including the uvicorn
  reload child process that an unguarded window-close would orphan.

  Use this directly, or double-click dev.bat for the same behavior. For a
  production run - bundled UI, one process, no hot reload - use start.ps1.

  The frontend's generated API types are rebuilt from backend/schemas.py on every
  launch. They are gitignored, so a branch switch leaves the other branch's shape
  in place and nothing else would notice.

.PARAMETER BackendOnly
  Start only the API (port from DATAFORGE_API_PORT, default 18080).

.PARAMETER FrontendOnly
  Start only the Vite dev server (port from DATAFORGE_UI_PORT, default 18081).

.PARAMETER NoBrowser
  Do not open the browser once the servers are ready.

.PARAMETER NoReload
  Run the API without uvicorn's reloader. Use this while a long job is running:
  a reload re-runs job recovery and re-spawns worker threads mid-flight.

.PARAMETER Detach
  Exit as soon as both servers are ready instead of supervising them. Stop them
  later with stop.bat.

.EXAMPLE
  .\dev.ps1 -NoReload

.EXAMPLE
  .\dev.ps1 -BackendOnly -NoBrowser
#>

[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoBrowser,
    [switch]$NoReload,
    [switch]$Detach
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge Dev Launcher'

# A non-zero exit is what makes dev.bat pause, so a double-clicked launcher
# keeps the error on screen. Running this script from a terminal stays quiet.
function Exit-Launcher {
    param([int]$Code = 1)
    Write-Host ''
    exit $Code
}

function Stop-DevServers {
    param(
        [System.Diagnostics.Process]$Backend,
        [System.Diagnostics.Process]$Frontend
    )

    Write-Host ''
    Write-Host 'Stopping dev servers...'
    foreach ($proc in @($Backend, $Frontend)) {
        if ($proc -and -not $proc.HasExited) {
            Stop-DevTree -ProcessId $proc.Id
        }
    }

    # Backstop: a console the user closed by hand leaves its server holding the
    # port, and there is no PID left to walk down from.
    if ($Backend) { Clear-DevPort -Port $DevApiPort -Label 'backend' | Out-Null }
    if ($Frontend) { Clear-DevPort -Port $DevUiPort -Label 'frontend' | Out-Null }
    Write-Host 'Stopped.'
}

if ($BackendOnly -and $FrontendOnly) {
    Write-Host '[ERROR] -BackendOnly and -FrontendOnly cannot be combined.' -ForegroundColor Red
    Exit-Launcher
}

$startBackend = -not $FrontendOnly
$startFrontend = -not $BackendOnly
$paths = Get-DevPaths

Write-Host '================================================'
Write-Host '  Starting DataForge Dev Servers'
if ($startBackend) { Write-Host ('  Backend  : {0}' -f $DevApiUrl) }
if ($startFrontend) { Write-Host ('  Frontend : {0}' -f $DevUiUrl) }
Write-Host '================================================'
Write-Host ''

# Ahead of the check below, not instead of it: regenerating is what keeps the three
# gitignored sources in step with backend\schemas.py across a branch switch, and the
# check stays as the backstop for a clone that has no venv to generate them with.
if ($startFrontend) { Update-DevGeneratedSources | Out-Null }

if (-not (Test-DevPrerequisites -SkipBackend:(-not $startBackend) -SkipFrontend:(-not $startFrontend))) {
    Exit-Launcher
}
Test-DependencyDrift -SkipBackend:(-not $startBackend) -SkipFrontend:(-not $startFrontend) | Out-Null

# Clear stale listeners before launching. Vite runs with strictPort, so a
# leftover node.exe on the UI port kills the frontend window the moment it starts.
if ($startBackend -and -not (Clear-DevPort -Port $DevApiPort -Label 'backend')) { Exit-Launcher }
if ($startFrontend -and -not (Clear-DevPort -Port $DevUiPort -Label 'frontend')) { Exit-Launcher }

$backendProc = $null
$frontendProc = $null
$backendReady = $false
$frontendReady = $false
$leaveRunning = $false

try {
    if ($startBackend) {
        Write-Host ('Starting backend on port {0}...' -f $DevApiPort)
        $reloadLabel = 'Hot reload: uvicorn reloader'
        $backendCommand = "`"$($paths.VenvPy)`" `"$($paths.DevServer)`""
        if ($NoReload) {
            $reloadLabel = 'Hot reload: disabled via --no-reload'
            $backendCommand += ' --no-reload'
        }
        $backendProc = Start-DevConsole `
            -Title 'DataForge - Backend' `
            -WorkingDirectory $paths.Root `
            -Banner @("DataForge Backend - $DevApiUrl", $reloadLabel) `
            -Command $backendCommand
        # Armed before the readiness wait: a cold start is the longest stretch in
        # which an impatient window-close would orphan a server.
        Register-DevExitGuard -ProcessId @($backendProc.Id)
    }

    if ($startFrontend) {
        Write-Host ('Starting frontend on port {0}...' -f $DevUiPort)
        $frontendProc = Start-DevConsole `
            -Title 'DataForge - Frontend' `
            -WorkingDirectory $paths.Frontend `
            -Banner @("DataForge Frontend - $DevUiUrl", 'Hot reload: Vite HMR') `
            -Command "call `"$(Get-NpmCommand)`" run dev"
        Register-DevExitGuard -ProcessId @(@($backendProc, $frontendProc) | Where-Object { $_ } | ForEach-Object { $_.Id })
    }

    Write-Host ''

    # Wait for real readiness rather than a fixed sleep: a cold Vite start is
    # routinely slower than any timeout worth hardcoding, and opening the browser
    # early just means a connection error you have to refresh past.
    if ($startBackend) {
        Write-Host '  Waiting for the API to answer /api/health...' -NoNewline
        $backendReady = Wait-HttpReady -Url $DevHealthUrl -TimeoutSec 60 -Process $backendProc
        if ($backendReady) { Write-Host ' ready.' -ForegroundColor Green } else { Write-Host ' FAILED.' -ForegroundColor Red }
    }

    if ($startFrontend) {
        Write-Host ('  Waiting for Vite to accept connections on {0}...' -f $DevUiPort) -NoNewline
        $frontendReady = Wait-TcpReady -Port $DevUiPort -TimeoutSec 90 -Process $frontendProc
        if ($frontendReady) { Write-Host ' ready.' -ForegroundColor Green } else { Write-Host ' FAILED.' -ForegroundColor Red }
    }

    $allReady = ((-not $startBackend) -or $backendReady) -and ((-not $startFrontend) -or $frontendReady)

    if (-not $allReady) {
        Write-Host ''
        if ($startBackend -and -not $backendReady) {
            Write-Host '[ERROR] The backend never became ready. Check the "DataForge - Backend" window.' -ForegroundColor Red
        }
        if ($startFrontend -and -not $frontendReady) {
            Write-Host '[ERROR] The frontend never became ready. Check the "DataForge - Frontend" window.' -ForegroundColor Red
        }
        Write-Host '        The server windows were left open so the error stays readable.'
        $leaveRunning = $true
        Unregister-DevExitGuard
        Exit-Launcher
    }

    if (-not $NoBrowser) {
        $url = $DevUiUrl
        if (-not $startFrontend) { $url = $DevApiUrl }
        try { Start-Process $url | Out-Null } catch { }
    }

    Write-Host ''
    Write-Host 'Hot reload:'
    if ($startFrontend) { Write-Host '  Frontend - Vite HMR on save' }
    if ($startBackend -and -not $NoReload) { Write-Host '  Backend  - uvicorn reloader on .py changes, tests excluded' }
    if ($startBackend -and $NoReload) { Write-Host '  Backend  - disabled, restart manually to pick up changes' }
    Write-Host ''

    if ($Detach) {
        $leaveRunning = $true
        Unregister-DevExitGuard
        Write-Host 'Servers are running in their own windows. Run stop.bat to stop them.'
        exit 0
    }

    Write-Host 'Both servers are running. This window supervises them.'
    Write-Host 'Press any key here to stop them, or just close this window.' -ForegroundColor Cyan
    try {
        [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    } catch {
        # No interactive console (redirected stdin) - fall back to a line read.
        Read-Host 'Press Enter to stop the servers' | Out-Null
    }
} finally {
    if (-not $leaveRunning) {
        Stop-DevServers -Backend $backendProc -Frontend $frontendProc
    }
}

exit 0
