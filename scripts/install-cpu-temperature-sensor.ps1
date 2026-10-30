<#
.SYNOPSIS
  Shows the CPU temperature in the automation panel on Intel and AMD under Windows.

.DESCRIPTION
  Windows exposes no CPU temperature a normal process can read. The PawnIO driver
  (https://pawnio.eu) can, but only for administrators. This installs PawnIO if it
  is missing, downloads the signed PawnIO module for this CPU, and registers a
  hidden scheduled task that uses it as SYSTEM to write the reading to
  %ProgramData%\DataForge\sensors\cpu_temperature.txt, which the unelevated backend
  reads. DataForge itself keeps running without elevation.

  The task only runs code from admin-only locations: copies of sensor-loop.ps1 and
  the module in the locked-down sensors folder, and PawnIO's own installation.

.PARAMETER Uninstall
  Stops and removes the task and the sensors folder. PawnIO stays installed, because
  other tools may rely on it.

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
$ErrorFile = Join-Path $SensorDir 'cpu_temperature.error'
$FirstReadingTimeoutSeconds = 20
$PawnIoUninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO'
$PawnIoSetupUrl = 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe'
$PawnIoSetupSha256 = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
$RebootRequiredExitCode = 3010
$ModulesUrl = 'https://github.com/namazso/PawnIO.Modules/releases/download/0.2.11/release_0_2_11.zip'
$ModulesSha256 = '43608cb89bc84247fef1368a139013f7d043e17db6d6c8dfc9b46bf0905a81f4'

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

function Get-CpuVendor($Cpu) {
  switch ($Cpu.Manufacturer) {
    'GenuineIntel' { return 'Intel' }
    'AuthenticAMD' { return 'AMD' }
  }
  throw "CPU temperature needs an Intel or AMD CPU, but this one reports '$($Cpu.Manufacturer)'."
}

function Get-TctlOffset([string] $CpuName) {
  if ($CpuName -match '\b(1600X|1700X|1800X)\b') { return 20 }
  if ($CpuName -match '\b2700X\b') { return 10 }
  if ($CpuName -match 'Threadripper (19|29)\d\d') { return 27 }
  0
}

function Find-PawnIoDir {
  $installed = Get-ItemProperty -LiteralPath $PawnIoUninstallKey -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($installed.InstallLocation) { $installed.InstallLocation.Trim('"') }),
    (Join-Path $env:ProgramFiles 'PawnIO'))
  foreach ($directory in $candidates) {
    if ($directory -and (Test-Path -LiteralPath (Join-Path $directory 'PawnIOLib.dll'))) {
      return $directory
    }
  }
  $null
}

function Get-VerifiedDownload([string] $Url, [string] $Sha256) {
  # Stays in memory so nothing user-writable sits between the digest check and the locked folder.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $client = New-Object Net.WebClient
  try {
    $content = $client.DownloadData($Url)
  } finally {
    $client.Dispose()
  }
  $hasher = [Security.Cryptography.SHA256]::Create()
  $digest = -join ($hasher.ComputeHash($content) | ForEach-Object { $_.ToString('x2') })
  $hasher.Dispose()
  if ($digest -ne $Sha256) {
    throw "$Url has digest $digest, expected $Sha256."
  }
  , $content
}

function Install-PawnIo([byte[]] $Setup) {
  # Runs from the locked folder: an elevated user's %TEMP% is still writable by unelevated code.
  $setupFile = Join-Path $SensorDir 'PawnIO_setup.exe'
  [IO.File]::WriteAllBytes($setupFile, $Setup)
  Write-Host 'Installing PawnIO...'
  try {
    $exitCode = (Start-Process -FilePath $setupFile -ArgumentList '-install', '-silent' `
        -Wait -PassThru).ExitCode
  } finally {
    Remove-Item -LiteralPath $setupFile -Force
  }
  if ($exitCode -eq $RebootRequiredExitCode) {
    throw 'PawnIO was installed but needs a restart. Restart Windows and run this again.'
  }
  if ($exitCode -ne 0) {
    throw "PawnIO's setup failed with exit code $exitCode."
  }
  $directory = Find-PawnIoDir
  if (-not $directory) {
    throw "PawnIO's setup finished, but PawnIOLib.dll was not found."
  }
  $directory
}

function Save-Module([byte[]] $Archive, [string] $Name) {
  Add-Type -AssemblyName System.IO.Compression
  $zip = New-Object IO.Compression.ZipArchive((New-Object IO.MemoryStream(, $Archive)))
  try {
    $source = $zip.GetEntry($Name).Open()
    $target = [IO.File]::Create((Join-Path $SensorDir $Name))
    try {
      $source.CopyTo($target)
    } finally {
      $target.Dispose()
      $source.Dispose()
    }
  } finally {
    $zip.Dispose()
  }
}

function Wait-FirstReading {
  $deadline = (Get-Date).AddSeconds($FirstReadingTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ReadingFile) {
      return (Get-Content -Raw -LiteralPath $ReadingFile).Trim()
    }
    Start-Sleep -Milliseconds 250
  }
  $null
}

function Get-LastFailure {
  try {
    (Get-Content -Raw -LiteralPath $ErrorFile).Trim()
  } catch {
    'No error was reported.'
  }
}

if ($Uninstall) {
  Uninstall-Sensor
  Write-Host "Removed the '$TaskName' task and $SensorDir."
  return
}

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$vendor = Get-CpuVendor $cpu
$module = if ($vendor -eq 'Intel') { 'IntelMSR.bin' } else { 'AMDFamily17.bin' }
$pawnIoDir = Find-PawnIoDir
$pawnIoSetup = $null
if (-not $pawnIoDir) {
  $pawnIoSetup = Get-VerifiedDownload $PawnIoSetupUrl $PawnIoSetupSha256
}
$modules = Get-VerifiedDownload $ModulesUrl $ModulesSha256

Stop-SensorTask
New-SensorDir
if (-not $pawnIoDir) {
  try {
    $pawnIoDir = Install-PawnIo $pawnIoSetup
  } catch {
    Uninstall-Sensor
    throw
  }
}
Save-Module $modules $module
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cpu-temperature-sensor\sensor-loop.ps1') -Destination $LoopScript -Force

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$LoopScript`" " +
    "-PawnIoDir `"$pawnIoDir`" -Vendor $vendor -TctlOffset $(Get-TctlOffset $cpu.Name)")
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
  $failure = Get-LastFailure
  Uninstall-Sensor
  throw "PawnIO did not report a temperature within $FirstReadingTimeoutSeconds seconds, so nothing was installed.`n$failure"
}

Write-Host "PawnIO reads the $vendor CPU at $celsius Celsius."
Write-Host "Installed the '$TaskName' task. It starts with Windows and updates"
Write-Host "$SensorDir\cpu_temperature.txt every two seconds."
Write-Host "Remove it with: scripts\install-cpu-temperature-sensor.bat -Uninstall"
