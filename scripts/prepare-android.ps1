$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $PSScriptRoot '..\.tooling'
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
$toolRoot = (Resolve-Path -LiteralPath $toolRoot).Path
$ProgressPreference = 'SilentlyContinue'

if (-not (Test-Path -LiteralPath (Join-Path $toolRoot 'jdk'))) {
    $assets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $package = $assets[0].binary.package
    $jdkZip = Join-Path $toolRoot 'jdk.zip'
    & curl.exe --fail --location --silent --show-error $package.link --output $jdkZip
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar JDK.' }
    if ((Get-FileHash -LiteralPath $jdkZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.checksum) { throw 'Checksum JDK incorrecto.' }
    Expand-Archive -LiteralPath $jdkZip -DestinationPath (Join-Path $toolRoot 'jdk') -Force
    $assets[0] | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $toolRoot 'jdk-source.json')
}

$sdkRoot = Join-Path $toolRoot 'android-sdk'
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
    $sdkZip = Join-Path $toolRoot 'cmdline-tools.zip'
    & curl.exe --fail --location --silent --show-error 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' --output $sdkZip
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar Android SDK.' }
    Expand-Archive -LiteralPath $sdkZip -DestinationPath (Join-Path $toolRoot 'sdk-unpack') -Force
    New-Item -ItemType Directory -Path (Join-Path $sdkRoot 'cmdline-tools\latest') -Force | Out-Null
    Copy-Item -Path (Join-Path $toolRoot 'sdk-unpack\cmdline-tools\*') -Destination (Join-Path $sdkRoot 'cmdline-tools\latest') -Recurse -Force
}
Write-Output 'JDK y herramientas Android preparados dentro de .tooling.'
