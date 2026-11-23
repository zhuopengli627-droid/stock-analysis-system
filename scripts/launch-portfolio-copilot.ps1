param(
    [switch]$NoSync,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$remoteUrl = 'https://github.com/zhuopengli627-droid/stock-analysis-system.git'
$healthUrl = 'http://127.0.0.1:8000/api/health'
$appUrl = 'http://127.0.0.1:8000/'

function Test-PortfolioCopilotHealth {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Sync-PortfolioCopilotSource {
    $changes = @(& git -C $repoRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Git is unavailable; skipping source sync.'
        return
    }
    if ($changes.Count -gt 0) {
        Write-Warning 'Local changes detected; skipping source sync to preserve your work.'
        return
    }

    & git -C $repoRoot fetch $remoteUrl main --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'GitHub sync failed; continuing with the local version.'
        return
    }

    $localHead = (& git -C $repoRoot rev-parse HEAD).Trim()
    $remoteHead = (& git -C $repoRoot rev-parse FETCH_HEAD).Trim()
    $mergeBase = (& git -C $repoRoot merge-base HEAD FETCH_HEAD).Trim()
    if ($localHead -eq $mergeBase -and $localHead -ne $remoteHead) {
        & git -C $repoRoot merge --ff-only FETCH_HEAD --quiet
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Fast-forward sync failed; continuing with the local version.'
        }
    }
    elseif ($localHead -ne $remoteHead -and $remoteHead -ne $mergeBase) {
        Write-Warning 'Local and GitHub histories differ; skipping automatic merge.'
    }
}

function Start-PortfolioCopilotBackend {
    if (Test-PortfolioCopilotHealth) {
        return
    }

    $pythonPath = Join-Path $repoRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Python environment not found: $pythonPath"
    }

    $logDir = Join-Path $repoRoot 'data\shortcut-logs'
    [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $logDir "launch-$timestamp.out.log"
    $stderrPath = Join-Path $logDir "launch-$timestamp.err.log"
    Start-Process `
        -FilePath $pythonPath `
        -ArgumentList @('main.py', '--serve-only', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath | Out-Null

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortfolioCopilotHealth) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "Portfolio Copilot failed to start. Check $stderrPath"
}

function Open-PortfolioCopilotWindow {
    $edgeCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    if ($edgeCandidates.Count -gt 0) {
        Start-Process -FilePath $edgeCandidates[0] -ArgumentList "--app=$appUrl"
        return
    }
    Start-Process $appUrl
}

try {
    if (-not $NoSync) {
        Sync-PortfolioCopilotSource
    }
    Start-PortfolioCopilotBackend
    if (-not $NoOpen) {
        Open-PortfolioCopilotWindow
    }
}
catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'Portfolio Copilot 启动失败',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
