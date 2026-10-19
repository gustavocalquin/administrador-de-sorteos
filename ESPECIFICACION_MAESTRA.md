# Administrador de Sorteos — Especificación maestra V1

**Estado:** especificación inicial consolidada para desarrollo iterativo.  
**Objetivo:** app Android offline para que una persona gestione sorteos numerados, compradores, reservas y ventas, y produzca imágenes claras para difundir en estados de WhatsApp sin editar capturas.  
**Tecnología elegida:** React + TypeScript + Capacitor; SQLite local en Android, con una capa de repositorio que permita evolucionar a sincronización posterior.

## 1. Principios

- Primero facilitar la manera real de vender: «guardame el 17, después te pago».
- Una persona, un teléfono, múltiples sorteos; no hay cuentas, servidor ni sincronización en V1.
- Minimizar pasos e interrupciones. Las operaciones frecuentes no deben abrir confirmaciones extra.
- La grilla interna se actualiza de inmediato; **las imágenes se generan cuando el vendedor lo solicita**, no con cada venta.
- Datos locales privados, sin leer contactos ni requerir permisos de mensajes, llamadas o ubicación.
- Código abierto en GitHub y APK distribuido mediante Releases con compilación verificable.
- Diseñar módulos separados y preparar ampliaciones futuras sin implementarlas prematuramente.

## 2. Alcance de V1

### Imprescindible

1. Crear y gestionar varios sorteos numerados.
2. Alta/edición de compradores, con **Nombre**, **Apellido** y **Teléfono** como tres campos independientes y obligatorios.
3. Reserva, venta, confirmación de pago, limpieza de número, anulaciones y correcciones con historial.
4. Grilla interactiva, selección simple y múltiple, y ficha contextual en panel inferior.
5. Imágenes de grilla y bases/condiciones resumidas; generación manual, vista previa, compartición y exportación.
6. Cierre, posible reapertura antes de cualquier resultado, y registro manual de ganadores.
7. Copias de seguridad completas cifradas con contraseña y restauración segura de reemplazo.
8. APK Android offline, pruebas funcionales y documentación pública.

### Secundario, sujeto a completar tras el núcleo

- Ticket único por operación pagada (varios números en el mismo ticket) y documento PDF de bases y condiciones con borrador para revisar.
- Imagen compartible de resultados si se reutiliza fácilmente el generador.
- Tres estilos visuales iniciales: clásica, moderna, festiva (una misma estructura de renderizado).

### Fuera del alcance V1

- Web de compradores, CRM remoto, usuarios múltiples, sincronización, cuentas, login.
- Mercado Pago, QR de cobro, conciliación bancaria, señas por número, adjuntos de transferencias, contabilidad detallada.
- Consulta automática de loterías, sorteo digital automatizado, publicación automática en WhatsApp.
- Gestión de entrega de premios, lectura/importación de contactos, permisos innecesarios.

## 3. Entidades y consistencia

Modelo de dominio sugerido (adaptable por razones técnicas documentadas):

- **Sorteo**: id UUID, nombre, descripción, organizador/contacto público, númeroInicial, cantidad, precioUnitario, moneda ARS, fecha/hora del sorteo o «a confirmar», método/localización del sorteo, modalidadParticipantes (`todos`/`solo_vendidos`), regla para resultados no vendidos si aplica, estado (`borrador`, `activo`, `pausado`, `ventas_cerradas`, `sorteado`, `archivado`), apariencia y timestamps.
- **Premio**: id, sorteoId, orden, descripción.
- **Número**: id, sorteoId, valor entero (único por sorteo), estado operativo (`disponible`, `reservado`, `vendido`), compradorId nullable, operación activa e historial. Ceros iniciales solo como formato visual.
- **Comprador**: id UUID, nombre, apellido, teléfono original y clave de comparación normalizada; email y observaciones opcionales.
- **Operación**: id, sorteoId, compradorId, tipo y estado, número/s, importe aplicable, timestamps. Debe soportar división parcial: de una reserva múltiple algunos números se pagan y otros siguen reservados.
- **Movimiento/Historial**: id, entidad afectada, acción, valores anteriores/nuevos relevantes, fecha/hora, motivo cuando corresponda. Sin borrado silencioso.
- **Cierre de ventas**: id, sorteoId, fecha/hora, instantánea inmutable de participantes, historial de reaperturas/cierres.
- **Resultado**: id, premioId, número extraído, método declarado, fecha/hora, correcciones e historial; comprador ganador si corresponde.
- **Configuración gráfica**: plantilla, paleta, recursos originales, preferencias de salida.

