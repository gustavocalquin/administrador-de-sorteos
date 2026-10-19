# Pruebas antes de distribuir

Estado 2026-10-19: regresión de escritorio, compilación y recorrido principal en
teléfono Android verificados por el titular. Persistencia, agenda, operaciones,
archivos, imágenes, compartir/exportar, cierre, resultados, respaldo y
restauración funcionaron correctamente. Existe una firma permanente y una release
local firmada y verificada. Falta ejecutar los workflows en GitHub y comprobar
una actualización entre dos releases firmadas con esa clave.
Usar datos ficticios en teléfono de prueba u otro equipo. No se requiere ni se
autoriza reparar Windows o iniciar el emulador del equipo de desarrollo.

Registrar modelo, versión Android y WebView, versión/SHA256 de APK, certificado,
fecha y resultado observado por caso. Una captura web no acredita prueba Android.

| Área | Comprobación Android | Estado |
| --- | --- | --- |
| Instalación | Icono, arranque, modo avión y ausencia de permisos sensibles | Aprobado en teléfono |
| Persistencia | Crear compradores, rango, imagen y ventas; cierre forzado y reinicio | Aprobado en teléfono |
| Agenda | Teléfono primero, ficha existente y búsqueda | Aprobado en teléfono |
| Operaciones | Reservas, pagos, ventas, limpieza y correcciones | Aprobado en teléfono |
| Condiciones | Bloqueo definitivo tras primera operación, pausa y duplicado | Aprobado en teléfono |
| Interfaz | Atrás, teclado y selectores de fecha e imagen | Aprobado en teléfono |
| Imágenes | Grillas, logos, fotos de premios y bases completas | Aprobado en teléfono |
| Compartir | Selección y envío de piezas mediante selector Android | Aprobado en teléfono |
| Exportar | Selección de carpeta y archivos generados | Aprobado en teléfono |
| Cerrar | Cancelar impagos, revisar reservas, congelar participantes y reabrir | Aprobado en teléfono |
| Resultados | Registro, corrección y archivo | Aprobado en teléfono |
| Respaldo | Exportación cifrada y relectura | Aprobado en teléfono |
| Restaurar | Vista previa, reemplazo y recuperación de datos | Aprobado en teléfono |
| Fallos | En base descartable: error de escritura y muerte de proceso durante restauración; estado anterior o nuevo completo | Pendiente |
| Rendimiento | Tiempo/memoria con imágenes y respaldos grandes; no prometer 128 MiB prácticos sin medir | Pendiente |

No desinstalar para probar una actualización. Si Android informa firma distinta,
detenerse y preservar los datos. El APK generado por CI usa otra clave debug y no
debe asumirse actualizable sobre el APK local. Guardar respaldo antes de cualquier
prueba con información que se quiera conservar.

## Controles de distribución

- Licencia MIT aprobada a nombre de Gustavo Calquín: resuelto.
- Icono propuesto e identificador Android: aprobados para continuar.
- Repositorio público: autorizado, conexión con GitHub pendiente.
- Clave permanente: creada y verificada; falta guardar una segunda copia segura.
- Ejecutar workflows en GitHub y revisar resultados reales; hasta entonces son
  configuración preparada, no ejecuciones acreditadas.
- Verificar SHA256 y certificado del APK exacto que se distribuirá.
- Publicar solo después de revisar los pendientes y el estado de prueba/estable.

