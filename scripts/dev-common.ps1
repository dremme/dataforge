# Shared helpers for the DataForge launchers (dev.ps1, start.ps1, stop.ps1,
# start-backend.ps1, start-frontend.ps1). Dot-source it:
#
#   . (Join-Path $PSScriptRoot 'scripts\dev-common.ps1')
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as
# ANSI, so non-ASCII characters would be mangled.
#
# The Unix twin is scripts/dev-common.sh. Port defaults, .env precedence, the
# build- and dependency-stamp filenames, and the rule that only leftover
# python/node processes are ever killed are deliberately identical there.
# Change one and change the other. Process supervision is the one part that is
# meant to differ - see the note above Register-DevExitGuard.

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
$DevApiPort = Get-DevPort -Name 'DATAFORGE_API_PORT' -EnvMap $DevEnvMap -Default 18080
$DevUiPort = Get-DevPort -Name 'DATAFORGE_UI_PORT' -EnvMap $DevEnvMap -Default 18081
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

    .DESCRIPTION
      Also puts .node on PATH so npm lifecycle scripts that spawn `node` by name
      find the portable copy. A fresh clone has no global Node.
    #>
    $nodeDir = Join-Path (Get-DevPaths).Root '.node'
    $local = Join-Path $nodeDir 'npm.cmd'
    if (Test-Path $local) {
        $currentPath = [string]$env:PATH
        if (-not $currentPath.StartsWith("$nodeDir;", [System.StringComparison]::OrdinalIgnoreCase)) {
            $env:PATH = "$nodeDir;$currentPath"
        }
        return $local
    }
    return 'npm.cmd'
}

# Generated from backend/schemas.py and backend/constants.py, gitignored, and two of
# them carry real values - so the frontend neither starts nor builds without them.
$DevGeneratedSources = @('types.ts', 'constants.ts', 'wireGuards.ts')

function Update-DevGeneratedSources {
    <#
    .SYNOPSIS
      Regenerates frontend\src\shared\{types,constants,wireGuards}.ts from
      backend\schemas.py. Returns $false only when the generator ran and failed.

    .DESCRIPTION
      Always regenerates rather than comparing timestamps. The three files are
      gitignored, so git leaves them untouched across a branch switch and they keep
      the other branch's shape with a perfectly plausible mtime - there is no
      freshness test that would catch it, which is why Test-DevPrerequisites checking
      only that they exist was never enough. The generator costs well under a second.

      A missing venv is not this function's error to report: Test-DevPrerequisites
      names it alongside the generated files it could not create, and points at
      setup.bat. Nor is a failed generation fatal - the previous files are still on
      disk, and a schemas.py broken enough to stop the generator stops the backend
      too, which the readiness wait reports far more clearly.
    #>
    $paths = Get-DevPaths
    if (-not (Test-Path $paths.VenvPy)) { return $true }

    Write-Host 'Generating the frontend API types...' -NoNewline
    try {
        # The generator rewrites a file only when its content actually changed, so an
        # unchanged shape leaves every mtime alone and Test-DistFresh still reports a
        # dist built before this launch as fresh.
        & $paths.VenvPy (Join-Path $paths.Scripts 'generate_types.py') | Out-Null
        $exitCode = $LASTEXITCODE
    } catch {
        Write-Host ' FAILED.' -ForegroundColor Red
        Write-Host ('[WARN] Could not run the generator: {0}' -f $_.Exception.Message) -ForegroundColor Yellow
        return $false
    }

    if ($exitCode -ne 0) {
        Write-Host ' FAILED.' -ForegroundColor Red
        Write-Host '[WARN] The frontend API types were left as they were. The UI may not match the API.' -ForegroundColor Yellow
        return $false
    }

    Write-Host ' done.' -ForegroundColor Green
    return $true
}


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
        Write-Host '          npm ci'
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

function Sync-FrontendDependencies {
    $paths = Get-DevPaths
    $lock = Join-Path $paths.Frontend 'package-lock.json'
    $installed = Join-Path $paths.Frontend 'node_modules\.package-lock.json'
    if (-not (Test-Path $lock)) { return $true }
    if ((Test-Path $installed) -and ((Get-Item $lock).LastWriteTimeUtc -le (Get-Item $installed).LastWriteTimeUtc)) {
        return $true
    }

    Write-Host 'Syncing frontend dependencies from package-lock.json (npm ci)...'
    $previous = Get-Location
    try {
        Set-Location -LiteralPath $paths.Frontend
        & (Get-NpmCommand) ci | Out-Host
        return $LASTEXITCODE -eq 0
    } catch {
        Write-Host ('[ERROR] Could not run npm ci: {0}' -f $_.Exception.Message) -ForegroundColor Red
        return $false
    } finally {
        Set-Location -LiteralPath $previous
    }
}

