# Compilación y distribución

La entrega 0.7.0 sigue siendo una **preversión de prueba**. La publicación del
repositorio fue autorizada; todavía no existe un remoto ni una Release. Los
workflows están preparados y falta ejecutarlos en GitHub.

Los workflows pasaron actionlint 1.7.7. La variante release sin firmar también
compiló localmente, incluyendo `lintVitalRelease`. La revisión completa
`lintDebug` de Android quedó
bloqueada por un fallo al mover la caché de Gradle del equipo local. No se marca
aprobada ni se requiere reparar Windows para usar las fuentes en otro equipo.

## Entorno fijado

- Node 24.12.0; `npm ci` y versiones exactas en `package-lock.json`.
- JDK Temurin 21.0.12.1+1, SDK API 36, Build Tools 36.0.0.
- Gradle Wrapper 8.14.3 con checksum SHA256 de la distribución.
- Paquete `ar.com.administradordesorteos.app`, versionCode 8, versión 0.7.0-prueba.2.
- Python 3.10+ para inspección del APK y empaquetado de fuentes; solo biblioteca estándar.

En Windows con herramientas locales ya preparadas:

```powershell
npm.cmd ci
npm.cmd run check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-android.ps1
. .\scripts\android-env.ps1
python scripts/verify-apk.py artifacts/administrador-sorteos-etapa6.apk --report artifacts/verificacion-apk.json
python scripts/package-source.py
```

En Linux/macOS con JDK y SDK configurados:

```sh
npm ci
npm run check
npx --no-install cap sync android
cd android
bash ./gradlew :app:assembleDebug --no-daemon --max-workers=1 --console=plain
cd ..
python3 scripts/verify-apk.py android/app/build/outputs/apk/debug/app-debug.apk --report artifacts/verificacion-apk.json
```

El verificador exige versión, permiso interno único, backups/red clara desactivados,
firma v2 válida, tipo debug/release esperado, configuración sin logs/depuración web,
ausencia de WASM/diagnóstico y coincidencia de todos los recursos con `dist`.
El informe registra SHA256 y certificado. No prueba funcionamiento en Android.

## Fuentes para publicar

`package-source.py` genera el ZIP de fuentes correspondiente a `package.json`, con
`FUENTES_SHA256.json`. Usa una lista explícita de carpetas/archivos. Excluye bases,
respaldos, claves, herramientas, cachés, APK, pruebas de reparación Windows,
conversaciones, registro interno de progreso y evidencias del equipo.
Los originales de esos documentos permanecen en el proyecto local.

Para crear el repositorio público futuro, extraer este ZIP en una carpeta nueva,
revisarlo y versionar esa carpeta. No usar `git add .` sobre el espacio de trabajo
histórico sin revisar sus archivos personales. El ZIP contiene código, pruebas,
Gradle Wrapper, licencia, avisos de terceros y documentación pública.

## Workflows preparados

`build.yml` verifica PR/push/ejecución manual, corre `npm ci` + checks, sincroniza,
compila e inspecciona APK debug, y conserva APK/informe 14 días. Solo lectura del
repositorio, sin secretos. Cada runner puede generar otra clave debug: este APK
no es la distribución estable ni garantiza actualización sobre otra firma.

`release.yml` se ejecuta manualmente desde la rama predeterminada. Exige un tag
existente `vX.Y.Z`, coincidente con `package.json`, y licencia MIT. Compila una
APK release sin firma, luego firma usando secretos limitados al paso de firma,
verifica el paquete y prepara un **borrador de preversión**. No publica
automáticamente. Si ya existe una Release con ese tag, falla sin reemplazarla.

Antes de habilitarlo:

1. Mantener el paquete e icono aprobados y revisar la candidata final.
2. Conservar la clave de firma permanente y su contraseña en una
   copia segura fuera del repositorio y registrar la huella pública SHA256.
   No generar una clave nueva por versión ni utilizar la clave debug. La huella
   pública vigente está en `docs/FIRMA_ANDROID.md`.
3. Configurar el entorno `release` de GitHub con revisores y restricción a la
   rama predeterminada protegida. Restringir quién puede crear/modificar tags.
4. Guardar secretos `SIGNING_KEY_BASE64`, `SIGNING_STORE_PASSWORD`,
   `SIGNING_KEY_PASSWORD`, `SIGNING_ALIAS` en ese entorno. No poner claves o
   contraseñas en commits, issues, capturas ni este documento.
5. Crear el tag sobre el commit revisado y ejecutar el workflow. Revisar logs,
   certificado, APK y notas; publicar el borrador solo cuando corresponda.

Las acciones están fijadas a commits completos de sus repositorios oficiales,
consultados el 2026-10-18. El workflow solo solicita escritura de contenido en el
trabajo de borrador. No usa `pull_request_target` ni secretos en pruebas de PR.

## Qué significa compilación verificable

Se registra código fuente por commit/tag, versiones, resultados, hash del APK
y certificado. Se comprueba que los recursos del APK coinciden con el build web.
Esto permite reconstruir e inspeccionar; **no se ha demostrado identidad binaria
bit a bit entre máquinas**. Las firmas y el entorno pueden cambiar el APK.
Tampoco se ha ejecutado aún el workflow en los runners de GitHub.

Las dependencias conservan sus licencias: ver `public/THIRD_PARTY_NOTICES.txt`.
La licencia MIT aprobada para este proyecto no cambia las de los componentes.

Referencias oficiales:
[seguridad de Actions](https://docs.github.com/en/actions/reference/security/secure-use),
[firma Android](https://developer.android.com/studio/publish/app-signing),
[iconos adaptables](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).
