# Backup de fotos

Aplicación web (PWA) para hacer copias de seguridad de fotos y vídeos en un disco externo, **100 % en el navegador**: sin servidor, sin instalar nada y sin que ninguna foto ni dato salga del dispositivo.

**Prioridad absoluta: no perder ninguna foto.** Ante la duda se copia y se avisa; nunca se descarta ni se borra nada en silencio, y las carpetas de origen solo se tocan en "Liberar espacio", con confirmación explícita.

**App web:** https://cristianrubio4.github.io/backup-fotos/
**Programa para Windows (móvil por cable):** [descargar BackupFotos.exe](https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe)

## Cómo hacer el backup de tu móvil

Cada backup crea en el destino **una sola carpeta** con el nombre del móvil y la fecha y hora (`Galaxy S23 - 2026-10-19 14h30`) y guarda dentro **todas** las fotos y vídeos, verificados, junto con los archivos de registro (`.backup-disk-id`, `.backup-manifest.json`). En el móvil no se borra ni se cambia nada.

> **¿Por qué hay un programa para Windows además de la web?** Windows no deja que un navegador recorra un móvil conectado por cable (lo trata como "dispositivo portátil", no como un disco). Al elegir el móvil como carpeta en la web, Windows solo entrega unas pocas fotos recientes. El programa usa el mismo acceso que el Explorador de Windows y recorre la memoria completa del móvil, carpeta a carpeta.

### Android

**Con un PC con Windows (recomendado)**

1. Descarga [BackupFotos.exe](https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe). No necesita instalación. Si Windows avisa de que es un programa desconocido: **Más información → Ejecutar de todas formas** (no está firmado).
2. Conecta el móvil por cable y **desbloquéalo**. En el aviso USB del móvil elige **Transferencia de archivos** (en algunos móviles: "Archivos" o "MTP").
3. Abre el programa: el móvil aparece solo en la lista. Elige **dónde guardar** (un disco externo o una carpeta del PC) y pulsa **Hacer backup**.
4. El programa busca en **todas** las carpetas del móvil, también en la tarjeta SD: cámara, capturas, WhatsApp (`Android/media`), Telegram, descargas… Se salta solo los datos internos de las apps (`Android/data`, `Android/obb`), la papelera y las miniaturas.
5. Al terminar: **Abrir la carpeta** para ver las fotos, o **Ver detalles** para ver las carpetas revisadas y si algún archivo no se pudo copiar (sigue en el móvil).

Mantén el móvil desbloqueado durante la copia. Si se bloquea o se desconecta, lo ya copiado queda guardado y verificado; vuelve a lanzar el backup.

**Solo con el móvil (sin PC)**

1. Abre la [app web](https://cristianrubio4.github.io/backup-fotos/) en **Chrome** (versión 132 o posterior). Opcional: menú → *Instalar app*.
2. **Fotos que copiar → Añadir**: elige `DCIM` y, si quieres, `Pictures`, `Android/media/com.whatsapp/WhatsApp/Media`… (Android no deja elegir la raíz de la memoria).
3. **Dónde guardar → Añadir**: un disco o pendrive conectado por USB-OTG, o una carpeta de la tarjeta SD.
4. **Hacer backup**.

**Con la web en el PC** (sin programa): **Elegir fotos sueltas** → Este equipo → tu móvil → Almacenamiento interno → DCIM → Camera → Ctrl + A → Abrir. Funciona, pero hay que entrar en cada carpeta.

### iPhone

**Con un PC con Windows (recomendado)**

1. Instala **Dispositivos Apple** (Apple Devices, en Microsoft Store) o iTunes: traen el controlador que necesita Windows para ver el iPhone.
2. En el iPhone: **Ajustes → Fotos → Transferir a Mac o PC → Mantener originales**. Así se copian las fotos tal cual (HEIC y vídeos MOV); con "Automático" el iPhone las convierte a JPG al vuelo.
3. Si usas iCloud con **Optimizar almacenamiento**, el iPhone solo guarda versiones reducidas: cambia a **Descargar y conservar originales** (Ajustes → [tu nombre] → iCloud → Fotos) y espera a que se descarguen.
4. Conecta el iPhone por cable, **desbloquéalo** y pulsa **Confiar** en el aviso "¿Confiar en este ordenador?".
5. Abre [BackupFotos.exe](https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe), elige el iPhone y dónde guardar, y pulsa **Hacer backup**. Las Live Photos se copian como foto (HEIC) + vídeo (MOV) con el mismo nombre.

**Con un Mac**: importa las fotos con la app **Fotos** o **Captura de Imagen** a una carpeta y haz el backup de esa carpeta con la [app web](https://cristianrubio4.github.io/backup-fotos/) en Chrome o Edge.

**Solo con el iPhone (Safari)**: la app web funciona en **modo compatible**: eliges las fotos, la app las analiza y prepara archivos ZIP que guardas en un disco o en Archivos. Safari no entrega el vídeo de las Live Photos ni deja guardar directamente en un disco, así que es la opción más limitada.

## Funciones

| | |
|---|---|
| **Copia** | En streaming desde varios Workers; verificación releyendo la copia (SHA-256); una carpeta por copia (`Móvil - AAAA-MM-DD HHhMM`, con todo dentro) o año/mes por fecha EXIF; nombre con fecha; pausa, reanudar, cancelar; Wake Lock; batería (aviso < 20 %, pausa < 10 %) |
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

## Programa para Windows (`desktop/`)

C# / .NET 8 (WinForms). Acceso al móvil con Windows Portable Devices (MTP) mediante [MediaDevices](https://github.com/Bassman2/MediaDevices); fecha de captura con MetadataExtractor.

```
desktop/BackupFotos.Core/   recorrido completo, copia a .part + SHA-256, verificación releyendo, registro compatible con la web
desktop/BackupFotos.App/    ventana, móvil por MTP, aviso al conectar un USB, el PC no se suspende durante la copia
desktop/BackupFotos.Tests/  xUnit: móvil simulado (carpetas anidadas, ilegibles, desconexión, cancelación) y tests/fixtures/set
```

`.github/workflows/desktop.yml` lo prueba y compila en un Windows de GitHub y publica `BackupFotos.exe` (un solo archivo, sin instalar .NET) en **Releases** con cada cambio en `desktop/`.

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
