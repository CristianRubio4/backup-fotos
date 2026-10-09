# Archivos de prueba

`set/` es una carpeta de fotos y vídeos de prueba. Se usa en los tests y también sirve como **carpeta de origen para probar la app con un disco real**.

`base/` contiene las imágenes y vídeos reales a partir de los que se genera (hechos con Chrome: canvas → JPEG/PNG y MediaRecorder → MP4 H.264). Para regenerar `set/`:

```bash
node scripts/make-fixtures.mjs
```

## Qué debe pasar con cada archivo (ajustes por defecto)

| Archivo | Qué es | Resultado esperado |
|---|---|---|
| `DCIM/IMG_0001.jpg`, `IMG_0002.jpg`, `IMG_0003.jpg` | JPEG con EXIF (fecha) | Copiado a `AAAA/MM/` según el EXIF, verificado |
| `valida.png` | PNG | Copiado |
| `DCIM/VID_0001.mp4`, `VID_0002.mov` | Vídeo H.264 | Copiado |
| `DCIM/IMG_0004.heic` | HEIC **sintético** (estructura correcta, sin imagen real) | Copiado como **no verificado** |
| `copia de IMG_0001.jpg` | Mismo contenido que `IMG_0001.jpg` | **Duplicado**: solo se copia uno |
| `vacio.jpg` | 0 bytes | Descartado (dañado) |
| `corrupto.jpg` | Bytes aleatorios | Descartado (dañado) |
| `ceros.jpg` | Todo ceros | Descartado (dañado) |
| `truncado.jpg`, `truncado.png`, `video-truncado.mp4` | Cortados | Descartados (dañados) |
| `negra.jpg`, `blanca.png` | Un solo color | Descartados (vacíos) |
| `diminuta.jpg` | 160×120 px | Descartada (demasiado pequeña) |
| `borrosa.jpg` | Muy desenfocada | Copiada (el filtro de borrosas está desactivado por defecto) |
| `reducida.jpg` | 512×384 px, pero el EXIF dice 4032×3024 | Copiada como **posible versión reducida** |
| `DCIM/IMG_0100.jpg` + `IMG_0100.MOV` | Live Photo | Copiadas juntas con el mismo nombre base |
| `DCIM/MVIMG_0200.jpg` | Motion Photo (JPEG + XMP de Google + MP4 incrustado) | Copiada entera, marcada como Motion Photo |
| `notas.txt` | No es una foto | Ignorado |

No hay una HEIC real porque no se puede generar sin un codificador HEVC. Para probar libheif, usa fotos de un iPhone.
