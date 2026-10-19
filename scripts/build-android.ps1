param([switch]$Diagnostic)
. "$PSScriptRoot\android-env.ps1"
Push-Location $projectRoot
try {
    if ($Diagnostic) { & npm.cmd run android:diagnostic } else { & npm.cmd run android:sync }
    if ($LASTEXITCODE -ne 0) { throw 'Falló la preparación de recursos.' }
    Push-Location (Join-Path $projectRoot 'android')
    try {
        & .\gradlew.bat :app:assembleDebug --console=plain --no-daemon --max-workers=1 '-Dorg.gradle.internal.instrumentation.agent=false' '-Dorg.gradle.vfs.watch=false'
        if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación Android.' }
    } finally { Pop-Location }
    $artifactRoot = Join-Path $projectRoot 'artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $name = if ($Diagnostic) { 'administrador-sorteos-etapa6-diagnostico.apk' } else { 'administrador-sorteos-etapa6.apk' }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk') -Destination (Join-Path $artifactRoot $name) -Force
    Get-FileHash -LiteralPath (Join-Path $artifactRoot $name) -Algorithm SHA256
} finally { Pop-Location }
