<#
.SYNOPSIS
  Shows the CPU temperature in the automation panel on AMD Ryzen under Windows.

.DESCRIPTION
  Windows exposes no CPU temperature a normal process can read. AMD's Ryzen Master
  SDK driver can, but only for administrators. This registers a hidden scheduled
  task that runs AMD's CLI as SYSTEM and writes the reading to
  %ProgramData%\DataForge\sensors\cpu_temperature.txt, which the unelevated
  backend reads. DataForge itself keeps running without elevation.

  The task only runs code from admin-only locations: a copy of sensor-loop.ps1 in
  the locked-down sensors folder, and AMD's CLI under Program Files.

  Requires the AMD Ryzen Master Monitoring SDK:
  https://www.amd.com/en/developer/ryzen-master-monitoring-sdk.html

.PARAMETER Uninstall
  Stops and removes the task and the sensors folder.

.EXAMPLE
  scripts\install-cpu-temperature-sensor.bat

.EXAMPLE
  scripts\install-cpu-temperature-sensor.bat -Uninstall
#>

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$TaskName = 'DataForge CPU temperature'
$DataForgeDir = Join-Path $env:ProgramData 'DataForge'
$SensorDir = Join-Path $DataForgeDir 'sensors'
$LoopScript = Join-Path $SensorDir 'sensor-loop.ps1'
$ReadingFile = Join-Path $SensorDir 'cpu_temperature.txt'
$PendingFile = Join-Path $SensorDir 'cpu_temperature.pending'
$FirstReadingTimeoutSeconds = 20
$Cli =Join-Path $env:ProgramFiles 'AMD\RyzenMasterSDK\AMDRyzenMasterCLI\bin-prebuilt\AMDRyzenMasterCLI.exe'

$SystemSid = 'S-1-5-18'
$AdministratorsSid = 'S-1-5-32-544'
$UsersSid = 'S-1-5-32-545'

function Stop-SensorTask {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName
  }
}

function Assert-NotLink([string] $Path) {
  if ((Test-Path -LiteralPath $Path) -and
      ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "$Path is a link. Remove it and run this script again."
  }
}

function New-AccessRule([string] $Sid, [Security.AccessControl.FileSystemRights] $Rights) {
  New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($Sid)),
    $Rights,
    'ContainerInherit, ObjectInherit',
    'None',
    'Allow')
}

function Remove-SensorDir {
  Assert-NotLink $SensorDir
  if (Test-Path -LiteralPath $SensorDir) {
    Remove-Item -LiteralPath $SensorDir -Recurse -Force
  }
}

function New-SensorDir {
  # Any user may create folders in ProgramData, so an existing one may be theirs.
  Assert-NotLink $DataForgeDir
  New-Item -ItemType Directory -Force -Path $DataForgeDir | Out-Null
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($AdministratorsSid)))
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-AccessRule $SystemSid 'FullControl'))
  $acl.AddAccessRule((New-AccessRule $AdministratorsSid 'FullControl'))
  $acl.AddAccessRule((New-AccessRule $UsersSid 'ReadAndExecute'))
  Set-Acl -LiteralPath $DataForgeDir -AclObject $acl
  Remove-SensorDir
  New-Item -ItemType Directory -Path $SensorDir | Out-Null
}

function Uninstall-Sensor {
  Stop-SensorTask
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-SensorDir
  if ((Test-Path -LiteralPath $DataForgeDir) -and -not (Get-ChildItem -LiteralPath $DataForgeDir -Force)) {
    Remove-Item -LiteralPath $DataForgeDir -Force
  }
}

function Wait-FirstReading {
  $deadline = (Get-Date).AddSeconds($FirstReadingTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ReadingFile) {
      $reading = [regex]::Match((Get-Content -Raw -LiteralPath $ReadingFile),
        '(?m)^GetCurrentTemperature\s*\.+\s*(-?\d+(?:\.\d+)?) Celsius')
      return $reading.Groups[1].Value
    }
    Start-Sleep -Milliseconds 250
  }
  $null
}

function Get-LastCliOutput {
  try {
    Get-Content -Raw -LiteralPath $PendingFile
  } catch {
    'nothing'
  }
}

if ($Uninstall) {
  Uninstall-Sensor
  Write-Host "Removed the '$TaskName' task and $SensorDir."
  return
}

if (-not (Test-Path -LiteralPath $Cli)) {
  throw "AMD's Ryzen Master SDK CLI was not found at $Cli. Install the SDK first: https://www.amd.com/en/developer/ryzen-master-monitoring-sdk.html"
}

Stop-SensorTask
New-SensorDir
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cpu-temperature-sensor\sensor-loop.ps1') -Destination $LoopScript -Force

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$LoopScript`" -Cli `"$Cli`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$celsius = Wait-FirstReading
if (-not $celsius) {
  $output = Get-LastCliOutput
  Uninstall-Sensor
  throw "AMD's CLI did not report a temperature within $FirstReadingTimeoutSeconds seconds, so nothing was installed. It printed:`n$output"
}

Write-Host "AMD's CLI reads the CPU at $celsius Celsius."
Write-Host "Installed the '$TaskName' task. It starts with Windows and updates"
Write-Host "$SensorDir\cpu_temperature.txt every two seconds."
Write-Host "Remove it with: scripts\install-cpu-temperature-sensor.bat -Uninstall"
