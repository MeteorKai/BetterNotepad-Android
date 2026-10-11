param(
    [string]$Sdk = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$BuildTools = '34.0.0',
    [int]$CompileSdk = 34
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\javac.exe'))) {
    $JavaHome = 'C:\Program Files\Java\jdk-17'
}
$env:JAVA_HOME = $JavaHome
$tools = Join-Path $Sdk "build-tools\$BuildTools"
$androidJar = Join-Path $Sdk "platforms\android-$CompileSdk\android.jar"
foreach ($path in @($androidJar, "$tools\aapt2.exe", "$tools\lib\d8.jar", "$JavaHome\bin\javac.exe")) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing build prerequisite: $path" }
}
function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed with exit code $LASTEXITCODE" }
}
Run 'npm.cmd' @('run', 'build')
$build = Join-Path $root 'build\android'
$artifacts = Join-Path $root 'artifacts'
# Rebuild only generated files under the verified project-local build path.
if (Test-Path -LiteralPath $build) {
    $resolved = (Resolve-Path -LiteralPath $build).Path
    if ($resolved -ne (Join-Path $root 'build\android')) { throw 'Unsafe build path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $build, $artifacts, "$build\classes", "$build\dex", "$build\assets\web", "$build\generated" | Out-Null
Copy-Item -Path "$root\dist\*" -Destination "$build\assets\web" -Recurse
$main = Join-Path $root 'android\app\src\main'
Run "$tools\aapt2.exe" @('compile', '--dir', "$main\res", '-o', "$build\resources.zip")
Run "$tools\aapt2.exe" @('link', '-o', "$build\unsigned.apk", '-I', $androidJar, '--manifest', "$main\AndroidManifest.xml", '--java', "$build\generated", '--auto-add-overlay', "$build\resources.zip")
$sources = @(Get-ChildItem -LiteralPath "$main\java" -Recurse -Filter '*.java' | ForEach-Object FullName)
$sources += @(Get-ChildItem -LiteralPath "$build\generated" -Recurse -Filter '*.java' | ForEach-Object FullName)
Run "$JavaHome\bin\javac.exe" (@('-encoding', 'UTF-8', '--release', '8', '-classpath', $androidJar, '-d', "$build\classes") + $sources)
$classes = @(Get-ChildItem -LiteralPath "$build\classes" -Recurse -Filter '*.class' | ForEach-Object FullName)
Run "$JavaHome\bin\java.exe" (@('-cp', "$tools\lib\d8.jar", 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', $androidJar, '--output', "$build\dex") + $classes)
# Windows AAPT2 -A writes backslashes into asset entry names. JAR writes the
# forward-slash ZIP paths that Android AssetManager requires.
Run "$JavaHome\bin\jar.exe" @('uf', "$build\unsigned.apk", '-C', $build, 'assets', '-C', "$build\dex", 'classes.dex')
& "$PSScriptRoot\check-apk.ps1" -Path "$build\unsigned.apk"
Run "$tools\zipalign.exe" @('-f', '4', "$build\unsigned.apk", "$build\aligned.apk")
$keystore = Join-Path $root 'build\local-debug.keystore'
if (-not (Test-Path -LiteralPath $keystore)) {
    Run "$JavaHome\bin\keytool.exe" @('-genkeypair', '-keystore', $keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=BetterNotepad Local Build')
}
$manifest = [xml](Get-Content -LiteralPath "$main\AndroidManifest.xml")
$version = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
$apk = Join-Path $artifacts "BetterNotepad-Android-$version.apk"
Run "$tools\apksigner.bat" @('sign', '--ks', $keystore, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, "$build\aligned.apk")
Run "$tools\apksigner.bat" @('verify', '--verbose', $apk)
Write-Host "APK: $apk"
