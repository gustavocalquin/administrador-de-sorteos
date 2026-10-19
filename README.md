# Administrador de Sorteos V1

Aplicación Android offline para administrar sorteos numerados, con React,
TypeScript, Capacitor y SQLite local.

**Versión de prueba 0.7.0 — candidata local a V1.**
100 pruebas automatizadas, compilación web y Android aprobadas.
Los recorridos principales fueron verificados en un teléfono Android real:
persistencia, compartir/exportar, archivos, navegación, respaldo/restauración y
el ciclo completo de un sorteo. La publicación en GitHub está en preparación.

## Qué incluye

- Crear/editar sorteos mediante asistente o modo avanzado, sin perder campos.
- Número inicial, cantidad y precio ARS, rango y recaudación calculados.
- Premios ordenados, fecha o a confirmar, método externo y regla de participación.
- Seis plantillas, tres paletas, logo y fotos opcionales para premios; modo oscuro.
- Activar, pausar, reanudar, duplicar, archivar y borrar con confirmación.
- Agenda de compradores con teléfono, nombre y apellido separados; búsqueda,
  selección de fichas existentes y teléfonos compartidos sin exigir unicidad.
- SQLite privado en Android, migraciones atómicas, historial y protección
  contra sobrescrituras. Una operación fallida revierte todo su guardado.
- Navegación y aviso antes de descartar cambios no guardados.

- Grilla con búsqueda, estados, selección múltiple, resumen y panel inferior.
- Reservas indefinidas, venta directa y pagos parciales por números completos.
- Limpieza y correcciones con motivo e historial; protección ante doble venta.
- Imágenes PNG 1080×1920 desde datos públicos reales: portada, continuaciones y bases.
- Generación manual, selección de piezas, vista previa y aviso de desactualización.
- Seis estilos y tres paletas, estado por color/símbolo, contacto público y sin compradores.
- Compartir PNG múltiples por selector Android; exportar a carpeta elegida con SAF.
- Aclaraciones de bases editables antes de operaciones y guardadas con historial.

- Cierre con cancelación de reservas impagas e instantánea de participantes.
- Reapertura antes de la primera extracción, sin recuperar reservas canceladas.
- Resultados manuales, ganador único por número, correcciones con motivo y archivo.
- Respaldo completo cifrado con contraseña, vista previa, restauración de reemplazo
  atómico, resguardo interno previo y recordatorio semanal cuando hay cambios.

Ticket, PDF e imagen pública de resultados quedan pospuestos para priorizar el
núcleo. Etapa 6 prepara regresión, privacidad, licencia y distribución.
La aplicación continúa como versión de prueba hasta completar la publicación y
la validación de actualización con la firma permanente.

## Documentación

- [Especificación del producto](ESPECIFICACION_MAESTRA.md)
- [Compilar, verificar y preparar GitHub](docs/DISTRIBUCION.md)
- [Privacidad y permisos](docs/PRIVACIDAD.md)
- [Pruebas Android y publicación](docs/PRUEBAS_PUBLICACION.md)
- [Notas de versión](docs/NOTAS_VERSION.md)
- [Propuesta de icono](docs/ICONO.svg)
- [Licencia MIT](LICENSE) y [avisos de terceros](public/THIRD_PARTY_NOTICES.txt)

## Desarrollo local

Node 24.12 o posterior de la rama 24; versiones exactas en `package-lock.json`.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run dev
```

Abrir la dirección indicada, normalmente `http://127.0.0.1:5173`. En desarrollo,
el navegador usa SQLite WASM en memoria, con el mismo esquema y servicio de
la app: **sus datos se pierden al recargar**. Usar ejemplos ficticios.
No utiliza localStorage ni servidor de datos. El adaptador temporal no entra
en la compilación normal para Android; `npm run preview` no habilita ese
adaptador. En Android siempre se abre SQLite privado persistente.

`npm run check` ejecuta tipos, lint, pruebas y compilación web. Las pruebas usan
SQLite real mediante Node, incluso en los recorridos de formularios React.
El aviso experimental de `node:sqlite` corresponde a las pruebas de escritorio.

## Compilar Android

