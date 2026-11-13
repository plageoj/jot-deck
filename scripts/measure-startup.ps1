<#
.SYNOPSIS
  Launch the Jot Deck desktop app repeatedly and report startup stage timings.

.DESCRIPTION
  Each run sets JOT_DECK_STARTUP_TRACE to a temp file, spawns the app, waits
  until the first board has painted (the app appends one JSON line), closes the
  window, and records every stage as milliseconds since the spawn. The app opens
  its normal data dir and last-used deck, so this measures against your real DB.

  With one exe, the report has a column per run plus the median. With several
  (an A/B comparison), runs are interleaved so both builds see the same machine
  load, and the report shows min / median / max per exe.

.EXAMPLE
  pnpm tauri build --no-bundle
  pwsh scripts/measure-startup.ps1 -Runs 10

.EXAMPLE
  pwsh scripts/measure-startup.ps1 -Exe base.exe, new.exe -Runs 10
#>
param(
  [string[]]$Exe = @(Join-Path $PSScriptRoot "..\target\release\jot-deck-tauri.exe"),
  [int]$Runs = 5,
  [int]$TimeoutSec = 20,
  # Pause between launches so the previous WebView2 processes fully exit.
  [int]$PauseMs = 1500,
  [string]$Csv
)

$ErrorActionPreference = "Stop"
# `pwsh -File` passes "a.exe,b.exe" as one string, so split on commas too.
$Exe = @($Exe | ForEach-Object { $_ -split "," } | ForEach-Object { (Resolve-Path $_.Trim()).Path })

# Stage order for the report: [row name, side, mark name]
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

function Measure-Launch([string]$path, [string]$tag) {
  $log = Join-Path ([IO.Path]::GetTempPath()) "jot-deck-startup-$PID-$tag.jsonl"
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:JOT_DECK_STARTUP_TRACE = $log

  $spawn = Get-EpochMs
  $proc = Start-Process -FilePath $path -PassThru
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
  Start-Sleep -Milliseconds $PauseMs

  if (-not (Test-Path $log)) {
    Write-Warning "${tag}: no trace within ${TimeoutSec}s (is this a build with startup tracing?)"
    return $null
  }
  $trace = Get-Content $log -Raw | ConvertFrom-Json
  Remove-Item $log

  $row = [ordered]@{}
  foreach ($s in $stages) {
    $v = $trace.($s[1]).($s[2])
    $row[$s[0]] = if ($null -ne $v) { [math]::Round($v - $spawn) } else { $null }
  }
  $row["columns"] = $trace.info.columns
  $row["cards"] = $trace.info.cards
  [pscustomobject]$row
}

function Get-Median($vals) {
  $vals = @($vals | Where-Object { $null -ne $_ } | Sort-Object)
  if (-not $vals.Count) { return $null }
  if ($vals.Count % 2) { return $vals[[int][math]::Floor($vals.Count / 2)] }
  ($vals[$vals.Count / 2 - 1] + $vals[$vals.Count / 2]) / 2
}

# results[exe index] = per-run rows; launches alternate between the exes.
$results = @{}
for ($e = 0; $e -lt $Exe.Count; $e++) { $results[$e] = [System.Collections.Generic.List[object]]::new() }
for ($i = 1; $i -le $Runs; $i++) {
  for ($e = 0; $e -lt $Exe.Count; $e++) {
    $row = Measure-Launch $Exe[$e] "$e-$i"
    if ($row) { $results[$e].Add($row) }
  }
}

$names = @($stages | ForEach-Object { $_[0] }) + @("columns", "cards")
$table = foreach ($name in $names) {
  $line = [ordered]@{ stage = $name }
  for ($e = 0; $e -lt $Exe.Count; $e++) {
    $vals = @($results[$e] | ForEach-Object { $_.$name })
    if ($Exe.Count -eq 1) {
      for ($r = 0; $r -lt $vals.Count; $r++) { $line["run$($r + 1)"] = $vals[$r] }
      $line["median"] = Get-Median $vals
    } else {
      $label = [IO.Path]::GetFileNameWithoutExtension($Exe[$e])
      $present = @($vals | Where-Object { $null -ne $_ } | Sort-Object)
      $line["$label min"] = if ($present.Count) { $present[0] } else { $null }
      $line["$label median"] = Get-Median $vals
      $line["$label max"] = if ($present.Count) { $present[-1] } else { $null }
    }
  }
  [pscustomobject]$line
}

Write-Host "ms since spawn; columns/cards rows are counts"
for ($e = 0; $e -lt $Exe.Count; $e++) { Write-Host "  [$e] $($Exe[$e]) ($($results[$e].Count) runs)" }
$table | Format-Table -AutoSize | Out-String -Width 400 | Write-Host
if ($Csv) { $table | Export-Csv -NoTypeInformation -Path $Csv; Write-Host "Saved $Csv" }
