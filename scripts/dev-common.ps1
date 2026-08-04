# Shared helpers for the DataForge dev launchers (start.ps1, stop.ps1,
# start-backend.ps1, start-frontend.ps1). Dot-source it:
#
#   . (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as
# ANSI, so non-ASCII characters would be mangled.

$DevApiPort = 8080
$DevUiPort = 8081
$DevApiUrl = 'http://127.0.0.1:8080'
$DevUiUrl = 'http://127.0.0.1:8081'
$DevHealthUrl = 'http://127.0.0.1:8080/api/health'

function Get-DevPaths {
    <#
    .SYNOPSIS
      Project paths, derived from this file's location rather than the caller's
      working directory.
    #>
    $root = Split-Path -Parent $PSScriptRoot
    [pscustomobject]@{
        Root      = $root
        Backend   = Join-Path $root 'backend'
        Frontend  = Join-Path $root 'frontend'
        Scripts   = Join-Path $root 'scripts'
        VenvPy    = Join-Path $root 'backend\.venv\Scripts\python.exe'
        DevServer = Join-Path $root 'scripts\dev_server.py'
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

function Test-DevPrerequisites {
    <#
    .SYNOPSIS
      Verifies the venv and node_modules exist. Prints what to run and returns
      $false when something is missing.
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
      force-killing an unrelated process because it happens to sit on 8080 is a
      far worse outcome than refusing to start.

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
