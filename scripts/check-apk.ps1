param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.StartsWith('assets/') -and $entry.FullName.Contains('\')) {
            throw "Invalid APK asset path: $($entry.FullName). Android requires forward slashes."
        }
    }
    $index = $archive.GetEntry('assets/web/index.html')
    if (-not $index) { throw 'Missing APK startup resource: assets/web/index.html' }
    $reader = [System.IO.StreamReader]::new($index.Open())
    try { $html = $reader.ReadToEnd() } finally { $reader.Dispose() }
    foreach ($reference in [regex]::Matches($html, '(?:src|href)="(/[^"?#]+)"')) {
        $asset = 'assets/web' + $reference.Groups[1].Value
        if (-not $archive.GetEntry($asset)) { throw "Missing APK page resource: $asset" }
    }
    Write-Host 'APK web assets verified: startup HTML and referenced resources exist with Android-compatible paths.'
} finally { $archive.Dispose() }
