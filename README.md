# Backup de fotos

Aplicación web (PWA) para hacer copias de seguridad de fotos y vídeos en un disco externo, **100 % en el navegador**: sin servidor, sin instalar nada y sin que ninguna foto ni dato salga del dispositivo.

**Prioridad absoluta: no perder ninguna foto.** Ante la duda se copia y se avisa; nunca se descarta ni se borra nada en silencio, y las carpetas de origen solo se tocan en "Liberar espacio", con confirmación explícita.

**App web:** https://cristianrubio4.github.io/backup-fotos/
**Programa para Windows (móvil por cable):** [descargar BackupFotos.exe](https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe)

## Guía paso a paso

### Qué obtienes

Cada backup crea en el disco **una sola carpeta** con el nombre del móvil y la fecha y hora, y dentro **todas** sus fotos y vídeos, verificados, con **la misma estructura de carpetas y los mismos nombres que en el móvil**:

```
Galaxy S23 - 2026-10-20 10h15/
  .backup-ignore/                                  ← registro de la copia (no lo borres)
  Memoria interna/DCIM/Camera/IMG_20240714_182205.jpg
  Memoria interna/Pictures/Screenshots/Screenshot_01.png
  Memoria interna/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA0001.jpg
```

- Cada archivo se relee del disco y se compara con el original (SHA-256). Una foto a medias nunca aparece con su nombre.
- En el móvil **no se borra ni se cambia nada**.
- Las fotos **HEIC** del iPhone se guardan como **JPG** (opción de Ajustes; ver más abajo).
- Una foto repetida en dos carpetas del móvil se copia en las dos: cada carpeta queda completa.

### Antes de empezar (solo la primera vez)

1. **Disco de destino.** Un disco externo, un pendrive o una carpeta del PC. Para vídeos de más de 4 GB, el disco debe estar en **exFAT** (no FAT32): Explorador → clic derecho en el disco → Formatear → exFAT. *Formatear borra el disco.*
2. **Abre la app web** en Chrome o Edge: https://cristianrubio4.github.io/backup-fotos/ (opcional: icono de instalar en la barra de direcciones, para tenerla como app).
3. **Dónde guardar → Añadir** y elige el disco o la carpeta.
4. Si vas a copiar un móvil **por cable** (o por Enlace móvil), descarga **[BackupFotos.exe](https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe)**: no se instala, es un solo archivo. Si Windows avisa de que es desconocido (no está firmado): **Más información → Ejecutar de todas formas**.

> **¿Por qué BackupFotos.exe?** Windows no deja que un navegador recorra un móvil conectado por cable: al elegirlo como carpeta solo entrega unas pocas fotos recientes. El programa lee el móvil entero (como el Explorador) y se lo pasa a la web, que hace todo lo demás con su interfaz de siempre. Solo responde a esta web y solo desde el propio PC (127.0.0.1). **No hay que pulsar nada en él**: basta con que esté abierto (su recuadro verde dice "Conector para la web activo").

### Android

**A. Por cable, con un PC con Windows (lo más rápido)**

1. Abre **BackupFotos.exe** y déjalo abierto.
2. Conecta el móvil por cable y **desbloquéalo**. En el aviso USB del móvil elige **Transferencia de archivos** (o "Archivos" / "MTP").
3. En la web: **Fotos que copiar → Móvil por cable** → **Añadir** junto a tu móvil (el que **no** pone "Enlace móvil"). Si el navegador pregunta si la web puede acceder a dispositivos de la red local, pulsa **Permitir** (es el programa, en tu propio PC).
4. Si tenías añadida antes una carpeta del móvil con **Añadir** (por ejemplo `storage`), **quítala**: es la vía lenta que solo ve unas pocas fotos.
5. Decide si incluir la carpeta **Sent** de WhatsApp (casilla bajo "Fotos que copiar"; el botón **?** dice qué contiene, cuánto ocupa en ese móvil y cuánto tiempo añade).
6. Pulsa **Hacer backup**. Mantén el móvil desbloqueado hasta que termine (sube el tiempo de bloqueo de pantalla a 10 min o más).

La próxima vez: abre el programa, conecta el móvil y pulsa **Hacer backup**. El móvil queda recordado.

**B. Sin cable, por Enlace móvil (wifi, más lento)**

1. Ten el móvil enlazado con **Enlace móvil / Enlace a Windows** (aparece en el Explorador, en "Dispositivos móviles"). En el móvil, la app **Enlace a Windows** activada y con permiso para los archivos.
2. Abre **BackupFotos.exe**.
3. En la web: **Fotos que copiar → Móvil por cable** → **Añadir** junto a `Nombre · Enlace móvil (wifi)`.
4. **Hacer backup**. Si Windows avisa de que "no se pueden transferir archivos", usa el cable.

