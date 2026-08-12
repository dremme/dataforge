# Starts only the frontend dev server (Vite) in this terminal.
# Use this (or start-backend.ps1) in separate terminals when you want fully
# independent control. For both dev servers at once, use dev.bat / dev.ps1.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge - Frontend'

$paths = Get-DevPaths
Set-Location $paths.Frontend

if (-not (Test-DevPrerequisites -SkipBackend)) {
    Read-Host 'Press Enter to exit' | Out-Null
    exit 1
}
Test-DependencyDrift -SkipBackend | Out-Null

# Vite runs with strictPort, so a leftover node.exe here is fatal rather than
# something it can route around.
if (-not (Clear-DevPort -Port $DevUiPort -Label 'frontend')) {
    Read-Host 'Press Enter to exit' | Out-Null
    exit 1
}

Write-Host ('Starting frontend on {0} ...' -f $DevUiUrl)
& (Get-NpmCommand) run dev
