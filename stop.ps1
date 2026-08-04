<#
.SYNOPSIS
  Stops the DataForge dev servers by freeing ports 8080 and 8081.

.DESCRIPTION
  The escape hatch for when the supervising start.ps1 window is already gone and
  a server is still holding its port - typically after closing a console with the
  X button, which leaves the uvicorn reload child running.

  Only leftover python/node processes are stopped; anything else on those ports
  is reported and left alone.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')

$Host.UI.RawUI.WindowTitle = 'DataForge - Stop'

Write-Host 'Stopping DataForge dev servers...'

$backendFreed = Clear-DevPort -Port $DevApiPort -Label 'backend'
$frontendFreed = Clear-DevPort -Port $DevUiPort -Label 'frontend'

if ($backendFreed -and $frontendFreed) {
    Write-Host ('Ports {0} and {1} are free.' -f $DevApiPort, $DevUiPort) -ForegroundColor Green
    exit 0
}

exit 1
