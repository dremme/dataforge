<#
.SYNOPSIS
  Stops DataForge by freeing the configured ports. Covers both launchers.

.DESCRIPTION
  The escape hatch for when the supervising launcher window is already gone and a
  server is still holding its port - typically after closing a console with the X
  button, which leaves the uvicorn reload child running.

  Both ports are cleared either way: dev.ps1 uses one per server, and start.ps1
  serves everything on the UI port.

  Only leftover python/node processes are stopped; anything else on those ports
  is reported and left alone.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge - Stop'

Write-Host 'Stopping DataForge servers...'

# Neither port has a fixed occupant here: 8081 is Vite under dev.ps1 and the whole
# app under start.ps1, so the label names the product rather than a half of it.
$apiFreed = Clear-DevPort -Port $DevApiPort -Label 'DataForge'
$uiFreed = Clear-DevPort -Port $DevUiPort -Label 'DataForge'

if ($apiFreed -and $uiFreed) {
    Write-Host ('Ports {0} and {1} are free.' -f $DevApiPort, $DevUiPort) -ForegroundColor Green
    exit 0
}

exit 1