Separar lógica del dominio, persistencia, render gráfico y compartición Android. Cada operación con múltiples números debe aplicarse de manera atómica (transacción SQLite). Evitar números duplicados y cambios parciales.

## 4. Creación de sorteo

- Desde «Mis sorteos», con dos interfaces sobre el mismo modelo: **asistente guiado** por pasos (predeterminado) y **formulario avanzado**. Cambiar entre ellos sin perder datos.
- Datos: nombre, descripción opcional, número inicial configurable (0, 1, cualquier entero válido), cantidad, precio fijo por número, uno o varios premios ordenados, fecha/hora o «a confirmar», tipo/lugar del sorteo, modalidad de participantes, contacto público, presentación (plantilla, colores, imagen/logo opcional).
- Mostrar rango calculado, conteo y recaudación potencial; validar entradas y evitar rangos imposibles.
- En borrador permitir cambios libres; con operaciones proteger la numeración asignada y condiciones comprometidas. **Queda pendiente cerrar política final de ampliación/reducción tras ventas**: hasta resolverla, bloquear cambios estructurales riesgosos para preservar consistencia.
- Permitir pausa de ventas, finalización, archivo y duplicación de la configuración sin copiar operaciones.
- Bases y condiciones: borrador derivado de configuración editable antes de exportar. No presentar texto automático como asesoramiento jurídico, y reflejar claramente las reglas de participación y extracción.

## 5. Compradores

- Formulario obligatorio en este orden: **Teléfono → Nombre → Apellido**. Los tres campos separados también en base de datos.
- Al introducir teléfono, buscar localmente compradores existentes; sugerir autocompletado de los otros campos, sin forzarlo. Si hay más de un comprador con el mismo teléfono, ofrecer elección.
- Detectar potencial duplicidad por teléfono normalizado (sin suponer unicidad; familias pueden compartir número). Buscar por nombre, apellido, teléfono y números, insensible a tildes, espacios y mayúsculas; ordenar apellido/nombre.
- Comprador único dentro de la agenda del dispositivo y reutilizable en distintos sorteos. No ofrecer «Eliminar comprador» en V1.
- No leer agenda telefónica, SMS ni historial de llamadas.

## 6. Gestión rápida de números, ventas y reservas

- Al abrir un sorteo, mostrar **grilla interactiva como vista principal** y cifras de vendidos, reservados y libres.
- Toque normal sobre número → **panel inferior desplegable** contextual; vista compacta y expandida para formulario; teclado Android no debe tapar controles.
- Botón específico **Selección múltiple**; solo agregar números disponibles. Panel inferior muestra los números elegidos e importe total; operación grupal para un comprador.
- Buscador «Ir al número» para localizarlo, resaltarlo y abrir panel.
- Disponible → Reservar o Vender; reservado → Confirmar pago (de uno o varios), consultar/editar, Limpiar; vendido → consultar/editar y Limpiar con advertencia extra.
- Reserva: teléfono, nombre y apellido; botón directo **Confirmar reserva**, sin pantalla intermedia. No exige dinero. Se guarda, se actualiza la grilla interna y se cierra panel con mensaje discreto.
- Venta directa: mismo formulario y flujo, con **Confirmar venta**, estado pagado desde el inicio.
- Reserva múltiple: pagar algunos números sin liberar los demás, manteniendo vínculos e historial.
- Reservas **no vencen automáticamente**. Avisos discretos de pendientes, fecha estimada opcional, nunca liberar solas por plazo.
- «Limpiar número»: desasigna, devuelve a disponible y registra historial; anular una venta requiere advertencia por posible devolución.
- No gestionar pagos por medio: si pagó, está vendido; si no, reservado. Recaudación básica = números vendidos × precio correspondiente (respetar reglas de cambios de precio).
- Operaciones cotidianas no deben abrir imágenes ni preguntas de publicación.

