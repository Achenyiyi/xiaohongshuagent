param(
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $RootDir "start-company.ps1"
$CleanupUrl = "http://127.0.0.1:3000/clear-local-data"

function Write-Step([string]$Message) {
  Write-Host "[xhs-company] $Message" -ForegroundColor Cyan
}

function Test-CleanupPageReady {
  try {
    $response = Invoke-WebRequest -Uri $CleanupUrl -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

if (-not (Test-CleanupPageReady)) {
  if ($NoStart) {
    throw "Cleanup page is not running. Start the app first, or run this script without -NoStart."
  }

  if (-not (Test-Path $StartScript)) {
    throw "Start script not found: $StartScript"
  }

  Write-Step "Cleanup page is offline, starting local services first"
  & powershell -ExecutionPolicy Bypass -File $StartScript -NoBrowser
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start local services. Cleanup page cannot be opened."
  }
}

Write-Step "Opening cleanup page in the default browser"
Start-Process $CleanupUrl
Write-Host ""
Write-Host "Cleanup page opened:" -ForegroundColor Green
Write-Host "  $CleanupUrl"
Write-Host "Close the browser tab after cleanup completes."
