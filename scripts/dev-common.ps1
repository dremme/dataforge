# Shared helpers for the DataForge launchers (dev.ps1, start.ps1, stop.ps1,
# start-backend.ps1, start-frontend.ps1). Dot-source it:
#
#   . (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as
# ANSI, so non-ASCII characters would be mangled.

function Get-DevEnvMap {
    <#
    .SYNOPSIS
      KEY=VALUE pairs from the project .env, mirroring backend/env_file.py.

    .DESCRIPTION
      Same candidate order as env_file.py - project root first, then backend\ -
      and the first existing file wins. Nothing here touches the process
      environment; these are fallbacks that a real environment variable
      overrides, the way python-dotenv loads with override=$false.

      The root comes from this file's own location rather than Get-DevPaths: a
      dot-sourced script runs top to bottom, so nothing defined below is
      callable yet.
    #>
    $root = Split-Path -Parent $PSScriptRoot
    $map = @{}

    foreach ($candidate in @((Join-Path $root '.env'), (Join-Path $root 'backend\.env'))) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }

        # -ErrorAction beats the callers' $ErrorActionPreference = 'Stop', so an
        # unreadable .env degrades to defaults instead of killing the launcher.
        foreach ($line in (Get-Content -LiteralPath $candidate -ErrorAction SilentlyContinue)) {
            $text = $line.Trim()
            if ($text.Length -eq 0 -or $text.StartsWith('#')) { continue }
            if ($text.StartsWith('export ')) { $text = $text.Substring(7).Trim() }

            # The operator form, not .Split('=', 2): .NET Framework has no
            # String.Split(char, int) overload.
            $parts = $text -split '=', 2
            if ($parts.Count -ne 2) { continue }

            $key = $parts[0].Trim()
            if ($key.Length -eq 0) { continue }

            $value = $parts[1].Trim()
            if ($value.Length -ge 2) {
                $quote = [string]$value[0]
                if (($quote -eq '"' -or $quote -eq "'") -and ([string]$value[$value.Length - 1] -eq $quote)) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            $map[$key] = $value
        }
        break
    }

    return $map
}

function Get-DevPort {
    <#
    .SYNOPSIS
      A port setting, with a real environment variable winning over the .env file.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][hashtable]$EnvMap,
        [Parameter(Mandatory = $true)][int]$Default
    )

    # $null -eq distinguishes unset from empty, so an explicitly blank OS var
    # still wins and then falls back - same as _env_port in dev_server.py.
    $raw = [System.Environment]::GetEnvironmentVariable($Name)
    if ($null -eq $raw -and $EnvMap.ContainsKey($Name)) { $raw = $EnvMap[$Name] }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }

    $port = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Write-Host ('[WARN] Ignoring {0}={1}: not a port number. Using {2}.' -f $Name, $raw, $Default) -ForegroundColor Yellow
        return $Default
    }
    return $port
}

# Read once on dot-source. These land in the caller's scope, which is what the
# launchers use. frontend/vite.config.ts and backend/server_settings.py resolve
# the same two variables from the same .env.
$DevEnvMap = Get-DevEnvMap
$DevApiPort = Get-DevPort -Name 'DATAFORGE_API_PORT' -EnvMap $DevEnvMap -Default 8080
$DevUiPort = Get-DevPort -Name 'DATAFORGE_UI_PORT' -EnvMap $DevEnvMap -Default 8081
$DevApiUrl = 'http://127.0.0.1:{0}' -f $DevApiPort
$DevUiUrl = 'http://127.0.0.1:{0}' -f $DevUiPort
$DevHealthUrl = '{0}/api/health' -f $DevApiUrl
# Production serves both halves on the UI port, so its health check lives there.
$DevAppHealthUrl = '{0}/api/health' -f $DevUiUrl

function Get-DevPaths {
    <#
    .SYNOPSIS
      Project paths, derived from this file's location rather than the caller's
      working directory.
    #>
    $root = Split-Path -Parent $PSScriptRoot
    [pscustomobject]@{
        Root       = $root
        Backend    = Join-Path $root 'backend'
        Frontend   = Join-Path $root 'frontend'
        Scripts    = Join-Path $root 'scripts'
        Dist       = Join-Path $root 'frontend\dist'
        VenvPy     = Join-Path $root 'backend\.venv\Scripts\python.exe'
        DevServer  = Join-Path $root 'scripts\dev_server.py'
        ProdServer = Join-Path $root 'scripts\prod_server.py'
    }
}

