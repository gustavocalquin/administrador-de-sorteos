# Administrador de Sorteos 0.7.0 — versión de prueba

Esta versión reúne el núcleo funcional de la futura V1 y los ajustes de
usabilidad comprobados en un teléfono Android real.

## Cambios principales

- Activación visible al guardar un sorteo.
- Menú para archivar o borrar sorteos con confirmación.
- Logo del sorteo separado de las fotografías de premios.
- Modo claro, oscuro o definido por el teléfono.
- Seis plantillas: Clásica, Moderna, Festiva, Minimalista, Elegante y Colorida.
- Bases y condiciones reorganizadas en secciones legibles y paginadas.
- Persistencia SQLite esquema 7 y restauración compatible con respaldos 5 y 6.

## Verificación

- 100 pruebas automatizadas en 13 archivos.
- TypeScript, lint y build web aprobados.
- Compilaciones Android debug y release aprobadas.
- Recorrido funcional realizado en teléfono: persistencia, compartir/exportar,
  archivos, navegación, respaldo/restauración y ciclo completo del sorteo.
- Firma permanente RSA de 4096 bits creada y release local verificada.

La publicación inicial seguirá siendo una preversión hasta comprobar una
actualización entre dos APK firmadas con la clave permanente.
