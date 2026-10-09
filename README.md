# Backup de fotos

Aplicación web para hacer copias de seguridad de fotos y vídeos en un disco externo, 100 % en el navegador: sin servidor, sin instalar nada y sin que ninguna foto salga del dispositivo.

**Prioridad absoluta: no perder ninguna foto.** Ante la duda se copia y se avisa; nunca se descarta ni se borra nada en silencio, y la carpeta de origen nunca se modifica.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Un origen, un disco, copia con progreso, manifest seguro, anti-duplicados (Chrome/Edge escritorio) | ✅ |
| 2 | Análisis y descarte, HEIC, Live/Motion Photos, tests | ✅ |
| 3 | Detección de disco, reanudación automática, Wake Lock, batería, FAT32 | ✅ |
| 4 | Varios orígenes, discos y dispositivos; caché de hashes | ⏳ |
| 5 | Comprobar integridad, explorar y restaurar | ⏳ |
| 6 | Liberar espacio | ⏳ |
| 7 | Cifrado opcional | ⏳ |
| 8 | Modo compatible ZIP (Safari/iPhone, Firefox) | ⏳ |
| 9 | PWA instalable | ⏳ |

## Cómo funciona

1. Recorre la carpeta de origen (con subcarpetas) y separa fotos/vídeos del resto.
2. **Compara primero por tamaño**: solo calcula el SHA-256 previo de los archivos cuyo tamaño coincide con algo ya copiado o con otro archivo de la selección. El resto se *hashea* mientras se copia (una sola lectura).
3. Descarta duplicados (ya en el disco o repetidos en la selección con otro nombre).
4. **Analiza** solo lo que se va a copiar (ver abajo) y descarta lo que no sirve.
5. Lee la fecha EXIF y copia en streaming a `AAAA/MM/2026-10-09_143022_nombre.jpg` (o `Sin fecha/`).
6. Relee cada copia del disco y compara el hash. Si no coincide, recopia; si vuelve a fallar, lo marca como error (el original sigue intacto).
7. Registra cada archivo en `.backup-manifest.json`.

### Análisis y descarte

Principio: **solo se descarta lo que se ha comprobado que no sirve**; lo que no se puede comprobar se copia como *no verificado*. Lo descartado nunca se borra del origen y el informe permite **copiarlo igualmente**.

- **Bytes** (`src/core/analysis/formats.ts`): formato real por *magic bytes*, cabecera de ceros, JPEG sin FFD9 (buscado solo en los datos de imagen y el último MB, para admitir los datos que añaden Samsung y las Motion Photos), PNG sin IEND, estructura ISOBMFF de MP4/MOV/HEIC (truncados, sin `moov`).
- **Imagen** (Worker): `createImageBitmap` para JPEG/PNG/GIF/WebP/BMP/AVIF; **libheif** (WebAssembly, carga diferida) para HEIC. Sobre una miniatura: imagen vacía (desviación típica y uniformidad), tamaño mínimo y, opcionalmente, nitidez (varianza del Laplaciano).
- **Vídeo**: metadatos en un `<video>`; si el navegador no lo reproduce (HEVC) pero la estructura es correcta, se copia como no verificado.
- **HEIC**: solo se descarta si su estructura está dañada **y** libheif tampoco la abre.
- **Live Photos**: foto + vídeo con el mismo nombre base en la misma carpeta; el vídeo se copia con el mismo nombre que la foto y queda enlazado en el manifest (`pair`). Nunca se le aplica el filtro de vídeos cortos.
- **Motion Photos**: se reconocen por el XMP de Google/Samsung y se copian enteras.
- **Posibles versiones reducidas**: resolución real muy inferior a la del EXIF; se copian marcadas.

Los archivos de prueba están en `tests/fixtures` (ver su README).

### Manifest seguro

- `.backup-manifest.json`: registro de todo lo copiado (hash, tamaño, nombre y ruta original, ruta en el disco, fecha EXIF, fecha del archivo, dispositivo, estado y fecha de copia).
- `.backup-manifest.bak`: la versión anterior válida.
- Escritura: `.bak` ← actual → `.tmp` → releer y validar → principal → releer y validar → borrar `.tmp`. En Chrome `createWritable()` escribe en un `.crswap` y reemplaza el archivo al cerrar, así que el reemplazo es atómico.
- `.backup-journal/`: durante el backup, cada N archivos se guarda un segmento pequeño. Si se corta (pestaña cerrada, disco desconectado), el siguiente backup lo incorpora; y lo copiado después del último segmento se reconoce en el disco por hash, sin recopiarlo ni duplicarlo.
- Si el principal, el `.tmp` y el `.bak` están todos dañados, la app **no copia nada** (para no duplicar) y lo indica.
- `.backup-disk-id`: identificador único del disco.

### Arquitectura

```
src/core/       lógica pura (sin navegador), cubierta por tests
  backup/       motor: fases, progreso, pausa/cancelación, reintentos
  manifest/     esquema, validación, escritura segura, diario
  dedupe.ts     tamaño → hash, duplicados en la selección
  naming.ts     año/mes, nombre con fecha, sufijos de conflicto
  hash.ts       SHA-256 incremental (hash-wasm)
src/platform/   File System Access API, Worker, recorrido del origen
src/workers/    Worker de E/S: hash, copia en streaming, EXIF
src/db/         IndexedDB (handles, ajustes, dispositivo, historial)
src/screens/    Inicio, Progreso, Informe, Historial, Ajustes, Ayuda
tests/          Vitest con un disco en memoria (desconexión y corrupción simuladas)
```

`crypto.subtle.digest` no es incremental (necesita el archivo entero en memoria), por eso el hash usa **hash-wasm** por bloques dentro del Worker.

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # tests unitarios
npm run build
```

## Despliegue

Cada push a `main` ejecuta los tests y publica en GitHub Pages (`.github/workflows/deploy.yml`). Hay que activar una vez **Settings → Pages → Source: GitHub Actions**.

## Limitaciones del navegador

- **Fecha original del archivo**: el navegador no puede conservarla al copiar. Queda en el nombre y en el manifest.
- **Espacio libre del disco**: ninguna API web lo da. Si el disco se llena, el backup se detiene y avisa.
- **Desconexión del disco**: el backup espera y continúa solo al volver el mismo disco (`.backup-disk-id`). En Windows, si el disco recibe otra letra, el navegador no lo encuentra y hay que volver a elegir la carpeta.
- **FAT32**: no admite archivos de 4 GB o más. El navegador no permite saber el formato del disco; se detecta cuando falla un archivo grande, se informa y el resto del backup continúa.
- **Batería** (Battery Status API) solo en Chrome/Edge; **Wake Lock** requiere la pestaña visible.
- **Safari / iPhone / Firefox**: no permiten escribir en carpetas. Tendrán un modo compatible con ZIP (Fase 8).
