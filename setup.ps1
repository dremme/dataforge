<#
.SYNOPSIS
  Downloads a portable Python and Node into this clone and installs every dependency.

.DESCRIPTION
  No global Python or Node/npm is required. Python comes from the nuget.org zip
  (the documented CI/layout distribution - not the GUI installer, which needs UAC
  or a visible wizard). Node comes from the official Windows zip. Both land in
  .python\ and .node\, then a venv, pip, npm, and the generated frontend types.

  Use this directly, or double-click setup.bat for the same behavior.

.EXAMPLE
  .\setup.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 defaults to TLS 1.0. python.org, nuget.org and nodejs.org
# reject that, so a machine with nothing else installed cannot even download.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$Root = $PSScriptRoot
$PyVer = (Get-Content -LiteralPath (Join-Path $Root '.python-version') -Raw).Trim()
$NodeVer = '24.21.0'
$PyDir = Join-Path $Root '.python'
$NodeDir = Join-Path $Root '.node'
$PyExe = Join-Path $PyDir 'python.exe'
$NpmCmd = Join-Path $NodeDir 'npm.cmd'
$PyStampFile = Join-Path $PyDir 'setup-python-version.txt'
$NodeStampFile = Join-Path $NodeDir 'setup-node-version.txt'
$VenvDir = Join-Path $Root 'backend\.venv'
$VenvPy = Join-Path $VenvDir 'Scripts\python.exe'
$PyVersionCheck = Join-Path $Root 'scripts\py_version.py'

$Host.UI.RawUI.WindowTitle = 'DataForge Setup'

function Exit-Setup {
    param([int]$Code = 1)
    Write-Host ''
    exit $Code
}

function Get-SetupArch {
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        return [pscustomobject]@{
            PythonPackage = 'pythonarm64'
            NodeBuild     = 'win-arm64'
        }
    }
    return [pscustomobject]@{
        PythonPackage = 'python'
        NodeBuild     = 'win-x64'
    }
}

function Test-StampMatches {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][string]$Expected
    )
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    $got = ((Get-Content -LiteralPath $File -TotalCount 1 -ErrorAction SilentlyContinue) + '')
    return $got.Trim() -eq $Expected
}

function Test-PythonVersion {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [switch]$Exact
    )
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    try {
        if ($Exact) {
            $actual = (& $File -c 'import platform; print(platform.python_version())' 2>$null | Out-String).Trim()
            return $LASTEXITCODE -eq 0 -and $actual -eq $PyVer
        }
        & $File $PyVersionCheck 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-RemoteFile {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile
    )
    if (Test-Path -LiteralPath $OutFile) {
        Remove-Item -LiteralPath $OutFile -Force
    }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & curl.exe --fail --location --silent --show-error --output $OutFile $Uri
        if ($LASTEXITCODE -ne 0) {
            throw "Download failed ($LASTEXITCODE): $Uri"
        }
    } else {
        Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
    }

    if (-not (Test-Path -LiteralPath $OutFile -PathType Leaf)) {
        throw "Download left no file: $Uri"
    }
    $length = (Get-Item -LiteralPath $OutFile).Length
    if ($length -lt 1MB) {
        throw "Download was too small to be a runtime ($length bytes): $Uri"
    }
}

function Install-PortablePython {
    param([Parameter(Mandatory = $true)]$Arch)

    $uri = 'https://www.nuget.org/api/v2/package/{0}/{1}' -f $Arch.PythonPackage, $PyVer
    $zip = Join-Path $env:TEMP ('dataforge-python-{0}.zip' -f $PyVer)
    $extract = Join-Path $env:TEMP ('dataforge-python-{0}' -f $PyVer)

    Write-Host ('Downloading Python {0} ({1})...' -f $PyVer, $Arch.PythonPackage)
    Get-RemoteFile -Uri $uri -OutFile $zip

    if (Test-Path -LiteralPath $extract) {
        Remove-Item -LiteralPath $extract -Recurse -Force
    }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

    $found = Get-ChildItem -LiteralPath $extract -Filter 'python.exe' -Recurse -File |
        Where-Object { $_.Directory.Name -eq 'tools' } |
        Select-Object -First 1
    if (-not $found) {
        throw 'The Python package did not contain tools\python.exe.'
    }

    if (Test-Path -LiteralPath $PyDir) {
        Remove-Item -LiteralPath $PyDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $PyDir | Out-Null
    Get-ChildItem -LiteralPath $found.Directory.FullName | Move-Item -Destination $PyDir -Force
    Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path -LiteralPath $PyExe -PathType Leaf)) {
        throw "Python extract failed: $PyExe is missing."
    }

    Set-Content -LiteralPath $PyStampFile -Value $PyVer -Encoding ASCII
    Write-Host ('Python {0} installed to .python\' -f $PyVer)
}