## 7. Cierre, resultados y premios

- Estados distinguidos: activo/pausado → ventas cerradas → sorteado → archivado.
- Al pedir cierre, mostrar recuento y advertencia explícita: **«Los números reservados que no fueron pagados quedarán como no vendidos y no participarán del sorteo. ¿Deseás continuar?»**. Ofrecer revisar reservas o confirmar.
- En una única operación atómica, cancelar todas las reservas impagas, liberar asignación activa y conservar historial; cerrar ventas y congelar lista de participantes. Durante cierre, visualizar los libres como **no vendidos**.
- La modalidad «solo vendidos» excluye todos los impagos. La modalidad «todos los números» requiere una regla preestablecida de resolución de número sin comprador; **no alterar luego del resultado**. Independientemente de la modalidad, la reserva no otorga participación adquirida ni derecho a reclamar premio.
- Permitir reabrir **solo antes de registrar el primer resultado**, conservando cierres previos; no restaurar automáticamente reservas canceladas. Nuevo cierre produce nueva instantánea de participantes.
- Modalidad de extracción configurable (presencial/radio, lotería, otro externo), con registro manual de los números obtenidos en V1. Un premio = un número ganador; un mismo número no puede ganar dos premios. Comprar varios números da varias oportunidades.
- Validar rangos, participantes, duplicación de premiados; no disfrazar resultados ingresados manualmente como verificados por fuente oficial.
- Correcciones de resultados solo con registro de cambios y motivos. Sin gestor de entrega de premios en V1.

## 8. Generador gráfico y compartir

- Motor basado en datos actuales, nunca capturas ni re-ediciones de imágenes antiguas.
- Grilla operativa interna siempre actualizada automáticamente; **NO generar imágenes después de cada transacción**. Mostrar indicador no intrusivo «Imagen desactualizada» si hubo cambios; botón «Generar nueva imagen» a pedido. Al compartir, verificar vigencia y proponer actualizar.
- Salidas principales: **grilla de números** y **bases y condiciones resumidas**; ticket único por operación y PDF revisable como salidas secundarias.
- Salida principal vertical **1080×1920 (9:16)** para estados, con zonas seguras para interfaz de WhatsApp, contraste y tipografía legible. Probar a escala física de celular.
- Dividir automáticamente la grilla en tantas imágenes como requiera la legibilidad; orden ascendente; cada una muestra rango y «parte X de N». Primera página completa; siguientes resumidas pero siempre con identificación, precio, contacto y rango. Leyenda de estados en todas.
- Estados representados por color **y** signo/estilo no cromático; no filtrar nombres ni teléfonos de compradores en imágenes públicas.
- Plantillas coherentes, preferiblemente clásica, moderna y festiva, paletas controladas, logo/foto opcional sin editor libre que rompa diseño. Mantener identidad entre grilla y condiciones.
- «Compartir sorteo»: vista previa de imágenes, selección individual. **Grilla completa y bases resumidas seleccionadas por defecto**. Orden predeterminado: grilla portada, grillas adicionales y condiciones. Compartir via selector nativo de Android; permitir exportar. No prometer publicación automática a Estados WhatsApp: validar con APK real.
- Imágenes vigentes internas regenerables/reemplazables; exportaciones del usuario no se borran. Mostrar hora de actualización discretamente.

## 9. Copias de seguridad y privacidad

