# Backup de fotos

Aplicación web (PWA) para hacer copias de seguridad de fotos y vídeos en un disco externo, **100 % en el navegador**: sin servidor, sin instalar nada y sin que ninguna foto ni dato salga del dispositivo.

**Prioridad absoluta: no perder ninguna foto.** Ante la duda se copia y se avisa; nunca se descarta ni se borra nada en silencio, y las carpetas de origen solo se tocan en "Liberar espacio", con confirmación explícita.

**App:** https://cristianrubio4.github.io/backup-fotos/

## Funciones

| | |
|---|---|
| **Copia** | En streaming desde varios Workers; verificación releyendo la copia (SHA-256); carpetas año/mes por fecha EXIF; nombre con fecha; pausa, reanudar, cancelar; Wake Lock; batería (aviso < 20 %, pausa < 10 %) |
| **Anti-duplicados** | Manifest en el disco con hash, tamaño, nombres, rutas, fechas, dispositivo y estado; tamaño primero y luego hash; duplicados dentro de la selección y entre dispositivos; caché de hashes del origen en IndexedDB |
| **Manifest seguro** | `.tmp` + `.bak` + validación + diario por segmentos para reanudar sin repetir; reconstrucción escaneando el disco |
| **Análisis** | Dañados (firma, ceros, JPEG/PNG/vídeo truncados, no decodificables), vacíos, diminutos, borrosos (opcional), vídeos cortos (opcional); HEIC con libheif; posibles versiones reducidas (nube); todo ajustable y con "Copiar igualmente" |
| **Live / Motion Photos** | Parejas copiadas juntas con el mismo nombre y enlazadas en el manifest; Motion Photos detectadas por XMP |
| **Discos** | Varios discos en rotación (`.backup-disk-id`), aviso de antigüedad, detección cada 3 s, reanudación automática al volver el mismo disco, FAT32 (> 4 GB) detectado con instrucciones para exFAT |
| **Orígenes y dispositivos** | Varias carpetas (cámara, capturas, WhatsApp, Telegram…), varios dispositivos, opción de subcarpeta por dispositivo |
| **Integridad** | Comprobar disco (recalcula todos los hashes), reparar desde el origen u otro disco, recordatorio cada N meses |
| **Explorar y restaurar** | Por año, mes, dispositivo, tipo y estado, con miniaturas (también HEIC y discos cifrados); restaurar a una carpeta |
| **Liberar espacio** | Solo archivos verificados (nunca "no verificado" ni "versión reducida"), en cuántos discos está cada uno, confirmación escribiendo BORRAR, re-verificación justo antes de borrar, registro |
| **Cifrado opcional** | Por disco: AES-256-GCM con clave Argon2id; formato por bloques autenticados; manifest y nombres ilegibles; descifrar a una carpeta |
| **Modo compatible** | Safari/iPhone y Firefox: selector de archivos, mismo análisis y anti-duplicados (historial + manifest del disco), ZIP por lotes que conservan las fechas; detección de HEIC convertidas por Safari |
| **PWA** | Instalable, funciona sin conexión, actualización solo cuando el usuario quiere y nunca durante un backup |
| **Privacidad** | Sin analíticas ni peticiones externas, garantizado por una CSP estricta (`connect-src 'self'`) |

## Navegadores

- **Modo completo** (File System Access API): Chrome y Edge en Windows, macOS, Linux y ChromeOS, y Chrome 132+ en Android.
- **Modo compatible** (ZIP): Safari (iPhone, iPad, Mac) y Firefox. También en Chrome con `?compatible`.

## Arquitectura

```
src/core/          lógica pura (sin navegador), cubierta por tests
  backup/          motor: fases, progreso, concurrencia, reanudación, FAT32, informe
  analysis/        formatos (magic bytes, truncados, ISOBMFF), píxeles, clasificación, Live Photos
  manifest/        esquema, validación, escritura segura, diario
  tools/           integridad, reparación, reconstrucción, liberar espacio
  compat/          planificador del modo compatible y lotes ZIP
  crypto*.ts       cifrado por bloques (AES-GCM + Argon2id)
src/platform/      File System Access, pool de Workers, análisis (createImageBitmap, <video>), disco, energía
src/workers/       Worker de E/S: hash, copia, cifrado, EXIF, decodificación (libheif)
src/state/         estado (zustand): backup, herramientas, liberar espacio, claves, modo compatible
src/screens/       Inicio, Progreso, Informe, Explorar, Herramientas, Historial, Ajustes, Ayuda, Modo compatible
tests/             Vitest con discos en memoria (desconexión, FAT32, cifrado…) y archivos de prueba reales
```

Detalles técnicos:
- `crypto.subtle.digest` no es incremental: el hash usa **hash-wasm** por bloques dentro de los Workers.
- Las pantallas se cargan bajo demanda y se precargan en reposo; transiciones con la View Transitions API; listas con `content-visibility`.
- Diseño con tokens OKLCH, tema claro/oscuro/sistema, accesible (roles, foco visible, `prefers-reduced-motion`).

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 120+ tests
npm run build
node scripts/make-fixtures.mjs   # regenera tests/fixtures/set
```

## Publicar en GitHub Pages (gratis), paso a paso

1. Crea un repositorio en GitHub (público para Pages gratis) y sube el código a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada push a `main` ejecuta `.github/workflows/deploy.yml`: instala, pasa los tests, compila con `BASE_PATH=/<repo>/` y publica.
4. La URL queda en **Settings → Pages** (`https://<usuario>.github.io/<repo>/`) y en la pestaña **Actions** de cada ejecución.

**Alternativa: Cloudflare Pages.** Workers & Pages → Create → Pages → conectar el repositorio. Build command `npm run build`, output `dist`, variable `BASE_PATH=/`. Ventaja: se puede añadir la CSP también como cabecera HTTP en un archivo `public/_headers`.

## Limitaciones del navegador (y cómo se resuelven)

| Limitación | Solución |
|---|---|
| No se puede conservar la fecha original del archivo al copiar | Fecha en el nombre y en el manifest (los ZIP del modo compatible sí la conservan) |
| No se puede saber el espacio libre del disco | Se muestra lo que ocupará; si se llena, el backup se detiene y avisa |
| No se puede saber si el disco es FAT32 | Se detecta al fallar un archivo > 4 GB, se informa y el resto continúa |
| En Windows, si el disco cambia de letra, el navegador no lo encuentra | Volver a añadir la carpeta: se reconoce por `.backup-disk-id` |
| Safari/Firefox no escriben en el disco | Modo compatible con ZIP por lotes |
| Safari no entrega el vídeo de las Live Photos | Se avisa en el informe |
| En iPhone una web no puede borrar fotos | Liberar espacio no está disponible allí (se explica) |
| ZIP en memoria en Safari | Lotes de tamaño configurable (300 MB por defecto en iPhone) |
