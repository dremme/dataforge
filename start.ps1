<#
.SYNOPSIS
  Runs DataForge in production mode: builds the frontend if needed, then serves the
  bundled UI and the API from a single process.

.DESCRIPTION
  One uvicorn process binds DATAFORGE_UI_PORT (default 18081) and answers both the
  built UI at / and the API under /api. Same origin, so there is no proxy hop and no
  CORS - and no reloader, so a long job is never restarted out from under itself.

  The build is skipped when frontend\dist is newer than every frontend source, which
  makes the usual launch near-instant. This window stays open as a supervisor: press
  any key in it, or just close it, to stop the server cleanly.

  The frontend's generated API types are rebuilt from backend/schemas.py first. They
  are gitignored, so a branch switch leaves the other branch's shape in place, and a
  dist bundled from it would measure as up to date. Regenerating only rewrites what
  changed, so an unchanged shape still skips the build.

  Use this directly, or double-click start.bat for the same behavior. For hot
  reload while developing, use dev.ps1.

.PARAMETER Rebuild
  Build the frontend even when dist looks up to date.

.PARAMETER NoBuild
  Never build. Serves whatever is already in frontend\dist.

.PARAMETER NoBrowser
  Do not open the browser once the server is ready.

.PARAMETER Detach
  Exit as soon as the server is ready instead of supervising it. Stop it later with
  stop.bat.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -Rebuild -NoBrowser
#>

[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$NoBuild,
    [switch]$NoBrowser,
    [switch]$Detach
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge Launcher'

# A non-zero exit is what makes start.bat pause, so a double-clicked launcher
# keeps the error on screen. Running this script from a terminal stays quiet.
function Exit-Launcher {
    param([int]$Code = 1)
    Write-Host ''
    exit $Code
}

if ($Rebuild -and $NoBuild) {
    Write-Host '[ERROR] -Rebuild and -NoBuild cannot be combined.' -ForegroundColor Red
    Exit-Launcher
}

$paths = Get-DevPaths

Write-Host '================================================'
Write-Host '  Starting DataForge'
Write-Host ('  App      : {0}' -f $DevUiUrl)
Write-Host '  Mode     : production - bundled UI, no hot reload'
Write-Host '================================================'
Write-Host ''

# Ahead of both the check below and the freshness test: the generated sources are
# gitignored, so a branch switch leaves the other branch's shape in place, and a dist
# built from it would otherwise still measure as up to date.
Update-DevGeneratedSources | Out-Null

if (-not (Test-DevPrerequisites)) { Exit-Launcher }
Test-DependencyDrift | Out-Null

if ($NoBuild) {
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Dist 'index.html') -PathType Leaf)) {
        Write-Host '[ERROR] No frontend build in frontend\dist, and -NoBuild was passed.' -ForegroundColor Red
        Write-Host '        Run start.bat without -NoBuild, or build it yourself:'
        Write-Host '          cd frontend'
        Write-Host '          npm run build'
        Exit-Launcher
    }
    Write-Host 'Skipping the build (-NoBuild). Serving the existing frontend\dist.'
} elseif ($Rebuild -or -not (Test-DistFresh)) {
    if (-not (Invoke-FrontendBuild)) { Exit-Launcher }
} else {
    Write-Host 'Frontend build is up to date. Pass -Rebuild to force a rebuild.'
}
Write-Host ''

# Vite in a leftover dev window holds this port too, and the server would just fail
# to bind. Clearing it first keeps start.bat working right after dev.bat.
if (-not (Clear-DevPort -Port $DevUiPort -Label 'app')) { Exit-Launcher }

$appProc = $null
$leaveRunning = $false

try {
    Write-Host ('Starting the server on port {0}...' -f $DevUiPort)
    $appProc = Start-DevConsole `
        -Title 'DataForge - Server' `
        -WorkingDirectory $paths.Root `
        -Banner @("DataForge - $DevUiUrl", 'Production: bundled UI, no hot reload') `
        -Command "`"$($paths.VenvPy)`" `"$($paths.ProdServer)`""
    # Armed before the readiness wait: a cold start is the longest stretch in which
    # an impatient window-close would orphan the server.
    Register-DevExitGuard -ProcessId @($appProc.Id)

    Write-Host ''
    Write-Host '  Waiting for the app to answer /api/health...' -NoNewline
    $ready = Wait-HttpReady -Url $DevAppHealthUrl -TimeoutSec 60 -Process $appProc
    if ($ready) { Write-Host ' ready.' -ForegroundColor Green } else { Write-Host ' FAILED.' -ForegroundColor Red }

    if (-not $ready) {
        Write-Host ''
        Write-Host '[ERROR] The server never became ready. Check the "DataForge - Server" window.' -ForegroundColor Red
        Write-Host '        That window was left open so the error stays readable.'
        $leaveRunning = $true
        Unregister-DevExitGuard
        Exit-Launcher
    }

    if (-not $NoBrowser) {
        try { Start-Process $DevUiUrl | Out-Null } catch { }
    }

    Write-Host ''
    if ($Detach) {
        $leaveRunning = $true
        Unregister-DevExitGuard
        Write-Host 'The server is running in its own window. Run stop.bat to stop it.'
        exit 0
    }

    Write-Host 'The app is running. This window supervises it.'
    Write-Host 'Press any key here to stop it, or just close this window.' -ForegroundColor Cyan
    try {
        [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    } catch {
        # No interactive console (redirected stdin) - fall back to a line read.
        Read-Host 'Press Enter to stop the server' | Out-Null
    }
} finally {
    if (-not $leaveRunning) {
        Write-Host ''
        Write-Host 'Stopping the server...'
        if ($appProc -and -not $appProc.HasExited) { Stop-DevTree -ProcessId $appProc.Id }
        # Backstop: a console closed by hand leaves the server holding the port with
        # no PID left to walk down from.
        Clear-DevPort -Port $DevUiPort -Label 'app' | Out-Null
        Write-Host 'Stopped.'
    }
}

exit 0
