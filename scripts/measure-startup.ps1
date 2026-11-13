<#
.SYNOPSIS
  Launch the Jot Deck desktop app repeatedly and report startup stage timings.

.DESCRIPTION
  Each run sets JOT_DECK_STARTUP_TRACE to a temp file, spawns the app, waits
  until the first board has painted (the app appends one JSON line), closes the
  window, and prints every stage as milliseconds since the spawn. The final row
  is the median across runs. The app opens its normal data dir, so this measures
  against your real DB.

.EXAMPLE
  pnpm tauri build --no-bundle
  pwsh scripts/measure-startup.ps1 -Runs 10

.EXAMPLE
  pwsh scripts/measure-startup.ps1 -Exe "$env:LOCALAPPDATA\Jot Deck\jot-deck-tauri.exe"
#>
param(
  [string]$Exe = (Join-Path $PSScriptRoot "..\target\release\jot-deck-tauri.exe"),
  [int]$Runs = 5,
  [int]$TimeoutSec = 20,
  # Pause between runs so the previous WebView2 processes fully exit.
  [int]$PauseMs = 1500,
  [string]$Csv
)

$ErrorActionPreference = "Stop"
$Exe = (Resolve-Path $Exe).Path

# Stage order for the report: [column name, side, mark name]
$stages = @(
  @("main", "rust", "main"),
  @("setup_start", "rust", "setup_start"),
  @("db_opened", "rust", "db_opened"),
  @("setup_end", "rust", "setup_end"),
  @("page_load_start", "rust", "page_load_started"),
  @("response_end", "js", "response_end"),
  @("page_script", "js", "page_script"),
  @("dom_interactive", "js", "dom_interactive"),
  @("mounted", "js", "mounted"),
  @("first_paint", "js", "first-paint"),
  @("data_loaded", "js", "data_loaded"),
  @("board_painted", "js", "board_painted"),
  @("page_load_done", "rust", "page_load_finished")
)

function Get-EpochMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

$rows = @()
for ($i = 1; $i -le $Runs; $i++) {
  $log = Join-Path ([IO.Path]::GetTempPath()) "jot-deck-startup-$PID-$i.jsonl"
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:JOT_DECK_STARTUP_TRACE = $log

  $spawn = Get-EpochMs
  $proc = Start-Process -FilePath $Exe -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while (-not (Test-Path $log) -or -not (Get-Content $log -Raw)) {
    if ((Get-Date) -gt $deadline) { break }
    Start-Sleep -Milliseconds 20
  }

  if (-not $proc.HasExited) {
    [void]$proc.CloseMainWindow()
    if (-not $proc.WaitForExit(5000)) { $proc.Kill() }
  }
  Remove-Item Env:JOT_DECK_STARTUP_TRACE

  if (-not (Test-Path $log)) {
    Write-Warning "run ${i}: no trace within ${TimeoutSec}s (is this a build with startup tracing?)"
    continue
  }
  $trace = Get-Content $log -Raw | ConvertFrom-Json
  Remove-Item $log

  $row = [ordered]@{ run = $i }
  foreach ($s in $stages) {
    $v = $trace.($s[1]).($s[2])
    $row[$s[0]] = if ($null -ne $v) { [math]::Round($v - $spawn) } else { $null }
  }
  $row["columns"] = $trace.info.columns
  $row["cards"] = $trace.info.cards
  $rows += [pscustomobject]$row

  Start-Sleep -Milliseconds $PauseMs
}

if ($rows.Count -eq 0) { throw "No successful runs." }

# One row per stage, one column per run, plus the median.
function Get-Median($vals) {
  $vals = @($vals | Where-Object { $null -ne $_ } | Sort-Object)
  if (-not $vals.Count) { return $null }
  if ($vals.Count % 2) { return $vals[[int][math]::Floor($vals.Count / 2)] }
  ($vals[$vals.Count / 2 - 1] + $vals[$vals.Count / 2]) / 2
}
$table = foreach ($name in ($rows[0].PSObject.Properties.Name | Where-Object { $_ -ne "run" })) {
  $line = [ordered]@{ stage = $name }
  foreach ($r in $rows) { $line["run$($r.run)"] = $r.$name }
  $line["median"] = Get-Median ($rows | ForEach-Object { $_.$name })
  [pscustomobject]$line
}

Write-Host "ms since spawn ($Exe); columns/cards rows are counts"
$table | Format-Table -AutoSize | Out-String -Width 400 | Write-Host
if ($Csv) { $table | Export-Csv -NoTypeInformation -Path $Csv; Write-Host "Saved $Csv" }
