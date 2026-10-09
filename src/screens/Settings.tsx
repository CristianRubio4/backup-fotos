import { useState } from 'react'
import { Card, Toggle } from '../components/ui'
import { useApp } from '../state/app'

export function SettingsScreen() {
  const { settings, device, saveSettings, saveDevice } = useApp()
  const [name, setName] = useState(device.name)

  return (
    <>
      <Card title="Este dispositivo">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre</span>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveDevice({ ...device, name: name.trim() })}
            placeholder="Móvil de Ana, Portátil…"
          />
        </label>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Se guarda en el registro del disco junto a cada foto copiada.</p>
      </Card>

      <Card title="Copia">
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
            <span className="block text-xs text-slate-500 dark:text-slate-400">Si se corta, se reanuda sin repetir lo ya registrado.</span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
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
    </>
  )
}
