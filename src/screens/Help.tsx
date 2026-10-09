import type { ReactNode } from 'react'
import { Card } from '../components/ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{children}</div>
    </Card>
  )
}

export function HelpScreen() {
  return (
    <>
      <Section title="Cómo funciona">
        <p>
          La app recorre la carpeta de fotos, calcula una huella (hash SHA-256) de cada archivo y copia al disco solo lo que aún no está.
          Las copias se ordenan en carpetas <b>año/mes</b> según la fecha de la foto (EXIF); si no la tiene, la fecha del archivo; y si
          tampoco es fiable, van a <b>Sin fecha</b>.
        </p>
        <p>
          Cada copia se relee del disco y se compara con el original. En la raíz del disco se guarda <code>.backup-manifest.json</code>,
          el registro de todo lo copiado, con una copia de seguridad en <code>.backup-manifest.bak</code>. No los borres.
        </p>
        <p>Nunca se borra ni se modifica nada en la carpeta de origen.</p>
      </Section>

      <Section title="Qué se descarta (y qué nunca)">
        <p>
          Antes de copiar, cada archivo se analiza. Se descartan los <b>dañados</b> (cabecera no válida, contenido todo ceros, JPEG/PNG o vídeo
          cortado, imágenes que no se pueden abrir), las imágenes <b>vacías</b> (negras, blancas o de un solo color) y las{' '}
          <b>demasiado pequeñas</b>. Los filtros de fotos borrosas y vídeos cortos están desactivados por defecto. Todo se ajusta en Ajustes.
        </p>
        <p>
          Lo descartado <b>nunca se borra</b> del origen y aparece en el informe con su miniatura y el botón <b>Copiar igualmente</b>.
        </p>
        <p>
          Lo que no se puede comprobar no se descarta: se copia marcado como <b>no verificado</b>. Es el caso de formatos que el navegador no
          abre (RAW, algunos vídeos HEVC) o de una foto HEIC que no se ha podido decodificar.
        </p>
      </Section>

      <Section title="iPhone: HEIC y Live Photos">
        <p>
          Las fotos HEIC se comprueban con un decodificador incluido en la app (libheif), que se carga solo cuando aparece la primera HEIC.
          Las <b>Live Photos</b> (foto + vídeo corto con el mismo nombre, p. ej. IMG_1234.HEIC e IMG_1234.MOV) se copian juntas, con el mismo
          nombre y en la misma carpeta, y su vídeo nunca se descarta por corto.
        </p>
        <p>
          Las <b>Motion Photos</b> de Android llevan el vídeo dentro del propio JPEG: se copian tal cual, con el vídeo incluido.
        </p>
      </Section>

      <Section title="Fotos que solo están en la nube">
        <p>
          Con "Optimizar almacenamiento" (iCloud) o "Liberar espacio" (Google Fotos), el móvil puede guardar solo una versión reducida y dejar
          el original en la nube. La app lo detecta cuando la resolución real es mucho menor que la que indica el EXIF, copia la foto marcada
          como <b>posible versión reducida</b> y te avisa.
        </p>
        <ul className="list-disc pl-5">
          <li>iPhone: Ajustes → [tu nombre] → iCloud → Fotos → "Descargar y conservar originales".</li>
          <li>Google Fotos: abre la foto y usa "Descargar" para tener el original en el dispositivo.</li>
        </ul>
        <p>Después, vuelve a hacer el backup: el original se copiará como un archivo nuevo.</p>
      </Section>

      <Section title="Fecha de los archivos">
        <p>
          Los navegadores no permiten conservar la fecha original de un archivo al copiarlo: en el disco aparecerá la fecha de la copia.
          Para no perderla, la fecha va en el nombre (<code>2026-10-09_143022_IMG_0001.jpg</code>) y en el manifest. Las fotos con EXIF
          conservan además su fecha de captura dentro del propio archivo.
        </p>
      </Section>

      <Section title="Tus fotos siguen siendo archivos normales">
        <p>
          El disco contiene fotos y vídeos normales en carpetas: puedes abrirlos desde cualquier ordenador sin esta app. (Si en el futuro
          activas el cifrado, eso cambiará para ese disco.)
        </p>
      </Section>

      <Section title="Si se corta el backup">
        <p>
          Si el disco se desconecta durante el backup, la app se pone en pausa y <b>continúa sola</b> en cuanto vuelves a conectar el mismo
          disco (lo reconoce por el archivo <code>.backup-disk-id</code>). Si conectas otro disco, te avisa y sigue esperando.
        </p>
        <p>
          Si se cierra la pestaña o cancelas, vuelve a pulsar <b>Hacer backup</b>: continuará donde se quedó sin duplicar nada. Un archivo a
          medio copiar nunca queda en el disco: solo aparece cuando está completo.
        </p>
        <p>
          En Windows, si al volver a enchufar el disco recibe otra letra (p. ej. E: en vez de D:), el navegador no lo encuentra: elige otra vez
          la carpeta de backup en Inicio.
        </p>
      </Section>

      <Section title="Pantalla y batería">
        <p>
          Durante el backup la app mantiene la pantalla encendida (si el navegador lo permite). Mantén la pestaña abierta y en primer plano.
        </p>
        <p>
          En móviles y portátiles, si la batería está por debajo del 20 % la app avisa antes de empezar, y si baja del 10 % durante el backup lo
          pone en pausa. Con el disco conectado al móvil por USB (OTG) el móvil normalmente <b>no se carga</b>; para cargar a la vez necesitas
          un hub USB con alimentación.
        </p>
      </Section>

      <Section title="Formato del disco">
        <p>
          Los discos en <b>FAT32</b> no admiten archivos de más de 4 GB (vídeos largos). Para un disco de backup se recomienda{' '}
          <b>exFAT</b>, que funciona en Windows y macOS. Formatear borra el disco: hazlo antes de copiar nada.
        </p>
        <ul className="list-disc pl-5">
          <li>Windows: Explorador → clic derecho en el disco → Formatear → Sistema de archivos: exFAT.</li>
          <li>macOS: Utilidad de Discos → seleccionar el disco → Borrar → Formato: ExFAT.</li>
        </ul>
      </Section>

      <Section title="Regla 3-2-1">
        <p>
          Ten <b>3</b> copias de tus fotos, en <b>2</b> soportes distintos, y <b>1</b> fuera de casa. Un solo disco externo puede fallar,
          perderse o estropearse: lo ideal es rotar dos discos y guardar uno en otro sitio.
        </p>
      </Section>

      <Section title="Navegadores compatibles">
        <p>
          Esta versión necesita <b>Chrome o Edge de escritorio</b>, que permiten escribir en carpetas del disco. Safari, iPhone y Firefox
          no lo permiten; para ellos habrá un modo compatible con archivos ZIP. Tampoco es posible saber desde el navegador cuánto espacio
          libre tiene el disco: si se llena, el backup se detiene y avisa.
        </p>
      </Section>
    </>
  )
}