Identificador provisional aprobado: `ar.com.administradordesorteos.app`.
JDK 21, SDK API 36, Build Tools 35.0.0/36.0.0, Gradle Wrapper 8.14.3.
Las herramientas locales existentes se cargan solo para el proceso:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-android.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-android.ps1 -Diagnostic
```

Estos comandos no inician emulador ni modifican características de Windows.

**Artefactos:**

- `artifacts/administrador-sorteos-etapa6.apk`: APK de prueba local.
- `artifacts/administrador-sorteos-0.6.0-fuentes.zip`: fuentes preparadas para distribuir.

La APK normal contiene la funcionalidad de etapas 1–5 y los ajustes de etapa 6.
Las APK anteriores existentes se conservaron.
Existe una clave permanente local, excluida del repositorio, y una release firmada
de comprobación. Su huella pública está documentada en `docs/FIRMA_ANDROID.md`.
MIT está aprobada. Los workflows y la guía de firma están preparados; GitHub
todavía no se ejecutó. No se promete identidad binaria entre máquinas.

Para preparar otro equipo Windows están los scripts `prepare-android.ps1` e
`install-android-sdk.ps1`. Descargan herramientas oficiales a `.tooling`; revisar
las licencias Android antes de ejecutar. En otro sistema con JDK/SDK configurados:

```text
npm ci
npm run android:sync
cd android
./gradlew :app:assembleDebug --no-daemon --max-workers=1
```

## Privacidad y arquitectura

Datos comerciales: `sorteosSQLite.db` en el directorio privado Android.
Diagnóstico: `sorteos_diagnosticoSQLite.db`, separado y excluido del build normal.
Sin cuentas, telemetría, CDN ni backend. La base local no está cifrada: se apoya
en aislamiento Android. Las exportaciones de respaldo sí están cifradas con contraseña.

El manifiesto excluye Internet y biometría, y no solicita contactos, SMS,
llamadas ni ubicación. Las copias automáticas y transferencia del sistema están
deshabilitadas. La selección de imagen usa el selector de archivos, sin acceso
masivo a fotos/contactos. Falta comprobar ese selector en Android.

Dominio: `src/domain`; casos de uso: `src/application`; SQLite y migraciones:
`src/infrastructure/database`; interfaz: `src/app` y `src/ui`; pruebas web y
herramientas de diagnóstico: `src/dev`. UUID locales, centavos enteros ARS y
fechas UTC. Esquema versión 5 con recursos, operaciones, imágenes, cierres y resultados.

Las imágenes originales se guardan localmente con UUID y un límite de 2 MiB,
en formatos PNG/JPG/WebP. Recursos anteriores se conservan para historial.
La copia cifrada incluye todos los recursos, incluso los anteriores. Crear un sorteo
almacena su rango; las filas de números se crean solo al operar y se conservan
al liberarlos para detectar selecciones obsoletas. La grilla muestra 100 por página.

## Imágenes y límites actuales

La grilla divide 40 números en portada y hasta 60 por continuación para números
cortos; reduce columnas para enteros largos. Las bases se dividen por líneas sin
recortar contenido. Todos los PNG tienen 1080×1920; datos de compradores excluidos
por una lista explícita de campos públicos, no por ocultar texto sobre capturas.
El contacto público debe caber en tres líneas; revisar datos introducidos a mano.

La generación admite hasta 100 piezas y 60 MB de datos codificados. Si excede el
límite, informa el problema y conserva el conjunto anterior. No hay generación
tras cada venta. Los conjuntos internos se reemplazan atómicamente; archivos
exportados no se borran. Caché temporal para compartir: solo PNG propios, limpieza
de archivos de más de siete días al preparar otra salida.

En navegador se puede descargar individualmente cada PNG visible. El selector de
compartir y exportación de conjuntos se implementó para Android; falta probarlo
con apps receptoras reales. Aclaraciones y configuración comprometidas se protegen
desde la primera operación; la redacción no sustituye revisión del organizador.

## Cierre y respaldos

Desde la primera reserva/venta se bloquean definitivamente números, precio, premios
y condiciones, incluso si luego se anula. Para todos los números se elige antes de
operar entre premio vacante y repetición externa hasta un vendido. El cierre cancela
derechos de reservantes impagos; las extracciones manuales siguen la regla congelada.
Reglas libres de versiones anteriores no se convierten silenciosamente: si ya tienen
operaciones y no coinciden con las opciones aprobadas, requieren revisión antes del cierre.

En Ajustes, crear una copia con contraseña de al menos 12 caracteres. No se guarda
ni recupera esa contraseña. Android exporta a una carpeta elegida, con nombre único,
y relee el archivo para comprobar su integridad antes de confirmar. La demo solo
inicia una descarga; no puede confirmar que el navegador la guardó.

Formato versionado, AES-256-GCM y PBKDF2-SHA256 (600.000 iteraciones), sal e IV
aleatorios por copia. Se incluyen las 15 tablas de datos comerciales, originales,
imágenes generadas e historial. Se excluyen el resguardo previo recursivo y las marcas
locales de exportación. Límites: 128 MiB de contenido, 180 MiB de archivo y 1.000.000
de filas importadas. No se trunca al excederlos.

Restaurar exige contraseña, validación contra SQLite, vista previa y escribir
REEMPLAZAR. Se rechazan versiones incompatibles y cambios posteriores a la vista
previa. El reemplazo y el resguardo previo se confirman juntos; un fallo revierte
ambos. El resguardo interno permanece en SQLite privado sin cifrado adicional y
puede revisarse/restaurarse desde Ajustes. No sustituye la copia externa.

Falta comprobar estos flujos en Android, especialmente poco espacio, muerte del
proceso, proveedores de archivos y rendimiento de copias grandes.

## Licencia

MIT — Copyright (c) 2026 Gustavo Calquín. Ver [LICENSE](LICENSE).
Cada dependencia conserva su licencia. Los avisos de los componentes se incluyen
en las fuentes y en el APK. No hay repositorio remoto ni publicación en GitHub.
