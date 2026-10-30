<#
.SYNOPSIS
  Writes the CPU temperature next to this script every two seconds, as one Celsius number.
  Installed and run as SYSTEM by install-cpu-temperature-sensor.ps1.

.PARAMETER PawnIoDir
  The PawnIO installation holding PawnIOLib.dll.

.PARAMETER Vendor
  Picks the PawnIO module next to this script and how to read it.

.PARAMETER TctlOffset
  Degrees that some Ryzen models report above the real die temperature.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $PawnIoDir,
  [Parameter(Mandatory)] [ValidateSet('Intel', 'AMD')] [string] $Vendor,
  [double] $TctlOffset = 0
)

$ErrorActionPreference = 'Stop'

$OutputFile = Join-Path $PSScriptRoot 'cpu_temperature.txt'
$PendingFile = Join-Path $PSScriptRoot 'cpu_temperature.pending'
$ErrorFile = Join-Path $PSScriptRoot 'cpu_temperature.error'
$ModuleFile = Join-Path $PSScriptRoot $(if ($Vendor -eq 'Intel') { 'IntelMSR.bin' } else { 'AMDFamily17.bin' })
$IntervalMilliseconds = 2000
$RetryMilliseconds = 500
$MaxRetryMilliseconds = 30000
# Other hardware software was measured holding the bus for about 160 ms at a time.
$PciMutexTimeoutMilliseconds = 1000
$MaxPlausibleCelsius = 125
$IntelTemperatureTarget = 0x1A2
$IntelPackageThermStatus = 0x1B1
$AmdThermalControl = 0x59800

Add-Type -Namespace DataForge -Name PawnIo -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool SetDllDirectoryW(string path);

[DllImport("PawnIOLib.dll")]
public static extern int pawnio_open(out IntPtr handle);

[DllImport("PawnIOLib.dll")]
public static extern int pawnio_load(IntPtr handle, byte[] blob, UIntPtr size);

[DllImport("PawnIOLib.dll", CharSet = CharSet.Ansi)]
public static extern int pawnio_execute(
  IntPtr handle, string name, ulong[] input, UIntPtr inputCells,
  ulong[] output, UIntPtr outputCells, out UIntPtr returnedCells);

[DllImport("PawnIOLib.dll")]
public static extern int pawnio_close(IntPtr handle);
'@

function Assert-Success([int] $Result, [string] $Action) {
  if ($Result -lt 0) {
    throw ('{0} failed with 0x{1:X8}.' -f $Action, $Result)
  }
}

function Close-Module([IntPtr] $Handle) {
  if ($Handle -ne [IntPtr]::Zero) {
    [void][DataForge.PawnIo]::pawnio_close($Handle)
  }
}

function Open-Module {
  $handle = [IntPtr]::Zero
  Assert-Success ([DataForge.PawnIo]::pawnio_open([ref]$handle)) 'Opening PawnIO'
  try {
    $module = [IO.File]::ReadAllBytes($ModuleFile)
    Assert-Success ([DataForge.PawnIo]::pawnio_load($handle, $module, [UIntPtr][uint64]$module.Length)) `
      "Loading $(Split-Path -Leaf $ModuleFile)"
  } catch {
    Close-Module $handle
    throw
  }
  $handle
}

function Read-Register([IntPtr] $Handle, [string] $Function, [uint64] $Address) {
  $output = [uint64[]]::new(1)
  $returned = [UIntPtr]::Zero
  $oneCell = [UIntPtr][uint64]1
  Assert-Success ([DataForge.PawnIo]::pawnio_execute(
      $Handle, $Function, [uint64[]]@($Address), $oneCell, $output, $oneCell, [ref]$returned)) $Function
  $output[0]
}

function ConvertTo-IntelCelsius([uint64] $TemperatureTarget, [uint64] $ThermStatus) {
  if (-not ($ThermStatus -band 0x80000000L)) {
    throw 'The CPU marked its temperature reading as invalid.'
  }
  $tjMax = ($TemperatureTarget -shr 16) -band 0xFF
  $degreesBelowTjMax = ($ThermStatus -shr 16) -band 0x7F
  [double]($tjMax - $degreesBelowTjMax)
}

function ConvertTo-AmdCelsius([uint64] $ThermalControl, [double] $Offset) {
  $celsius = (($ThermalControl -shr 21) -band 0x7FF) * 0.125
  # Bit 19, or both of bits 17:16, select the range that starts at -49 Celsius.
  if (($ThermalControl -band 0x80000) -or (($ThermalControl -band 0x30000) -eq 0x30000)) {
    $celsius -= 49
  }
  $celsius - $Offset
}

function New-PciMutex {
  # Every hardware monitor shares this name for the PCI bus, so unelevated ones must open it too.
  $everyone = New-Object Security.Principal.SecurityIdentifier(
    [Security.Principal.WellKnownSidType]::WorldSid, $null)
  $security = New-Object Security.AccessControl.MutexSecurity
  $security.AddAccessRule((New-Object Security.AccessControl.MutexAccessRule(
        $everyone, [Security.AccessControl.MutexRights]::FullControl, 'Allow')))
  $created = $false
  New-Object Threading.Mutex($false, 'Global\Access_PCI', [ref]$created, $security)
}

function Read-Celsius([IntPtr] $Handle) {
  if ($Vendor -eq 'Intel') {
    return ConvertTo-IntelCelsius (Read-Register $Handle 'ioctl_read_msr' $IntelTemperatureTarget) `
      (Read-Register $Handle 'ioctl_read_msr' $IntelPackageThermStatus)
  }

  try {
    if (-not $PciMutex.WaitOne($PciMutexTimeoutMilliseconds)) {
      throw 'Another tool kept the PCI bus busy.'
    }
  } catch [Threading.AbandonedMutexException] {
    # A holder that crashed still hands ownership over.
  }
  try {
    $thermalControl = Read-Register $Handle 'ioctl_read_smn' $AmdThermalControl
  } finally {
    $PciMutex.ReleaseMutex()
  }
  ConvertTo-AmdCelsius $thermalControl $TctlOffset
}

function Publish-Reading([double] $Celsius) {
  if ($Celsius -le 0 -or $Celsius -gt $MaxPlausibleCelsius) {
    throw "Implausible reading: $Celsius Celsius."
  }
  $text = $Celsius.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
  [IO.File]::WriteAllText($PendingFile, $text)
  Move-Item -Force -LiteralPath $PendingFile -Destination $OutputFile
}

function Get-NextDelay([int] $Failures) {
  if ($Failures -eq 0) {
    return $IntervalMilliseconds
  }
  [Math]::Min($RetryMilliseconds * [Math]::Pow(2, $Failures - 1), $MaxRetryMilliseconds)
}

[void][DataForge.PawnIo]::SetDllDirectoryW($PawnIoDir)
if ($Vendor -eq 'AMD') {
  $PciMutex = New-PciMutex
}

$handle = [IntPtr]::Zero
$failures = 0
while ($true) {
  try {
    if ($handle -eq [IntPtr]::Zero) {
      $handle = Open-Module
    }
    Publish-Reading (Read-Celsius $handle)
    $failures = 0
  } catch {
    # The backend may hold the file open mid-read; retrying soon replaces it.
    Set-Content -LiteralPath $ErrorFile -Value $_.Exception.Message -ErrorAction SilentlyContinue
    Close-Module $handle
    $handle = [IntPtr]::Zero
    $failures = [Math]::Min($failures + 1, 16)
  }
  Start-Sleep -Milliseconds (Get-NextDelay $failures)
}
