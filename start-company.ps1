param(
  [switch]$Reinstall,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = $RootDir
$JimengDir = Join-Path $RootDir "services\\jimeng-api"
$BundledNodeDir = Join-Path $RootDir "tools\\nodejs"
$BundledNodeExe = Join-Path $BundledNodeDir "node.exe"
$BundledNpmCmd = Join-Path $BundledNodeDir "npm.cmd"
$RuntimeDir = Join-Path $RootDir ".runtime"
$PidDir = Join-Path $RuntimeDir "pids"
$LogDir = Join-Path $RuntimeDir "logs"
$FrontendEnvFile = Join-Path $FrontendDir ".env.local"
$FrontendEnvExampleFile = Join-Path $FrontendDir ".env.example"
$FrontendPidFile = Join-Path $PidDir "xhs-app.pid"
$JimengPidFile = Join-Path $PidDir "jimeng-api.pid"
$FrontendStdoutLog = Join-Path $LogDir "xhs-app.stdout.log"
$FrontendStderrLog = Join-Path $LogDir "xhs-app.stderr.log"
$JimengStdoutLog = Join-Path $LogDir "jimeng-api.stdout.log"
$JimengStderrLog = Join-Path $LogDir "jimeng-api.stderr.log"
$FrontendStartScript = Join-Path $FrontendDir "node_modules\\next\\dist\\bin\\next"
$JimengStartScript = Join-Path $JimengDir "dist\\index.js"
$QuotedFrontendStartScript = '"' + $FrontendStartScript + '"'
$QuotedJimengStartScript = '"' + $JimengStartScript + '"'

$NodeCommand = $null
$NpmCommand = $null

function Write-Step([string]$Message) {
  Write-Host "[xhs-company] $Message" -ForegroundColor Cyan
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Resolve-NodeTooling {
  if ((Test-Path $BundledNodeExe) -and (Test-Path $BundledNpmCmd)) {
    Write-Step "Using bundled Node.js runtime from tools\\nodejs"
    return @{
      Node = $BundledNodeExe
      Npm = $BundledNpmCmd
    }
  }

  $node = Get-Command "node" -ErrorAction SilentlyContinue
  $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw "Node.js was not found. Keep the bundled tools\\nodejs folder, or install Node.js 20+ and ensure node/npm are available in PATH."
  }

  Write-Step "Using Node.js runtime from PATH"
  return @{
    Node = $node.Source
    Npm = $npm.Source
  }
}

function Assert-NodeVersion {
  $rawVersion = (& $NodeCommand -v).Trim()
  if ($rawVersion.StartsWith("v")) {
    $rawVersion = $rawVersion.Substring(1)
  }

  $version = [version]$rawVersion
  if ($version.Major -lt 20) {
    throw "Node.js $rawVersion detected. This project requires Node.js 20 or newer."
  }
}

function Invoke-Npm([string]$WorkingDirectory, [string[]]$Arguments) {
  $label = Split-Path $WorkingDirectory -Leaf
  Write-Step "[$label] npm $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $NpmCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed."
    }
  } finally {
    Pop-Location
  }
}

function Ensure-NpmInstall([string]$WorkingDirectory) {
  $nodeModulesPath = Join-Path $WorkingDirectory "node_modules"
  if ($Reinstall -or -not (Test-Path $nodeModulesPath)) {
    Invoke-Npm $WorkingDirectory @("install", "--no-fund", "--no-audit")
    return
  }

  Write-Step "[$(Split-Path $WorkingDirectory -Leaf)] node_modules detected, skipping install"
}