**C. Desde fuera de casa, por internet (Móvil ↔ PC)**

El PC se queda en casa; el móvil puede estar en cualquier sitio con internet (no hace falta la misma wifi).

En el **PC de casa** (una vez, antes de salir):
1. Conecta el disco y abre la web → **Móvil ↔ PC** → **Recibir del móvil** (concede el permiso del disco).
2. Deja **la pestaña abierta** y el PC **sin suspenderse**: Windows → Configuración → Sistema → Energía → *Suspender: nunca* (al menos con el cargador).
3. La primera vez aparece un **código QR**.

En el **móvil** (Android, con Chrome):
1. **Emparejar (solo la primera vez):** abre la cámara, apunta al QR del PC y abre el enlace en Chrome. El móvil queda emparejado con ese PC.
2. **Inicio → Fotos que copiar → Añadir**: elige `DCIM` y, si quieres, `Pictures`, `Android/media/com.whatsapp/WhatsApp/Media`… (Android no deja elegir la raíz de la memoria).
3. **Móvil ↔ PC → Copiar en [tu PC]**. Verás el porcentaje, la velocidad y el tiempo restante. Mantén la pantalla encendida y la pestaña abierta.
4. Si se corta, vuelve a pulsar **Copiar**: continúa donde se quedó.

Las fotos van **directas y cifradas** del móvil al PC (WebRTC); el servidor público de PeerJS solo sirve para que los dos aparatos se encuentren. Solo el móvil emparejado (con la clave del QR) puede enviar. Algunas redes móviles no permiten la conexión directa: prueba desde una wifi. Con datos móviles, miles de fotos son muchos GB.

**D. Solo con el móvil (sin PC)**

1. Abre la web en **Chrome** (versión 132 o posterior).
2. **Fotos que copiar → Añadir**: `DCIM` y las demás carpetas que quieras.
3. **Dónde guardar → Añadir**: un disco o pendrive conectado por USB-OTG, o una carpeta de la tarjeta SD.
4. **Hacer backup**.

### iPhone

**A. Por cable, con un PC con Windows**

1. Instala **Dispositivos Apple** (Microsoft Store) o iTunes: traen el controlador para que Windows vea el iPhone.
2. En el iPhone: **Ajustes → Fotos → Transferir a Mac o PC → Mantener originales**.
3. Si usas iCloud con **Optimizar almacenamiento**, cambia a **Descargar y conservar originales** (Ajustes → [tu nombre] → iCloud → Fotos) y espera a que se descarguen: si no, solo hay versiones reducidas.
4. Conecta el iPhone, **desbloquéalo** y pulsa **Confiar**.
5. Abre **BackupFotos.exe**. En la web: **Fotos que copiar → Móvil por cable → Añadir** junto al iPhone → **Hacer backup**.
6. Las HEIC se guardan como JPG (si la opción está activada) y las Live Photos como foto + vídeo con el mismo nombre.

**B. Con un Mac:** importa las fotos con **Fotos** o **Captura de Imagen** a una carpeta y haz el backup de esa carpeta con la web en Chrome o Edge.

**C. Solo con el iPhone (Safari):** modo compatible: eliges las fotos y la app prepara archivos ZIP que guardas en un disco o en Archivos. Es la opción más limitada (Safari no entrega el vídeo de las Live Photos). *Móvil ↔ PC no está disponible en iPhone.*

### Durante la copia

- La pantalla de progreso muestra el porcentaje, la velocidad, el tiempo restante y **qué está haciendo cada archivo en marcha** (se copian 4 a la vez): *leyendo del origen*, *convirtiendo a JPG*, *escribiendo en el disco*, *verificando*.
- **"● Trabajando"** = está activa. **"Última actividad: hace X s"** = lleva ese tiempo sin moverse (en naranja a partir de 30 s). Un vídeo grande puede tardar en empezar: el programa lo lee entero del móvil antes de enviarlo.
- Si pasa **minuto y medio** sin actividad, aparece un aviso rojo: mira la línea **"Ahora"** de la ventana de BackupFotos.exe (si no cambia, el móvil ha dejado de responder: desbloquéalo o reconecta el cable).
- Si la copia va lenta, la web avisa y dice por qué (por ejemplo, si estás copiando por Enlace móvil en vez de por cable). En el programa, la línea "Ahora" muestra la **velocidad real de lectura del móvil** y los ms por archivo.
- Puedes **pausar** y **cancelar**. Lo copiado queda guardado y verificado.

### Al terminar

