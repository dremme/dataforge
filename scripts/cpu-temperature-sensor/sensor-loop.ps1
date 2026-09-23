<#
.SYNOPSIS
  Writes AMD's CPU temperature reading next to this script every two seconds.
  Installed and run as SYSTEM by install-cpu-temperature-sensor.ps1.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Cli
)

$ErrorActionPreference = 'Stop'

$OutputFile = Join-Path $PSScriptRoot 'cpu_temperature.txt'
$PendingFile = Join-Path $PSScriptRoot 'cpu_temperature.pending'
$CliTimeoutMilliseconds = 5000
$IntervalMilliseconds = 2000
$RetryMilliseconds = 500
$Reading = '(?m)^GetCurrentTemperature\s*\.+\s*(-?\d+(?:\.\d+)?) Celsius'

function Test-Reading([string] $Output) {
  $match = [regex]::Match($Output, $Reading)
  $match.Success -and [double]$match.Groups[1].Value -ge 0
}

while ($true) {
  $delay = $RetryMilliseconds
  try {
    $process = Start-Process -FilePath $Cli -ArgumentList '-a', 'GetPMTableData' `
      -WorkingDirectory (Split-Path $Cli) -NoNewWindow -PassThru `
      -RedirectStandardOutput $PendingFile
    if (-not $process.WaitForExit($CliTimeoutMilliseconds)) {
      $process.Kill()
    } elseif (Test-Reading (Get-Content -Raw -LiteralPath $PendingFile)) {
      Move-Item -Force -LiteralPath $PendingFile -Destination $OutputFile
      $delay = $IntervalMilliseconds
    }
  } catch {
    # The backend may hold the file open mid-read; retrying soon replaces it.
  }
  Start-Sleep -Milliseconds $delay
}