function Get-NpmCommand {
    <#
    .SYNOPSIS
      The portable npm from setup.bat when present, otherwise whatever is on PATH.
    #>
    $local = Join-Path (Get-DevPaths).Root '.node\npm.cmd'
    if (Test-Path $local) { return $local }
    return 'npm.cmd'
}

# Generated from backend/schemas.py and backend/constants.py, gitignored, and two of
# them carry real values - so the frontend neither starts nor builds without them.
$DevGeneratedSources = @('types.ts', 'constants.ts', 'wireGuards.ts')

function Test-DevPrerequisites {
    <#
    .SYNOPSIS
      Verifies the venv, node_modules, and generated frontend sources exist. Prints
      what to run and returns $false when something is missing.
    #>
    param(
        [switch]$SkipBackend,
        [switch]$SkipFrontend
    )

    $paths = Get-DevPaths
    $ok = $true

    if (-not $SkipBackend -and -not (Test-Path $paths.VenvPy)) {
        Write-Host '[ERROR] Python venv not found at backend\.venv.' -ForegroundColor Red
        Write-Host '        Run setup.bat from the project root, or:'
        Write-Host '          python -m venv backend\.venv'
        Write-Host '          backend\.venv\Scripts\pip install -r backend\requirements.txt -r backend\requirements-dev.txt'
        $ok = $false
    }

    if (-not $SkipFrontend -and -not (Test-Path (Join-Path $paths.Frontend 'node_modules'))) {
        Write-Host '[ERROR] Frontend dependencies not installed.' -ForegroundColor Red
        Write-Host '        Run setup.bat from the project root, or:'
        Write-Host '          cd frontend'
        Write-Host '          npm install'
        $ok = $false
    }

    if (-not $SkipFrontend) {
        $missing = @($DevGeneratedSources | Where-Object {
                -not (Test-Path (Join-Path $paths.Frontend ('src\shared\{0}' -f $_)))
            })
        if ($missing.Count -gt 0) {
            Write-Host ('[ERROR] Generated frontend sources missing: {0}.' -f ($missing -join ', ')) -ForegroundColor Red
            Write-Host '        Run setup.bat from the project root, or:'
            Write-Host '          backend\.venv\Scripts\python scripts\generate_types.py'
            $ok = $false
        }
    }

    return $ok
}

function Test-DependencyDrift {
    <#
    .SYNOPSIS
      Warns when a git pull brought in dependencies that were never installed.
      Advisory only - it never blocks startup.
    #>
    param(
        [switch]$SkipBackend,
        [switch]$SkipFrontend
    )

    $paths = Get-DevPaths
    $stale = $false

    if (-not $SkipFrontend) {
        $lock = Join-Path $paths.Frontend 'package-lock.json'
        # npm rewrites this copy on every install, so it dates the install itself.
        $installed = Join-Path $paths.Frontend 'node_modules\.package-lock.json'
        if ((Test-Path $lock) -and (Test-Path $installed)) {
            if ((Get-Item $lock).LastWriteTimeUtc -gt (Get-Item $installed).LastWriteTimeUtc) {
                Write-Host '[WARN] frontend/package-lock.json is newer than the installed node_modules.' -ForegroundColor Yellow
                Write-Host '       Run setup.bat if the UI fails to build.'
                $stale = $true
            }
        }
    }

    if (-not $SkipBackend) {
        # Written by setup.bat after a successful pip install. Absent on installs
        # that predate it, in which case there is nothing to compare against.
        $stamp = Join-Path $paths.Backend '.venv\.dataforge-deps-stamp'
        if (Test-Path $stamp) {
            $stampTime = (Get-Item $stamp).LastWriteTimeUtc
            foreach ($name in @('requirements.txt', 'requirements-dev.txt')) {
                $req = Join-Path $paths.Backend $name
                if ((Test-Path $req) -and ((Get-Item $req).LastWriteTimeUtc -gt $stampTime)) {
                    Write-Host ('[WARN] backend/{0} is newer than the last dependency install.' -f $name) -ForegroundColor Yellow
                    Write-Host '       Run setup.bat if the API fails to import something.'
                    $stale = $true
                }
            }
        }
    }

    return $stale
}

