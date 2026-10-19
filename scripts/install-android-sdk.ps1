. "$PSScriptRoot\android-env.ps1"
$manager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
1..20 | ForEach-Object { 'y' } | & $manager 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' 'emulator' 'system-images;android-36;google_apis;x86_64'
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación del SDK.' }
