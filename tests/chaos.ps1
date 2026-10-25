# Chaos tests for a built app (shell\build.ps1 first). Each scenario launches the real exe in
# self-test mode with its own throwaway profile, so your installed app and data are never touched.
#   powershell -ExecutionPolicy Bypass -File tests\chaos.ps1
param([string]$Exe = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\ARC Stash Tracker\ArcStash.exe'))
$ErrorActionPreference = 'Stop'
$tests = $PSScriptRoot
$root = Join-Path $env:TEMP ("arc-chaos-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$results = New-Object System.Collections.ArrayList

function Set-Fresh($file, $ver) {
  # Mark a cache as just downloaded (and optionally as another data version).
  & python -I -c "import json,sys;from datetime import datetime,timezone;d=json.load(open(sys.argv[1],encoding='utf-8'));d['fetched']=d['tradersAt']=datetime.now(timezone.utc).isoformat();v=sys.argv[2];d['ver']=int(v) if v!='keep' else d['ver'];json.dump(d,open(sys.argv[1],'w',encoding='utf-8'))" $file $ver
}

function Invoke-Scenario($name, [scriptblock]$prepare, $seed, [hashtable]$vars, [scriptblock]$expect) {
  $dir = Join-Path $root $name
  New-Item -ItemType Directory -Force "$dir\profile\data" | Out-Null
  if ($prepare) { & $prepare $dir }
  $env:ARC_SELFTEST = $dir
  if ($seed) { $env:ARC_SELFTEST_SEED = $seed } else { Remove-Item Env:ARC_SELFTEST_SEED -ErrorAction SilentlyContinue }
  if ($vars) { foreach ($k in $vars.Keys) { Set-Item "Env:$k" $vars[$k] } }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $Exe -PassThru
  $exited = $p.WaitForExit(360000)
  if (-not $exited) { $p.Kill() }
  if ($vars) { foreach ($k in $vars.Keys) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } }
  Remove-Item Env:ARC_SELFTEST, Env:ARC_SELFTEST_SEED -ErrorAction SilentlyContinue
  $log = if (Test-Path "$dir\log.txt") { Get-Content "$dir\log.txt" -Raw } else { '' }
  $detail = ''
  $pass = $exited -and (& $expect $log $dir ([ref]$detail))
  Remove-Item -Recurse -Force "$dir\profile\webview" -ErrorAction SilentlyContinue
  [void]$results.Add([pscustomobject]@{ Scenario = $name; Pass = [bool]$pass; Seconds = [int]$sw.Elapsed.TotalSeconds; Detail = $detail })
  Write-Host ("{0,-20} {1}  {2}" -f $name, $(if ($pass) { 'PASS' } else { 'FAIL' }), $detail)
}

$noErrors = { param($log) -not ($log -match 'EXCEPTION|CONSOLE') }
$report = { param($log, [ref]$detail)
  $line = ($log -split "`n") | Where-Object { $_.StartsWith('REPORT ') } | Select-Object -First 1
  if (-not $line) { $detail.Value = 'no report'; return $false }
  # Logged as a JSON string that itself holds JSON, so decode twice.
  $r = ($line.Substring(7) | ConvertFrom-Json) | ConvertFrom-Json
  $detail.Value = "$($r.passed) checks passed, $($r.failed) failed" + $(if ($r.failures) { ': ' + ($r.failures -join ' | ') } else { '' }) + $(if ($r.timings) { ' · timings ms ' + ($r.timings | ConvertTo-Json -Compress) } else { '' })
  return $r.failed -eq 0 }

# 1. Cold start online + in-app chaos (bridge fuzzing, hostile payloads, garbage state, stress).
Invoke-Scenario 'cold-chaos' $null (Join-Path $tests 'chaos.js') $null { param($log, $dir, [ref]$d) (& $report $log $d) -and ($log -match 'BOOT "up"') -and -not ($log -match 'EXCEPTION') }
$base = Join-Path $root 'cold-chaos\profile\data\arc-data.json'
if (-not (Test-Path $base)) { throw "No cache from the cold start; can't run the rest" }

# 2. XSS: every text field in the cache carries an HTML/script payload.
Invoke-Scenario 'xss' { param($dir) & python -I (Join-Path $tests 'poison.py') $base "$dir\profile\data\arc-data.json" | Out-Null } (Join-Path $tests 'chaos-xss.js') $null `
  { param($log, $dir, [ref]$d) (& $report $log $d) -and -not ($log -match 'EXCEPTION') }

# 3. Offline, nothing cached: must show the "couldn't load" screen, not crash or hang.
Invoke-Scenario 'offline-no-cache' $null $null @{ ARC_SELFTEST_OFFLINE = '1' } `
  { param($log, $dir, [ref]$d) $d.Value = ($log -split "`n" | Where-Object { $_ -match 'BOOT|LOADMSG' }) -join ' '; ($log -match 'BOOT "failed"') -and ($log -match "LOADMSG .*Couldn't") }

# 4. Offline with a cache from an older data version: opens with it instead of refusing.
Invoke-Scenario 'offline-old-cache' { param($dir) Copy-Item $base "$dir\profile\data\"; Set-Fresh "$dir\profile\data\arc-data.json" 1 } $null @{ ARC_SELFTEST_OFFLINE = '1' } `
  { param($log, $dir, [ref]$d) ($log -match 'BOOT "up"') -and (& $noErrors $log) }

# 5. Offline with a current cache: opens; the 30-minute trader refresh fails quietly.
Invoke-Scenario 'offline-cache' { param($dir) Copy-Item $base "$dir\profile\data\"; Set-Fresh "$dir\profile\data\arc-data.json" 'keep' } $null @{ ARC_SELFTEST_OFFLINE = '1' } `
  { param($log, $dir, [ref]$d) ($log -match 'BOOT "up"') -and (& $noErrors $log) }

# 6. Corrupt cache (truncated JSON): rebuilds it.
Invoke-Scenario 'corrupt-cache' { param($dir) $t = Get-Content $base -Raw; [IO.File]::WriteAllText("$dir\profile\data\arc-data.json", $t.Substring(0, [int]($t.Length / 2))) } $null $null `
  { param($log, $dir, [ref]$d) $okJson = $true; try { Get-Content "$dir\profile\data\arc-data.json" -Raw | ConvertFrom-Json | Out-Null } catch { $okJson = $false }; $d.Value = "cache valid after: $okJson"; ($log -match 'BOOT "up"') -and $okJson -and (& $noErrors $log) }

# 7. Corrupt state file from the old Electron version.
Invoke-Scenario 'corrupt-old-state' { param($dir) Copy-Item $base "$dir\profile\data\"; Set-Fresh "$dir\profile\data\arc-data.json" 'keep'; [IO.File]::WriteAllBytes("$dir\profile\data\electron-state.json", [byte[]](0xFF, 0x00, 0x7B, 0x22, 0x69)) } $null $null `
  { param($log, $dir, [ref]$d) ($log -match 'BOOT "up"') -and (& $noErrors $log) }

# 8. Data folder can't be written (a folder squats on the temp file name): opens with downloaded data anyway.
Invoke-Scenario 'unwritable-cache' { param($dir) New-Item -ItemType Directory -Force "$dir\profile\data\arc-data.json.tmp", "$dir\profile\data\price-history.json.tmp" | Out-Null } $null $null `
  { param($log, $dir, [ref]$d) ($log -match 'BOOT "up"') -and -not ($log -match 'EXCEPTION') }

# 9. A second copy started while one is running exits straight away.
$dir = Join-Path $root 'second-instance'; New-Item -ItemType Directory -Force "$dir\profile\data" | Out-Null
Copy-Item $base "$dir\profile\data\"; Set-Fresh "$dir\profile\data\arc-data.json" 'keep'
$env:ARC_SELFTEST = $dir
$first = Start-Process $Exe -PassThru; Start-Sleep -Seconds 4
$second = Start-Process $Exe -PassThru; $secondQuit = $second.WaitForExit(8000)
$firstAlive = -not $first.HasExited
if (-not $first.WaitForExit(240000)) { $first.Kill() }
Remove-Item Env:ARC_SELFTEST -ErrorAction SilentlyContinue
[void]$results.Add([pscustomobject]@{ Scenario = 'second-instance'; Pass = ($secondQuit -and $firstAlive); Seconds = 0; Detail = "second exited: $secondQuit, first kept running: $firstAlive" })
Write-Host ("{0,-20} {1}  {2}" -f 'second-instance', $(if ($secondQuit -and $firstAlive) { 'PASS' } else { 'FAIL' }), "second exited: $secondQuit, first kept running: $firstAlive")

$failed = @($results | Where-Object { -not $_.Pass }).Count
Write-Host ("`n{0} of {1} scenarios passed. Logs and screenshots: {2}" -f ($results.Count - $failed), $results.Count, $root)
if ($failed) { exit 1 }
