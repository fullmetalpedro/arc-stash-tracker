# Installs the freshly built app on this PC by running its own setup silently (same as end users get):
#   powershell -ExecutionPolicy Bypass -File shell\install.ps1
# Per user, no admin rights. Uninstall from Apps & features (or "ArcStash.exe --uninstall").
$ErrorActionPreference = 'Stop'
$version = (Get-Content (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim()
$setup = Join-Path (Split-Path -Parent $PSScriptRoot) "dist\ArcStashTracker-Setup-$version.exe"
if (-not (Test-Path $setup)) { throw "Build first: shell\build.ps1" }
$p = Start-Process $setup -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Setup failed (exit $($p.ExitCode)); see $env:TEMP\ArcStashTracker-setup.log" }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\ARC Stash Tracker'
"Installed $version to $dest"