# Written only after a build that actually succeeded, the way setup.bat dates its
# pip install. Keying freshness off dist\index.html instead would trust a half
# finished or hand-made dist.
$DevBuildStampName = '.dataforge-build-stamp'

# Everything vite build reads. src\ is recursive and covers the generated
# src\shared files, so regenerating the API contract also marks the build stale.
$DevBuildInputDirs = @('src', 'public')
$DevBuildInputFiles = @('index.html', 'package.json', 'package-lock.json', 'vite.config.ts')
$DevBuildInputPatterns = @('tsconfig*.json')

function Get-FrontendSourceStamp {
    <#
    .SYNOPSIS
      The newest write time across every input to a frontend build, or $null when
      none of them exist.
    #>
    $paths = Get-DevPaths
    $newest = $null

    $items = @()
    foreach ($dir in $DevBuildInputDirs) {
        $full = Join-Path $paths.Frontend $dir
        if (Test-Path $full) { $items += @(Get-ChildItem -LiteralPath $full -Recurse -File -ErrorAction SilentlyContinue) }
    }
    foreach ($file in $DevBuildInputFiles) {
        $full = Join-Path $paths.Frontend $file
        if (Test-Path -LiteralPath $full -PathType Leaf) { $items += @(Get-Item -LiteralPath $full) }
    }
    foreach ($pattern in $DevBuildInputPatterns) {
        $items += @(Get-ChildItem -Path (Join-Path $paths.Frontend $pattern) -File -ErrorAction SilentlyContinue)
    }

    foreach ($item in $items) {
        if ($null -eq $newest -or $item.LastWriteTimeUtc -gt $newest) { $newest = $item.LastWriteTimeUtc }
    }
    return $newest
}

function Test-DistFresh {
    <#
    .SYNOPSIS
      Whether frontend\dist was built after the last source change.

    .DESCRIPTION
      A tie counts as stale: Windows write times are coarse enough that a source
      saved in the same tick as the stamp would otherwise be missed, and rebuilding
      once too often is the cheaper mistake.
    #>
    $paths = Get-DevPaths
    $stamp = Join-Path $paths.Dist $DevBuildStampName
    if (-not (Test-Path -LiteralPath $stamp -PathType Leaf)) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Dist 'index.html') -PathType Leaf)) { return $false }

    $newestSource = Get-FrontendSourceStamp
    if ($null -eq $newestSource) { return $true }

    return (Get-Item -LiteralPath $stamp).LastWriteTimeUtc -gt $newestSource
}

function Invoke-FrontendBuild {
    <#
    .SYNOPSIS
      Runs 'npm run build' in frontend\ and stamps the result. Returns $false when
      the build failed.

    .DESCRIPTION
      Runs in the calling window rather than a spawned console: 'npm run build' is
      typecheck plus vite build, so its failures are compiler errors the caller has
      to read before deciding to abort.
    #>
    $paths = Get-DevPaths
    $previous = Get-Location

    Write-Host 'Building the frontend (npm run build)...'
    Write-Host ''
    try {
        Set-Location -LiteralPath $paths.Frontend
        # Out-Host, not a bare call: anything npm writes to stdout would otherwise
        # join this function's return value and make even a failed build truthy.
        & (Get-NpmCommand) run build | Out-Host
        $exitCode = $LASTEXITCODE
    } catch {
        Write-Host ('[ERROR] Could not run npm: {0}' -f $_.Exception.Message) -ForegroundColor Red
        return $false
    } finally {
        Set-Location -LiteralPath $previous
    }

    Write-Host ''
    if ($exitCode -ne 0) {
        Write-Host '[ERROR] Frontend build failed. Fix the errors above and try again.' -ForegroundColor Red
        return $false
    }

    $stamp = Join-Path $paths.Dist $DevBuildStampName
    Set-Content -LiteralPath $stamp -Value ((Get-Date).ToString('o')) -Encoding ASCII
    Write-Host 'Frontend build complete.' -ForegroundColor Green
    return $true
}