function Install-PortableNode {
    param([Parameter(Mandatory = $true)]$Arch)

    $folder = 'node-v{0}-{1}' -f $NodeVer, $Arch.NodeBuild
    $uri = 'https://nodejs.org/dist/v{0}/{1}.zip' -f $NodeVer, $folder
    $zip = Join-Path $env:TEMP ('dataforge-{0}.zip' -f $folder)

    Write-Host ('Downloading Node.js {0} ({1})...' -f $NodeVer, $Arch.NodeBuild)
    Get-RemoteFile -Uri $uri -OutFile $zip

    if (Test-Path -LiteralPath $NodeDir) {
        Remove-Item -LiteralPath $NodeDir -Recurse -Force
    }
    Expand-Archive -Path $zip -DestinationPath $NodeDir -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

    $nested = Join-Path $NodeDir $folder
    if (Test-Path -LiteralPath $nested) {
        Get-ChildItem -LiteralPath $nested | Move-Item -Destination $NodeDir -Force
        Remove-Item -LiteralPath $nested -Recurse -Force
    }

    if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
        throw "Node extract failed: $NpmCmd is missing."
    }

    Set-Content -LiteralPath $NodeStampFile -Value $NodeVer -Encoding ASCII
    Write-Host ('Node.js {0} installed to .node\' -f $NodeVer)
}

Write-Host '================================================'
Write-Host '  DataForge Windows Self-Contained Setup'
Write-Host ('  Python {0} -> .python\   Node {1} -> .node\' -f $PyVer, $NodeVer)
Write-Host '  No global Python or Node/npm required'
Write-Host '================================================'
Write-Host ''

try {
    $arch = Get-SetupArch
    $pythonReplaced = $false

    if (Test-PythonVersion -File $PyExe -Exact) {
        Set-Content -LiteralPath $PyStampFile -Value $PyVer -Encoding ASCII
        Write-Host ('Python {0} already present at .python\' -f $PyVer)
    } else {
        Install-PortablePython -Arch $arch
        $pythonReplaced = $true
    }

    $nodeReady = (Test-Path -LiteralPath $NpmCmd -PathType Leaf) -and (Test-StampMatches -File $NodeStampFile -Expected $NodeVer)
    if ($nodeReady) {
        Write-Host ('Node.js {0} already present at .node\' -f $NodeVer)
    } else {
        Install-PortableNode -Arch $arch
    }

    $env:PATH = "$PyDir;$NodeDir;$env:PATH"

    if ((Test-Path -LiteralPath $VenvDir) -and ($pythonReplaced -or -not (Test-PythonVersion -File $VenvPy))) {
        Write-Host ('Recreating backend\.venv with Python {0}...' -f $PyVer)
        $resolvedVenv = (Resolve-Path -LiteralPath $VenvDir).ProviderPath
        $workspacePrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedVenv.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The backend venv is outside the project folder.'
        }
        Remove-Item -LiteralPath $resolvedVenv -Recurse -Force
    }

    if (-not (Test-Path -LiteralPath $VenvPy -PathType Leaf)) {
        Write-Host 'Creating backend\.venv with the downloaded Python...'
        & $PyExe -m ensurepip --upgrade | Out-Host
        & $PyExe -m venv $VenvDir
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPy -PathType Leaf)) {
            throw 'Failed to create backend\.venv.'
        }
    }
    if (-not (Test-PythonVersion -File $VenvPy)) { throw 'The backend venv must use Python 3.13.x.' }

    Write-Host 'Upgrading pip and installing backend dependencies...'
    & $VenvPy -m pip install --upgrade pip | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'pip upgrade failed.' }
    & $VenvPy -m pip install -r (Join-Path $Root 'backend\requirements.txt') -r (Join-Path $Root 'backend\requirements-dev.txt') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    Write-Host 'Verifying FFmpeg 7.1.x...'
    & $VenvPy (Join-Path $Root 'scripts\check_ffmpeg.py') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg 7.1.x is required. Install a matching binary on PATH and run setup again.' }
    Set-Content -LiteralPath (Join-Path $VenvDir '.dataforge-deps-stamp') -Value ((Get-Date).ToString('o')) -Encoding ASCII

    Write-Host ''
    $FrontendDir = Join-Path $Root 'frontend'
    Push-Location -LiteralPath $FrontendDir
    try {
        if (Test-Path (Join-Path $FrontendDir 'package-lock.json')) {
            Write-Host 'Installing frontend dependencies (npm ci)...'
            & $NpmCmd ci | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'Frontend npm ci failed.' }
        } else {
            Write-Host 'Installing frontend dependencies (npm install)...'
            & $NpmCmd install | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'Frontend npm install failed.' }
        }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host 'Generating the frontend API types...'
    & $VenvPy (Join-Path $Root 'scripts\generate_types.py') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Frontend type generation failed.' }
} catch {
    Write-Host ''
    Write-Host ('[ERROR] {0}' -f $_.Exception.Message) -ForegroundColor Red
    Exit-Setup
}

Write-Host ''
Write-Host '================================================'
Write-Host '  Setup complete.'
Write-Host '  Run start.bat to launch the app, or dev.bat to develop it.'
Write-Host '  Python, Node, the venv and npm deps are all local to this folder.'
Write-Host '================================================'
exit 0
