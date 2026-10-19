import { useState } from 'react'
import { EncryptionCard } from '../components/EncryptionCard'
import { Bell, Copy, Filter, FolderTree, Smartphone } from 'lucide-react'
import { Button, Card, PageHeader, Toggle } from '../components/ui'
import { runFolderName } from '../core/naming'
import { DEFAULT_FILTERS, type FilterSettings } from '../core/settings'
import { useApp } from '../state/app'

export function SettingsScreen() {
  const { settings, device, saveSettings, saveDevice } = useApp()
  const [name, setName] = useState(device.name)

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Se guardan en este navegador" />
      <Card title="Este dispositivo" icon={Smartphone}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre</span>
          <input
            className="field w-full"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveDevice({ ...device, name: name.trim() })}
            placeholder="Móvil de Ana, Portátil…"
          />
        </label>
        <p className="mt-1 text-xs text-muted">Se guarda en el registro del disco junto a cada foto copiada.</p>
      </Card>

      <Card title="Copia" icon={Copy}>
        <Toggle
          label="Verificar cada archivo releyéndolo del disco"
          hint="Compara el hash SHA-256 de la copia con el original. Tarda más, pero garantiza que la copia es exacta. Recomendado."
          checked={settings.verifyHash}
          onChange={(v) => saveSettings({ ...settings, verifyHash: v })}
        />
        <Toggle
          label="Añadir la fecha al nombre del archivo"
          hint="2026-10-09_143022_IMG_0001.jpg. El navegador no puede conservar la fecha original del archivo, así que queda en el nombre y en el manifest."
          checked={settings.dateInName}
          onChange={(v) => saveSettings({ ...settings, dateInName: v })}
        />
        <label className="flex items-center justify-between gap-4 py-2 text-sm">
          <span>
            <span className="block font-medium">Guardar el progreso cada</span>
            <span className="block text-xs text-muted">Si se corta, se reanuda sin repetir lo ya registrado.</span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              className="w-20 field py-1"
              value={settings.saveEvery}
              onChange={(e) => {
                const n = Math.max(1, Math.min(500, Number(e.target.value) || 1))
                void saveSettings({ ...settings, saveEvery: n })
              }}
            />
            archivos
          </span>
        </label>
      </Card>

      <Card title="Estructura en el disco" icon={FolderTree}>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="radio" name="runFolder" className="accent-[var(--accent)]" checked={settings.runFolder} onChange={() => saveSettings({ ...settings, runFolder: true })} />
          Una carpeta completa por cada copia: <code className="text-xs">{runFolderName(new Date(), 'iPhone 15 Pro')}/…</code>
        </label>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="radio" name="runFolder" className="accent-[var(--accent)]" checked={!settings.runFolder} onChange={() => saveSettings({ ...settings, runFolder: false })} />
          Un solo backup por fecha, solo lo nuevo: <code className="text-xs">2026/10/…</code>
        </label>
        {settings.runFolder && (
          <>
            <Toggle
              label="Misma estructura de carpetas que en el móvil"
              hint="Dentro de la carpeta de la copia: Pictures/Screenshots/captura.png, DCIM/Camera/IMG_1234.jpg… con los nombres originales. Si se desactiva, todo va junto con la fecha delante del nombre."
              checked={settings.keepStructure}
              onChange={(v) => saveSettings({ ...settings, keepStructure: v })}
            />
            <Toggle
              label="Solo lo nuevo en cada copia"
              hint="Cada carpeta nueva lleva solo las fotos que no estén ya en otra copia de este disco. Lo ya guardado se salta al instante, sin leerlo del móvil: las copias siguientes tardan muy poco."
              checked={settings.onlyNew}
              onChange={(v) => saveSettings({ ...settings, onlyNew: v })}
            />
          </>
        )}
        <Toggle
          label="Separar por dispositivo"
          hint={`Añade una carpeta con el nombre del dispositivo (${device.name || 'Móvil de Ana'}).`}
          checked={settings.layout === 'per-device'}
          onChange={(v) => saveSettings({ ...settings, layout: v ? 'per-device' : 'together' })}
        />
        <p className="mt-1 text-xs text-muted">
          <b>Una carpeta por copia:</b> cada backup crea una sola carpeta con el nombre del móvil (leído de las propias fotos; si no se sabe,
          "Copia") y el día y la hora, y guarda dentro <b>todas</b> las fotos elegidas y su registro. No se escribe nada más en el destino. Cada
          copia es completa e independiente, así que ocupa más espacio.
          <br />
          <b>Por fecha:</b> un único backup que crece: solo se copia lo que aún no está en el disco, en carpetas año/mes. Permite comprobar el
          disco y liberar espacio desde Herramientas.
        </p>
      </Card>

      <Card title="Recordatorios" icon={Bell}>
        <NumberField label="Avisar si un disco lleva sin backup más de" value={settings.staleDays} min={1} max={365} unit="días" onChange={(n) => saveSettings({ ...settings, staleDays: n })} />
        <NumberField label="Recordar comprobar la integridad cada" value={settings.integrityMonths} min={1} max={36} unit="meses" onChange={(n) => saveSettings({ ...settings, integrityMonths: n })} />
      </Card>

      <FiltersCard />

      <EncryptionCard />
    </>
  )
}

