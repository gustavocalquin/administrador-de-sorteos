# Identidad de firma Android

La clave privada permanente se conserva únicamente fuera del repositorio. Nunca
debe publicarse, adjuntarse a una Release ni reemplazarse entre versiones.

- Titular: Gustavo Calquín
- Algoritmo: RSA, 4096 bits
- Huella SHA-256 del certificado:
  `23:53:AE:E8:95:C8:9D:82:C1:99:07:C6:CB:9B:E7:9E:07:A5:CB:25:FA:29:70:72:5B:69:FB:BB:3A:5E:75:AD`
- Huella compacta:
  `2353aee895c89d82c19907c6cb9be79e07a5cb25fa2970725b69fbbb3a5e75ad`

Antes de publicar la V1 se necesitan al menos dos copias cifradas de la clave y
sus credenciales en ubicaciones independientes. La pérdida de la clave impide
publicar actualizaciones instalables sobre la misma aplicación.