function Stop-TrackedProcess([string]$PidFile) {
  if (-not (Test-Path $PidFile)) {
    return
  }

  $rawPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if (-not $rawPid) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if ($process) {
    Write-Step "Stopping previous process PID=$rawPid"
    Stop-Process -Id $process.Id -Force
    Start-Sleep -Seconds 1
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Get-ListeningPids([int]$Port) {
  @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Assert-PortAvailable([int]$Port, [string]$PidFile, [string]$ServiceName) {
  $trackedPid = $null
  if (Test-Path $PidFile) {
    $trackedPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  }

  $listeningPids = Get-ListeningPids $Port
  if ($listeningPids.Count -eq 0) {
    return
  }

  if ($trackedPid -and ($listeningPids -contains [int]$trackedPid)) {
    Stop-TrackedProcess $PidFile
    $listeningPids = Get-ListeningPids $Port
  }

  if ($listeningPids.Count -gt 0) {
    throw "$ServiceName requires port $Port, but that port is already in use by another process."
  }
}

function Start-BackgroundProcess(
  [string]$Name,
  [string]$WorkingDirectory,
  [string]$FilePath,
  [string[]]$Arguments,
  [string]$PidFile,
  [string]$StdoutLog,
  [string]$StderrLog
) {
  if (Test-Path $StdoutLog) { Remove-Item $StdoutLog -Force }
  if (Test-Path $StderrLog) { Remove-Item $StderrLog -Force }

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -Path $PidFile -Value $process.Id -Encoding ASCII
  Write-Step "$Name started with PID=$($process.Id)"
  return $process
}

function Wait-ForHttp([string]$Url, [int]$TimeoutSeconds, [string]$ServiceName) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Step "$ServiceName is ready"
        return
      }
    } catch {
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out while waiting for ${ServiceName}: $Url"
}

if (-not (Test-Path $FrontendDir)) {
  throw "Frontend directory not found: $FrontendDir"
}

if (-not (Test-Path $JimengDir)) {
  throw "jimeng-api directory not found: $JimengDir"
}

Ensure-Directory $RuntimeDir
Ensure-Directory $PidDir
Ensure-Directory $LogDir

$tooling = Resolve-NodeTooling
$NodeCommand = $tooling.Node
$NpmCommand = $tooling.Npm
Assert-NodeVersion

if (-not (Test-Path $FrontendEnvFile)) {
  if (Test-Path $FrontendEnvExampleFile) {
    throw "Missing .env.local. Create it from .env.example before starting."
  }

  throw "Missing .env.local. Startup cannot continue."
}

Stop-TrackedProcess $FrontendPidFile
Stop-TrackedProcess $JimengPidFile
Assert-PortAvailable -Port 3000 -PidFile $FrontendPidFile -ServiceName "Frontend service"
Assert-PortAvailable -Port 5100 -PidFile $JimengPidFile -ServiceName "Jimeng service"

Ensure-NpmInstall $JimengDir
Ensure-NpmInstall $FrontendDir

Invoke-Npm $JimengDir @("run", "build")
Invoke-Npm $FrontendDir @("run", "build")

if (-not (Test-Path $FrontendStartScript)) {
  throw "Frontend start entry not found: $FrontendStartScript"
}

if (-not (Test-Path $JimengStartScript)) {
  throw "jimeng-api start entry not found: $JimengStartScript"
}

$null = Start-BackgroundProcess `
  -Name "jimeng-api" `
  -WorkingDirectory $JimengDir `
  -FilePath $NodeCommand `
  -Arguments @("--enable-source-maps", "--no-node-snapshot", $QuotedJimengStartScript) `
  -PidFile $JimengPidFile `
  -StdoutLog $JimengStdoutLog `
  -StderrLog $JimengStderrLog

Wait-ForHttp -Url "http://127.0.0.1:5100/ping" -TimeoutSeconds 90 -ServiceName "jimeng-api"

$null = Start-BackgroundProcess `
  -Name "xhs-app" `
  -WorkingDirectory $FrontendDir `
  -FilePath $NodeCommand `
  -Arguments @($QuotedFrontendStartScript, "start", "--hostname", "127.0.0.1", "--port", "3000") `
  -PidFile $FrontendPidFile `
  -StdoutLog $FrontendStdoutLog `
  -StderrLog $FrontendStderrLog

Wait-ForHttp -Url "http://127.0.0.1:3000" -TimeoutSeconds 120 -ServiceName "Frontend service"

if (-not $NoBrowser) {
  Start-Process "http://127.0.0.1:3000"
}

Write-Host ""
Write-Host "Startup complete:" -ForegroundColor Green
Write-Host "  Frontend:  http://127.0.0.1:3000"
Write-Host "  Jimeng:    http://127.0.0.1:5100"
Write-Host "  Log dir:   $LogDir"