- SQLite en almacenamiento privado de Android; no usar localStorage como fuente principal de verdad.
- Respaldo **completo, cifrado con contraseña** incluyendo BD y recursos originales, con formato versionado e integridad verificada. Resguardos no contienen contraseñas sin protección.
- Exportación mediante selector de archivos Android; datos privados y contraseña elegida por usuario. Informar que no hay recuperación si se olvida.
- Restauración **solo de reemplazo completo**, con vista previa, advertencia y confirmación explícita, resguardo interno previo, validación de versión/integridad y mecanismo transaccional para no dañar datos actuales ante fallos.
- Recordatorio discreto de respaldo si hay cambios nuevos y pasa alrededor de una semana desde exportación; respaldo interno no reemplaza uno externo.
- Sin lectura de contactos, ubicación, SMS o llamadas. Permisos mínimos y documentación clara.

## 10. Navegación

- Inicio predeterminado: **Mis sorteos**; si está vacío, botón «Crear mi primer sorteo».
- Navegación general: Sorteos, Compradores, Ajustes.
- Panel de sorteo: grilla principal, resumen de estado, Nueva operación y acceso a Reservas/Imágenes; opciones secundarias para editar, historial, cierre, resultados, duplicar y archivar.
- Atrás Android coherente; advertencia si se descartan cambios no guardados; mensajes no invasivos; accesibilidad básica y formatos legibles.
- Selección múltiple activada mediante botón (nunca permanente por defecto).

## 11. Arquitectura y pruebas

- React + TypeScript + Capacitor, paquete Android; SQLite local mediante plugin Capacitor mantenido y probado. La versión web de desarrollo puede usar adaptador de almacenamiento de pruebas, pero Android/SQLite se valida desde el comienzo.
- Separar componentes UI, servicios de dominio, persistencia, generación visual y bridge Android. Migraciones de esquema versionadas, IDs UUID para futura sincronización.
- Pruebas imprescindibles: persistencia tras reinicio; selección de números sin duplicados; venta y reserva múltiple transaccional; pagos parciales; asociación de comprador existente; teléfonos compartidos; limpieza con historial; cierre libera reservas; reapertura condicionada; bloqueo después de resultados; generador 50/100/500/1000; exportación y restauración con contraseña; conflictos de archivo, interfaz móvil y compartir real.
- No usar datos de prueba como persistencia definitiva. Evitar declarar éxito si falta ejecutar verificación real.

## 12. Etapas para Work (con validación por etapa)

1. Repositorio, esqueleto UI y Android, SQLite real, modelos, migraciones y pruebas de persistencia.
2. Sorteos y compradores; asistente y formulario avanzado; selección/reutilización de comprador.
3. Grilla, panel inferior, selección múltiple, ventas, reservas, pagos parciales, correcciones e historial.
4. Generador de grillas e imagen de condiciones; división automática, previsualizar, exportar y compartir Android.
5. Cierre/reapertura, registro de premios/resultados, respaldos cifrados y restauración segura. Completar ticket/PDF si no comprometen robustez.
6. QA en APK real, optimización, documentación, licencia y publicación mediante GitHub Actions/Releases.

**Regla operativa:** no pasar de etapa sin demo funcional y checklist de pruebas. Si hay que posponer una característica secundaria, documentarla y mantener el núcleo funcionando.

## 13. Decisiones aún no cerradas (no inventar silenciosamente)

- Política definitiva de cambio de cantidad o precio tras haber registrado operaciones: proponer opción conservadora y consultarla.
- Cómo resolver premio vacante en modalidad «todos los números» (regla elegible al crear el sorteo).
- Si el formato PDF y ticket entran en la primera entrega o en una iteración posterior de V1.
- Nombre definitivo de paquete Android, estilo final de icono y licencia de código abierto (MIT propuesta previamente, no ratificada).

## 14. Definición de éxito

Un vendedor instala el APK desde GitHub, sin iniciar sesión ni conectarse a ningún servidor; crea una rifa, registra compradores y ventas/reservas, ve la grilla actualizada, genera a pedido imágenes impecables y compartibles para estados, cierra ventas cancelando reservas impagas, registra ganadores y recupera sus datos desde una copia cifrada.