function NumberField({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 pb-2 pl-6 text-xs text-muted first:pl-0">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          className="w-20 field py-1"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
          }}
        />
        {unit}
      </span>
    </label>
  )
}

function FiltersCard() {
  const { settings, saveSettings } = useApp()
  const f = settings.filters
  const set = (patch: Partial<FilterSettings>) => void saveSettings({ ...settings, filters: { ...f, ...patch } })
  const reset = () => void saveSettings({ ...settings, filters: DEFAULT_FILTERS })

  return (
    <Card title="Descartar archivos que no sirven" icon={Filter} actions={<Button variant="ghost" onClick={reset}>Valores por defecto</Button>}>
      <p className="mb-2 text-xs text-muted">
        Lo descartado no se copia, pero <b>nunca se borra del origen</b> y aparece en el informe con la opción "Copiar igualmente". Lo que no se
        puede comprobar (formatos que el navegador no abre) se copia siempre, marcado como "no verificado".
      </p>
      <Toggle label="Archivos dañados" hint="Cabecera no válida, contenido todo ceros, JPEG/PNG/vídeo cortado, o que no se pueden abrir." checked={f.corrupt} onChange={(v) => set({ corrupt: v })} />
      <Toggle label="Imágenes vacías" hint="Casi totalmente negras, blancas o de un solo color." checked={f.empty} onChange={(v) => set({ empty: v })} />
      {f.empty && <NumberField label="Tolerancia (variación máxima)" value={f.emptyMaxStd} min={1} max={30} unit="/255" onChange={(n) => set({ emptyMaxStd: n })} />}
      <Toggle label="Imágenes demasiado pequeñas" hint="Iconos, miniaturas, stickers…" checked={f.small} onChange={(v) => set({ small: v })} />
      {f.small && <NumberField label="Lado menor mínimo" value={f.minSide} min={16} max={2000} unit="px" onChange={(n) => set({ minSide: n })} />}
      <Toggle label="Imágenes muy borrosas" hint="Desactivado por defecto: una foto movida puede ser la única de un momento." checked={f.blurry} onChange={(v) => set({ blurry: v })} />
      {f.blurry && <NumberField label="Nitidez mínima (más alto = más estricto)" value={f.blurThreshold} min={1} max={500} unit="" onChange={(n) => set({ blurThreshold: n })} />}
      <Toggle label="Vídeos demasiado cortos" hint="Nunca se aplica al vídeo de una Live Photo." checked={f.shortVideo} onChange={(v) => set({ shortVideo: v })} />
      {f.shortVideo && <NumberField label="Duración mínima" value={f.minVideoSeconds} min={0.1} max={30} step={0.1} unit="s" onChange={(n) => set({ minVideoSeconds: n })} />}
      <Toggle
        label="Comprobar fotos HEIC (iPhone) decodificándolas"
        hint="Más lento (≈1 s por foto la primera vez), pero permite marcarlas como verificadas. Si se desactiva, se copian como &quot;no verificado&quot;."
        checked={f.heifDecode}
        onChange={(v) => set({ heifDecode: v })}
      />
      <Toggle label="Avisar de posibles versiones reducidas" hint="Fotos con mucha menos resolución de la que indica su EXIF (originales en la nube). Se copian igualmente." checked={f.reduced} onChange={(v) => set({ reduced: v })} />
    </Card>
  )
}
