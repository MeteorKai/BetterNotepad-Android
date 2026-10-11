$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $root ('build\apk-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory -Force | Out-Null

function CheckCase([string]$name, [hashtable]$entries, [string]$expectedError) {
    $path = Join-Path $directory "$name.apk"
    $archive = [System.IO.Compression.ZipFile]::Open($path, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($key in $entries.Keys) {
            $writer = [System.IO.StreamWriter]::new($archive.CreateEntry($key).Open())
            try { $writer.Write($entries[$key]) } finally { $writer.Dispose() }
        }
    } finally { $archive.Dispose() }
    $failure = $null
    try { & "$root\scripts\check-apk.ps1" -Path $path }
    catch { $failure = $_.Exception.Message }
    if ($expectedError) {
        if (-not $failure -or -not $failure.Contains($expectedError)) { throw "$name did not produce the expected error: $failure" }
    } elseif ($failure) { throw "$name failed: $failure" }
    Write-Host "PASS: $name"
}

CheckCase 'valid-android-paths' @{
    'assets/web/index.html' = '<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">'
    'assets/web/assets/app.js' = 'console.log("ready")'
    'assets/web/assets/app.css' = 'body {}'
} ''
CheckCase 'windows-backslashes-rejected' @{
    'assets/web\index.html' = '<html></html>'
} 'Invalid APK asset path'
CheckCase 'missing-startup-page-rejected' @{
    'assets/other/index.html' = '<html></html>'
} 'Missing APK startup resource'
CheckCase 'missing-javascript-rejected' @{
    'assets/web/index.html' = '<script src="/assets/missing.js"></script>'
} 'Missing APK page resource'
