param(
    [switch]$NoSync,
    [switch]$NoOpen,
    [switch]$NoDialogs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$remoteUrl = 'https://github.com/zhuopengli627-droid/stock-analysis-system.git'
$runtimePath = Join-Path $repoRoot 'data\shortcut-runtime.json'

function Test-PortfolioCopilotHealth {
    param([int]$Port)
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-PortAvailable {
    param([int]$Port)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Get-RunningPortfolioCopilotPort {
    param([string]$PythonPath)
    if (-not (Test-Path -LiteralPath $runtimePath)) {
        return $null
    }
    try {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
        $port = [int]$runtime.port
        $processId = [int]$runtime.process_id
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        $expectedPython = [System.IO.Path]::GetFullPath($PythonPath)
        $actualExecutable = [System.IO.Path]::GetFullPath([string]$process.ExecutablePath)
        if ($actualExecutable -ne $expectedPython) {
            return $null
        }
        if ([string]$process.CommandLine -notlike '*main.py*--serve-only*') {
            return $null
        }
        if (Test-PortfolioCopilotHealth -Port $port) {
            return $port
        }
    }
    catch {
        return $null
    }
    return $null
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
    $pythonPath = Join-Path $repoRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Python environment not found: $pythonPath"
    }

    $runningPort = Get-RunningPortfolioCopilotPort -PythonPath $pythonPath
    if ($null -ne $runningPort) {
        return $runningPort
    }

    $port = 8000..8100 | Where-Object { Test-PortAvailable -Port $_ } | Select-Object -First 1
    if ($null -eq $port) {
        throw 'No available local port was found between 8000 and 8100.'
    }

    $logDir = Join-Path $repoRoot 'data\shortcut-logs'
    [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $logDir "launch-$timestamp.out.log"
    $stderrPath = Join-Path $logDir "launch-$timestamp.err.log"
    $backendProcess = Start-Process `
        -FilePath $pythonPath `
        -ArgumentList @('main.py', '--serve-only', '--host', '127.0.0.1', '--port', [string]$port) `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortfolioCopilotHealth -Port $port) {
            [System.IO.Directory]::CreateDirectory((Split-Path -Parent $runtimePath)) | Out-Null
            @{
                port = $port
                process_id = $backendProcess.Id
                repo_root = $repoRoot
                started_at = (Get-Date).ToString('o')
            } | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding utf8
            return $port
        }
        Start-Sleep -Seconds 1
    }
    throw "Portfolio Copilot failed to start. Check $stderrPath"
}

function Open-PortfolioCopilotWindow {
    param([int]$Port)
    $appUrl = "http://127.0.0.1:$Port/"
    $edgeCandidates = @(@(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

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
    $port = Start-PortfolioCopilotBackend
    if (-not $NoOpen) {
        Open-PortfolioCopilotWindow -Port $port
    }
}
catch {
    if ($NoDialogs) {
        throw
    }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'Portfolio Copilot 启动失败',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
