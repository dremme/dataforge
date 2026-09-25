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
$MaxRetryMilliseconds = 30000
$Reading = '(?m)^GetCurrentTemperature\s*\.+\s*(-?\d+(?:\.\d+)?) Celsius'
$SdkSessions = 'Global\AMDRyzenMasterSemaphore'

Add-Type -Namespace DataForge -Name AmdSdkSessions -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr OpenSemaphoreW(uint desiredAccess, bool inheritHandle, string name);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool ReleaseSemaphore(IntPtr semaphore, int releaseCount, out int previousCount);

[DllImport("kernel32.dll")]
public static extern bool CloseHandle(IntPtr handle);

[DllImport("ntdll.dll")]
public static extern int NtQuerySemaphore(
  IntPtr semaphore, int informationClass, int[] information, int length, IntPtr returnLength);
'@

function Test-Reading([string] $Output) {
  $match = [regex]::Match($Output, $Reading)
  $match.Success -and [double]$match.Groups[1].Value -ge 0
}

function Restore-SdkSessions([string] $Name) {
  # AMD's Device.dll takes a slot on every Init and never releases one. While another SDK client
  # such as MSI Center keeps the semaphore alive, one CLI run every two seconds drains it in hours.
  $semaphoreModifyAndQueryState = 0x3
  $semaphore = [DataForge.AmdSdkSessions]::OpenSemaphoreW($semaphoreModifyAndQueryState, $false, $Name)
  if ($semaphore -eq [IntPtr]::Zero) {
    return
  }
  try {
    $counts = [int[]]::new(2)
    $semaphoreBasicInformation = 0
    $status = [DataForge.AmdSdkSessions]::NtQuerySemaphore(
      $semaphore, $semaphoreBasicInformation, $counts, 8, [IntPtr]::Zero)
    if ($status -eq 0 -and $counts[0] -lt $counts[1]) {
      $previous = 0
      [void][DataForge.AmdSdkSessions]::ReleaseSemaphore($semaphore, $counts[1] - $counts[0], [ref]$previous)
    }
  } finally {
    [void][DataForge.AmdSdkSessions]::CloseHandle($semaphore)
  }
}

$failures = 0
while ($true) {
  $published = $false
  try {
    Restore-SdkSessions $SdkSessions
    $process = Start-Process -FilePath $Cli -ArgumentList '-a', 'GetPMTableData' `
      -WorkingDirectory (Split-Path $Cli) -NoNewWindow -PassThru `
      -RedirectStandardOutput $PendingFile
    if (-not $process.WaitForExit($CliTimeoutMilliseconds)) {
      $process.Kill()
    } elseif (Test-Reading (Get-Content -Raw -LiteralPath $PendingFile)) {
      Move-Item -Force -LiteralPath $PendingFile -Destination $OutputFile
      $published = $true
    }
  } catch {
    # The backend may hold the file open mid-read; retrying soon replaces it.
  }
  if ($published) {
    $failures = 0
    $delay = $IntervalMilliseconds
  } else {
    $delay = [Math]::Min($RetryMilliseconds * [Math]::Pow(2, $failures), $MaxRetryMilliseconds)
    $failures = [Math]::Min($failures + 1, 16)
  }
  Start-Sleep -Milliseconds $delay
}