function Get-DevPortListener {
    <#
    .SYNOPSIS
      Processes listening on a port, as Process objects. Empty when the port is free.
    #>
    param([Parameter(Mandatory = $true)][int]$Port)

    $connections = @()
    try {
        $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    } catch {
        # No listener, or Get-NetTCPConnection is unavailable on this host.
        return @()
    }

    $processes = @()
    foreach ($owner in ($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
        if (-not $owner -or $owner -eq 0) { continue }
        try {
            $processes += Get-Process -Id $owner -ErrorAction Stop
        } catch {
            # Exited between the query and the lookup, or not ours to inspect.
        }
    }
    return $processes
}

function Stop-DevTree {
    <#
    .SYNOPSIS
      Kills a process and everything below it.

    .DESCRIPTION
      /T is the point: a dev console is cmd -> python -> uvicorn reload child, or
      cmd -> npm -> node. Stopping the console PID alone orphans the server that
      is actually holding the port.
    #>
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    if ($ProcessId -le 0) { return }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
        # Already gone.
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Clear-DevPort {
    <#
    .SYNOPSIS
      Frees a dev port held by a leftover python/node process.

    .DESCRIPTION
      Only our own runtimes are killed. Anything else gets named and left alone -
      force-killing an unrelated process because it happens to sit on a dev port
      is a far worse outcome than refusing to start.

      Returns $true when the port is free afterwards.
    #>
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [string]$Label
    )

    $killable = @('python', 'pythonw', 'node')
    $listeners = @(Get-DevPortListener -Port $Port)
    if ($listeners.Count -eq 0) { return $true }

    $foreign = @($listeners | Where-Object { $killable -notcontains $_.ProcessName })
    if ($foreign.Count -gt 0) {
        foreach ($proc in $foreign) {
            Write-Host ('[ERROR] Port {0} is held by {1} (PID {2}).' -f $Port, $proc.ProcessName, $proc.Id) -ForegroundColor Red
        }
        Write-Host '        That is not a leftover dev server, so it was left running.'
        Write-Host '        Free the port yourself and try again.'
        return $false
    }

    foreach ($proc in $listeners) {
        $what = $Label
        if (-not $what) { $what = 'dev server' }
        Write-Host ('  Port {0}: stopping leftover {1} (PID {2}) from a previous {3} run...' -f $Port, $proc.ProcessName, $proc.Id, $what) -ForegroundColor DarkYellow
        Stop-DevTree -ProcessId $proc.Id
    }

    # Windows releases the socket lazily, and Vite's strictPort makes a
    # half-released port just as fatal as an occupied one.
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
        if ((Get-DevPortListener -Port $Port).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    }

    Write-Host ('[ERROR] Port {0} is still in use after stopping the old process.' -f $Port) -ForegroundColor Red
    return $false
}

function Wait-HttpReady {
    <#
    .SYNOPSIS
      Polls a URL until it answers 200. Returns $false on timeout, or as soon as
      the watched process exits.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSec = 40,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) { return $false }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) { return $true }
        } catch {
            # Not serving yet.
        }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Wait-TcpReady {
    <#
    .SYNOPSIS
      Polls until a TCP port accepts a connection. Used for Vite, which has no
      health endpoint of its own.
    #>
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [string]$ComputerName = '127.0.0.1',
        [int]$TimeoutSec = 60,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) { return $false }

        # Test-NetConnection is far too slow to poll with.
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $async = $client.BeginConnect($ComputerName, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(500)) {
                $client.EndConnect($async)
                return $true
            }
        } catch {
            # Refused - not listening yet.
        } finally {
            $client.Close()
        }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

function Start-DevConsole {
    <#
    .SYNOPSIS
      Opens a titled cmd window running one server, and returns its Process.

    .DESCRIPTION
      cmd /k keeps the window open after Ctrl+C so the last lines of a crash stay
      readable. The returned PID is the console, not the server - stop it with
      Stop-DevTree.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string[]]$Banner = @(),
        [Parameter(Mandatory = $true)][string]$Command
    )

    $parts = @("title $Title", "cd /d `"$WorkingDirectory`"")
    foreach ($line in $Banner) { $parts += "echo $line" }
    $parts += 'echo.'
    $parts += $Command

    return Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', ($parts -join ' && ') -PassThru
}
