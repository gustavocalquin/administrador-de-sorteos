# Privacidad y permisos

Administrador de Sorteos 0.7.0 guarda sorteos, compradores, operaciones,
historial, originales, imágenes y resultados en SQLite privado de Android.
No tiene cuentas, servidor, publicidad ni telemetría. La gestión funciona offline.

## Qué sale del dispositivo

- Compartir abre el selector de Android y entrega únicamente las imágenes elegidas
  a la aplicación receptora. La app receptora decide cómo enviarlas.
- Los PNG incluyen contacto público, textos y fotos que agregue el organizador,
  y estados de números. El generador no incluye fichas de compradores.
- Exportar PNG guarda archivos sin cifrar en la carpeta elegida.
- Exportar un respaldo entrega únicamente el archivo cifrado a la carpeta elegida.
  Un proveedor de documentos elegido por el usuario puede ser local o de nube;
  ese proveedor funciona bajo su propia política. Para guardar offline, elegir
  una carpeta local. La aplicación no implementa sincronización.

## Protección y límites

La base y el resguardo interno previo no tienen cifrado adicional. Se apoyan en
el aislamiento y la protección del dispositivo Android. Los respaldos externos
usan AES-256-GCM y una clave derivada de la contraseña con PBKDF2-SHA256,
600.000 iteraciones y sal/IV aleatorios. La contraseña no se conserva ni recupera.

El resguardo interno contiene el estado anterior a la última restauración,
incluidos datos personales; permanece en SQLite hasta otra restauración o hasta
borrar los datos de la app. No reemplaza un respaldo externo. La agenda y el
historial no ofrecen eliminación de compradores en V1. Desinstalar o borrar
datos elimina la base privada; conservar y verificar una copia externa antes.
Los archivos ya exportados quedan en la carpeta del usuario.

Copias automáticas del sistema y transferencia de datos: deshabilitadas mediante
el manifiesto y reglas de extracción. Registro de llamadas del bridge Capacitor
y depuración WebView: deshabilitados explícitamente en esta versión.

## Permisos del paquete

No solicita Internet, contactos, SMS, llamadas, ubicación, biometría ni acceso
general al almacenamiento. Solo aparece el permiso interno de firma de AndroidX
`ar.com.administradordesorteos.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
El FileProvider no exportado permite lectura temporal únicamente de la caché
`public-images/`, nunca de SQLite ni del resguardo interno.

Importación/exportación usa selectores del sistema y permisos limitados a la
elección del usuario. La aplicación no conserva permisos generales de carpetas.
No confirma que una imagen llegó a WhatsApp por haber abierto el selector.

## Verificaciones y pendientes

La inspección de código y la comprobación automatizada del APK cubren permisos,
configuración, firma y recursos empaquetados. Las pruebas de escritorio cubren
exclusión de compradores, cifrado y restauración atómica. Falta comprobar en
Android real el bridge, los selectores, reinicios y proveedores de archivos.
No se presenta esta revisión como una auditoría independiente de seguridad.

Para informar un problema, usar ejemplos ficticios y pasos de reproducción.
No publicar bases, respaldos, contraseñas ni capturas con compradores reales.
