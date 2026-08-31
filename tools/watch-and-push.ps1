[CmdletBinding()]
param(
    [string]$Repository,
    [switch]$Once,
    [int]$QuietSeconds = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if ([string]::IsNullOrWhiteSpace($Repository)) {
    $Repository = Split-Path -Parent $PSScriptRoot
}

$script:RepoPath = [System.IO.Path]::GetFullPath($Repository)
$script:GitCommand = (Get-Command git.exe -ErrorAction Stop).Source
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexGitAutoPush\cg'
$logPath = Join-Path $stateRoot 'watch.log'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

function Write-Log {
    param([string]$Message)

    $line = '{0} {1}' -f ([DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz')), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $script:GitCommand -C $script:RepoPath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    foreach ($line in $output) {
        Write-Log ('git: {0}' -f $line)
    }

    if (($exitCode -ne 0) -and (-not $AllowFailure)) {
        throw 'git {0} failed with exit code {1}.' -f ($Arguments -join ' '), $exitCode
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Get-ChangedPaths {
    $result = Invoke-Git -Arguments @('status', '--porcelain=v1', '--untracked-files=all')
    $paths = New-Object System.Collections.Generic.List[string]

    foreach ($lineObject in $result.Output) {
        $line = [string]$lineObject
        if ($line.Length -lt 4) {
            continue
        }

        $path = $line.Substring(3)
        $renameSeparator = $path.LastIndexOf(' -> ')
        if ($renameSeparator -ge 0) {
            $path = $path.Substring($renameSeparator + 4)
        }

        $paths.Add($path.Trim('"').Replace('\', '/'))
    }

    return $paths.ToArray()
}

function Test-ProtectedPath {
    param([string]$Path)

    $patterns = @(
        '(^|/)\.env($|\.)',
        '\.(pem|key|p12|pfx|jks|keystore)$',
        '(^|/)(id_rsa|id_ed25519)$',
        '(^|/)[^/]*(credential|secret|service[-_]?account)[^/]*\.json$'
    )

    foreach ($pattern in $patterns) {
        if ($Path -match $pattern) {
            return $true
        }
    }

    return $false
}

function Test-OversizedPath {
    param([string]$Path)

    $fullPath = Join-Path $script:RepoPath ($Path.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        return $false
    }

    return (Get-Item -LiteralPath $fullPath).Length -ge 90MB
}

function Push-CurrentBranch {
    $branchResult = Invoke-Git -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
    $branch = ([string]$branchResult.Output[0]).Trim()
    if ($branch -eq 'HEAD') {
        throw 'Automatic push is disabled in detached HEAD state.'
    }

    $upstreamResult = Invoke-Git -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -AllowFailure
    if ($upstreamResult.ExitCode -ne 0) {
        Invoke-Git -Arguments @('push', '--set-upstream', 'origin', $branch) | Out-Null
        return
    }

    $aheadResult = Invoke-Git -Arguments @('rev-list', '--count', '@{u}..HEAD')
    $aheadCount = [int](([string]$aheadResult.Output[0]).Trim())
    if ($aheadCount -eq 0) {
        return
    }

    $pullResult = Invoke-Git -Arguments @('pull', '--rebase') -AllowFailure
    if ($pullResult.ExitCode -ne 0) {
        Invoke-Git -Arguments @('rebase', '--abort') -AllowFailure | Out-Null
        throw 'The remote changes could not be rebased automatically. The local commit was preserved.'
    }

    Invoke-Git -Arguments @('push') | Out-Null
    Write-Log ('Push to origin/{0} completed.' -f $branch)
}

function Invoke-Sync {
    $changedPaths = @(Get-ChangedPaths)
    if ($changedPaths.Count -gt 0) {
        $protectedPaths = @($changedPaths | Where-Object { Test-ProtectedPath -Path $_ })
        if ($protectedPaths.Count -gt 0) {
            Write-Log ('Skipped automatic commit because protected files changed: {0}' -f ($protectedPaths -join ', '))
            return
        }

        $oversizedPaths = @($changedPaths | Where-Object { Test-OversizedPath -Path $_ })
        if ($oversizedPaths.Count -gt 0) {
            Write-Log ('Skipped automatic commit because files at least 90 MB changed: {0}' -f ($oversizedPaths -join ', '))
            return
        }

        Invoke-Git -Arguments @('add', '-A', '--', '.') | Out-Null
        $stagedCheck = Invoke-Git -Arguments @('diff', '--cached', '--quiet') -AllowFailure
        if ($stagedCheck.ExitCode -eq 1) {
            $message = 'chore: auto-sync {0}' -f ([DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))
            Invoke-Git -Arguments @('commit', '-m', $message) | Out-Null
            Write-Log ('Automatic commit completed: {0}' -f $message)
        }
        elseif ($stagedCheck.ExitCode -ne 0) {
            throw 'Unable to inspect the staging area.'
        }
    }

    Push-CurrentBranch
}

if (-not (Test-Path -LiteralPath (Join-Path $script:RepoPath '.git') -PathType Container)) {
    throw 'Not a Git repository: {0}' -f $script:RepoPath
}

$mutexNameBytes = [System.Text.Encoding]::UTF8.GetBytes($script:RepoPath.ToLowerInvariant())
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $mutexSuffix = ([System.BitConverter]::ToString($sha256.ComputeHash($mutexNameBytes))).Replace('-', '')
}
finally {
    $sha256.Dispose()
}

$mutex = New-Object System.Threading.Mutex($false, ('Local\CodexGitAutoPush_{0}' -f $mutexSuffix))
$hasMutex = $false
try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) {
        Write-Log 'Another watcher instance is already running.'
        exit 0
    }

    Write-Log ('Watcher started: {0}' -f $script:RepoPath)
    try {
        Invoke-Sync
    }
    catch {
        Write-Log ('Synchronization failed: {0}' -f $_.Exception.Message)
        if ($Once) {
            throw
        }
    }

    if ($Once) {
        Write-Log 'One-time run completed.'
        exit 0
    }

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $script:RepoPath
    $watcher.Filter = '*'
    $watcher.IncludeSubdirectories = $true
    $watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'
    $watcher.InternalBufferSize = 65536
    $watcher.EnableRaisingEvents = $true

    try {
        while ($true) {
            $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1000)
            if ($change.TimedOut) {
                continue
            }

            $relativeName = ([string]$change.Name).Replace('\', '/')
            if (($relativeName -eq '.git') -or $relativeName.StartsWith('.git/')) {
                continue
            }

            $quietUntil = [DateTime]::UtcNow.AddSeconds($QuietSeconds)
            while ([DateTime]::UtcNow -lt $quietUntil) {
                $remaining = [Math]::Max(100, [int]($quietUntil - [DateTime]::UtcNow).TotalMilliseconds)
                $nextChange = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, $remaining)
                if (-not $nextChange.TimedOut) {
                    $nextRelativeName = ([string]$nextChange.Name).Replace('\', '/')
                    if (($nextRelativeName -ne '.git') -and (-not $nextRelativeName.StartsWith('.git/'))) {
                        $quietUntil = [DateTime]::UtcNow.AddSeconds($QuietSeconds)
                    }
                }
            }

            try {
                Invoke-Sync
            }
            catch {
                Write-Log ('Synchronization failed: {0}' -f $_.Exception.Message)
            }
        }
    }
    finally {
        $watcher.Dispose()
    }
}
finally {
    if ($hasMutex) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
