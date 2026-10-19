$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $projectRoot '.tooling'
$jdkFolder = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1
if (-not $jdkFolder) { throw 'Ejecutar scripts/prepare-android.ps1 primero.' }
$env:JAVA_HOME = $jdkFolder.FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
$env:ANDROID_AVD_HOME = Join-Path $toolRoot 'avd'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
New-Item -ItemType Directory -Path $env:ANDROID_USER_HOME,$env:ANDROID_AVD_HOME,$env:GRADLE_USER_HOME -Force | Out-Null