1. Lee el **informe**: copiados, repetidos, errores (lo que no se pudo copiar sigue en el móvil) y en cuántas carpetas se ha buscado.
2. Pulsa **Copiados** para ver la galería (filtros Todo / Fotos / Vídeos; toca una para verla a pantalla completa).
3. Opcional: **Descargar el informe (CSV)**, una fila por archivo.
4. Abre algunas fotos de la carpeta en el disco para comprobar que se ven bien.

### Si se corta (o lo cancelas)

En **Inicio** aparece **Continuar la copia**: sigue en la **misma carpeta** y salta al instante lo ya copiado, sin volver a leerlo del móvil. Si una foto quedó escrita entera justo al cortar, se comprueba y se da por buena.

### Copias siguientes

- **Por defecto**, cada backup es **completo e independiente** (una carpeta nueva con todas las fotos).
- Con **Ajustes → "Solo lo nuevo en cada copia"**, cada carpeta nueva lleva solo lo que no esté ya en otra copia del disco; lo ya guardado ni se lee. Las copias siguientes tardan muy poco.
- Para sustituir una copia antigua: haz la nueva, compruébala y **solo entonces** borra la carpeta antigua.

### Opciones (Ajustes → Estructura en el disco)

| Opción | Qué hace |
|---|---|
| Una carpeta completa por cada copia / Un solo backup por fecha | Carpeta "móvil - fecha hora" por backup (por defecto), o un único backup que crece en carpetas año/mes. |
| Misma estructura de carpetas que en el móvil | Reproduce DCIM/Camera, Pictures/Screenshots… con los nombres originales (por defecto). |
| Solo lo nuevo en cada copia | Salta lo que ya está en otra copia del disco. |
| Guardar las fotos HEIC (iPhone) como JPG | JPG a resolución completa y calidad alta, con fecha, cámara y ubicación; cada JPG se comprueba (se abre, mide lo mismo y se ve igual). Si alguna no se puede convertir bien, se guarda en HEIC. Solo queda el JPG. |
| Copiar también lo enviado por WhatsApp | Carpetas Sent (también como casilla en Inicio, con el botón **?**). Los stickers, audios, notas de voz, documentos y fondos de WhatsApp no se copian. |
| Separar por dispositivo | Añade una subcarpeta con el nombre del dispositivo. |

### Ver fotos HEIC en Windows

Si alguna se guardó en HEIC: instala gratis en Microsoft Store las **Extensiones de imagen HEIF** y las **Extensiones de vídeo HEVC del fabricante del dispositivo** (`ms-windows-store://pdp/?ProductId=9n4wgh0z6vhq`, la versión gratuita), o usa un visor gratuito como **ImageGlass** o **XnView MP**. En la web (Explorar y Copiados) se ven siempre.

### Problemas frecuentes

| Qué pasa | Por qué | Qué hacer |
|---|---|---|
| Solo copia unas pocas fotos (p. ej. 6 de WhatsApp) | Se eligió el móvil como carpeta (`storage`, de Enlace a Windows): Windows solo entrega unas pocas | Quita ese origen y usa **Móvil por cable** con BackupFotos.exe |
| "Enlace a Windows está desactivado" / "No se pueden transferir archivos" | Aviso de Windows al leer por Enlace a Windows | Usa el cable con BackupFotos.exe, o activa Enlace a Windows en el móvil |
| Va muy lento (KB/s) | Copiando por wifi (Enlace móvil), cable de carga, puerto USB 2 | Cable original, puerto USB 3 (azul), el móvil "por cable" (sin "Enlace móvil") |
| "Ya se llamó a la función de apagado…" | Corte momentáneo con el móvil (pantalla bloqueada, mal contacto) | El programa reconecta y reintenta solo; mantén el móvil desbloqueado |
| El móvil no aparece en "Móvil por cable" | El móvil no está en modo transferencia o el programa no está abierto | Desbloquéalo, elige "Transferencia de archivos" y abre BackupFotos.exe |
| Móvil ↔ PC: "el PC no responde" | La web del PC no está en "Recibir del móvil", el PC se ha suspendido o no tiene internet | Activa "Recibir del móvil" en el PC y desactiva la suspensión |
| Las HEIC no se abren | Windows no trae el lector de HEIC | Activa "Guardar las fotos HEIC como JPG" o instala las extensiones (arriba) |
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

**Conector para la web** (`ConnectorServer`): mientras el programa está abierto escucha en `http://127.0.0.1:47613` (solo este PC) y solo atiende a los orígenes de la web (`Origin` comprobado, CORS y `Access-Control-Allow-Private-Network`). `GET /v1/info` (móviles conectados), `GET /v1/scan?device=` (recorrido completo en NDJSON según avanza) y `GET /v1/file?device=&path=` (contenido, con caché temporal en disco para no leer dos veces del cable). La web lo usa desde `src/platform/connector.ts`; la CSP solo permite esa dirección además de la propia web.

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
