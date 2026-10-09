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
          Si se cierra la pestaña, se desconecta el disco o cancelas, vuelve a pulsar <b>Hacer backup</b>: continuará donde se quedó sin
          duplicar nada. Un archivo a medio copiar nunca queda en el disco: solo aparece cuando está completo.
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