function Test-BackendDependencyDrift {
    <#
    .SYNOPSIS
      Warns when a git pull brought in backend dependencies that were never
      installed. Advisory only - it never blocks startup.

    .DESCRIPTION
      There is no frontend arm. Sync-FrontendDependencies reads the same lockfile
      mtimes and reinstalls from them, so by the time a launcher gets here the
      frontend has either been resynced or the launcher has already exited. Only
      pip has no equivalent, since nothing reinstalls it automatically.
    #>
    $paths = Get-DevPaths
    $stale = $false

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
        # npm.cmd finds node.exe next to itself, but lifecycle scripts spawn `node`
        # from PATH. A machine with only the portable copy from setup.bat needs
        # .node at the front or the build dies looking for a global install.
        $nodeDir = Join-Path $paths.Root '.node'
        if (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe') -PathType Leaf) {
            $env:PATH = "$nodeDir;$env:PATH"
        }
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

function Register-DevExitGuard {
    <#
    .SYNOPSIS
      Makes closing the launcher window stop the spawned server consoles.

    .DESCRIPTION
      The launchers clean up in a finally block, which Windows PowerShell never runs
      for CTRL_CLOSE_EVENT - and the servers are independent cmd windows rather than
      children, so they outlive the launcher. Closing a launcher with the X button
      therefore used to orphan a python and a node holding the dev ports.

      This installs a Win32 console control handler that kills the recorded PIDs
      with the same taskkill /T tree walk Stop-DevTree uses. Call it again as more
      servers start; the new list replaces the old one.

      The paths that deliberately leave servers running - -Detach, and the readiness
      failure that keeps the error on screen - must call Unregister-DevExitGuard
      before they exit.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [int[]]$ProcessId
    )

    if (-not ('DevConsoleGuard' -as [type])) {
        try {
            # Compiled on first use only, so stop.ps1 - which dot-sources this file
            # but never spawns anything - does not pay the compile.
            Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class DevConsoleGuard
{
    public delegate bool CtrlHandler(uint ctrlType);

    // Static so the GC cannot collect the delegate while Windows still holds the
    // native function pointer. A collected callback would crash the launcher at
    // the exact moment it is being asked to clean up.
    private static CtrlHandler _handler;
    private static int[] _pids = new int[0];

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleCtrlHandler(CtrlHandler handler, bool add);

    public static void Arm(int[] pids)
    {
        _pids = (pids == null) ? new int[0] : pids;
        if (_handler == null)
        {
            _handler = new CtrlHandler(OnCtrl);
            SetConsoleCtrlHandler(_handler, true);
        }
    }

    public static void Disarm()
    {
        _pids = new int[0];
    }

    // Every control type is treated alike. Ctrl+C during the readiness wait kills
    // this process just as dead as the X button does, and a duplicate taskkill on
    // an already-stopped tree is harmless.
    private static bool OnCtrl(uint ctrlType)
    {
        // Windows allows roughly five seconds after a close event before killing
        // this process, so the handler does nothing here but the kills. Calling
        // back into PowerShell from this thread is not safe.
        int[] pids = _pids;
        foreach (int pid in pids)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo("taskkill.exe", "/PID " + pid + " /T /F");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                Process killer = Process.Start(info);
                if (killer != null) { killer.WaitForExit(3000); }
            }
            catch
            {
                // Already gone, or not ours to kill.
            }
        }

        // false: let the default handler run, so the launcher still exits.
        return false;
    }
}
'@
        } catch {
            Write-Host '[WARN] Could not install the window-close guard.' -ForegroundColor Yellow
            Write-Host '       Closing this window with X will leave the servers running; use stop.bat if that happens.'
            return
        }
    }

    [DevConsoleGuard]::Arm([int[]]@($ProcessId | Where-Object { $_ -gt 0 }))
}

function Unregister-DevExitGuard {
    <#
    .SYNOPSIS
      Stops the window-close guard from killing anything.

    .DESCRIPTION
      For the exits that intentionally leave servers running. The handler itself
      stays registered - with an empty list it has nothing to do.
    #>
    if ('DevConsoleGuard' -as [type]) { [DevConsoleGuard]::Disarm() }
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
