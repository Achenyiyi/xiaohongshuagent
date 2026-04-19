$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidDir = Join-Path (Join-Path $RootDir ".runtime") "pids"
$PidFiles = @(
  (Join-Path $PidDir "xhs-app.pid"),
  (Join-Path $PidDir "jimeng-api.pid")
)

function Stop-TrackedProcess([string]$PidFile) {
  if (-not (Test-Path $PidFile)) {
    return
  }

  $rawPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($rawPid) {
    $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      Write-Host "Stopped PID=$rawPid"
    }
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

foreach ($pidFile in $PidFiles) {
  Stop-TrackedProcess $pidFile
}

Write-Host "Tracked local services have been stopped."
