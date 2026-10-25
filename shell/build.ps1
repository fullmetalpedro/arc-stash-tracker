# Builds the app into dist\ARC Stash Tracker\ using the C# compiler that ships with Windows
# (.NET Framework 4.8) and the WebView2 runtime already on the PC. No SDKs to install.
#   powershell -ExecutionPolicy Bypass -File shell\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'dist\ARC Stash Tracker'
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$lib = Join-Path $PSScriptRoot 'lib'

# WebView2 SDK: fetched from NuGet (not committed), pinned to a version and verified by SHA-256.
$wv2 = '1.0.4314.35'
$pins = [ordered]@{
  'Microsoft.Web.WebView2.Core.dll'     = @('lib/net462/Microsoft.Web.WebView2.Core.dll', 'acdd517b951829f763d1255f32df1e6a936cb8623a7ebff6b8b24172dede6bd6')
  'Microsoft.Web.WebView2.WinForms.dll' = @('lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'c66437f80886aecf074804b61af4cc10ad90a95310c8e0a717f31ea377c26b03')
  'WebView2Loader.dll'                  = @('runtimes/win-x64/native/WebView2Loader.dll', 'd3fce90bdeecb08596e377dea6a316354dd8949e32ff09b89d51be00c14e21b6')
}
if (@($pins.Keys | Where-Object { -not (Test-Path (Join-Path $lib $_)) }).Count) {
  Write-Host "Downloading WebView2 SDK $wv2 from nuget.org..."
  New-Item -ItemType Directory -Force $lib | Out-Null
  $pkg = Join-Path $env:TEMP "webview2.$wv2.nupkg"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$wv2/microsoft.web.webview2.$wv2.nupkg" -OutFile $pkg -UseBasicParsing
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($pkg)
  try {
    # ExtractToFile is an extension method; Windows PowerShell 5.1 needs the static form.
    foreach ($name in $pins.Keys) { [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry($pins[$name][0]), (Join-Path $lib $name), $true) }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('LICENSE.txt'), (Join-Path $lib 'WebView2-LICENSE.txt'), $true)
  } finally { $zip.Dispose(); Remove-Item $pkg -ErrorAction SilentlyContinue }
}
foreach ($name in $pins.Keys) {
  $hash = (Get-FileHash (Join-Path $lib $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $pins[$name][1]) { throw "$name doesn't match the pinned SHA-256 (got $hash). Delete shell\lib and build again." }
}
$version = (Get-Content (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim()
# One version source: stamp it into the manifest used for this build.
$manifest = Join-Path $env:TEMP 'arcstash.manifest'
(Get-Content (Join-Path $PSScriptRoot 'app.manifest') -Raw) -replace 'version="[0-9.]+" name=', "version=`"$version.0`" name=" | Set-Content -Encoding UTF8 $manifest
$info = Join-Path $env:TEMP 'arcstash.version.cs'
@"
[assembly: System.Reflection.AssemblyTitle("ARC Stash Tracker")]
[assembly: System.Reflection.AssemblyProduct("ARC Stash Tracker")]
[assembly: System.Reflection.AssemblyVersion("$version.0")]
[assembly: System.Reflection.AssemblyFileVersion("$version.0")]
"@ | Set-Content -Encoding UTF8 $info

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

$refs = 'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Net.Http.dll', 'System.Web.Extensions.dll' |
  ForEach-Object { "/r:$fw\$_" }
& "$fw\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /langversion:5 `
  "/out:$out\ArcStash.exe" "/win32icon:$PSScriptRoot\icon.ico" "/win32manifest:$manifest" `
  @refs "/r:$lib\Microsoft.Web.WebView2.Core.dll" "/r:$lib\Microsoft.Web.WebView2.WinForms.dll" `
  "$PSScriptRoot\ArcStash.cs" $info
if ($LASTEXITCODE -ne 0) { throw "csc failed" }

Copy-Item "$lib\*.dll" $out
if (Test-Path "$lib\WebView2-LICENSE.txt") { Copy-Item "$lib\WebView2-LICENSE.txt" $out }
Copy-Item "$PSScriptRoot\icon.ico" $out
Copy-Item -Recurse (Join-Path $root 'app') (Join-Path $out 'app')
Set-Content -NoNewline -Encoding ASCII (Join-Path $out 'app/version.txt') $version
$size = (Get-ChildItem $out -Recurse | Measure-Object Length -Sum).Sum
"Built $version in $out ({0:N1} MB)" -f ($size / 1MB)

# Release files: a portable zip and a one-file installer that carries the same zip.
$dist = Split-Path -Parent $out
Get-ChildItem $dist -File -Filter 'ArcStashTracker-*' | Remove-Item -Force
$zip = Join-Path $dist "ArcStashTracker-$version-portable.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($out, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$setupInfo = Join-Path $env:TEMP 'arcstash.setup.version.cs'
(Get-Content $info -Raw) -replace 'AssemblyTitle\("ARC Stash Tracker"\)', 'AssemblyTitle("ARC Stash Tracker Setup")' | Set-Content -Encoding UTF8 $setupInfo
$setup = Join-Path $dist "ArcStashTracker-Setup-$version.exe"
& "$fw\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /langversion:5 `
  "/out:$setup" "/win32icon:$PSScriptRoot\icon.ico" "/win32manifest:$manifest" "/resource:$zip,payload.zip" `
  "/r:$fw\System.dll" "/r:$fw\System.Core.dll" "/r:$fw\System.Drawing.dll" "/r:$fw\System.Windows.Forms.dll" "/r:$fw\System.IO.Compression.dll" `
  "$PSScriptRoot\Setup.cs" $setupInfo
if ($LASTEXITCODE -ne 0) { throw "csc failed (setup)" }
foreach ($f in $setup, $zip) { "  {0} ({1:N0} KB, SHA-256 {2})" -f (Split-Path -Leaf $f), ((Get-Item $f).Length / 1KB), (Get-FileHash $f).Hash.ToLowerInvariant() }
