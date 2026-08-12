# Starts only the backend API server in this terminal.
# Use this (or start-frontend.ps1) in separate terminals when you want fully
# independent control. For both dev servers at once, use dev.bat / dev.ps1.

[CmdletBinding()]
param(
    # Run without uvicorn's reloader - useful while a long job is running, since
    # a reload re-runs job recovery and re-spawns worker threads mid-flight.
    [switch]$NoReload
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge - Backend'

$paths = Get-DevPaths
Set-Location $paths.Root

if (-not (Test-DevPrerequisites -SkipFrontend)) {
    Read-Host 'Press Enter to exit' | Out-Null
    exit 1
}
Test-DependencyDrift -SkipFrontend | Out-Null

if (-not (Clear-DevPort -Port $DevApiPort -Label 'backend')) {
    Read-Host 'Press Enter to exit' | Out-Null
    exit 1
}

$serverArgs = @($paths.DevServer)
if ($NoReload) { $serverArgs += '--no-reload' }

Write-Host ('Starting backend on {0} ...' -f $DevApiUrl)
& $paths.VenvPy $serverArgs
