// Genera la guía de uso en PDF con capturas reales de la app.
// Se ejecuta en GitHub Actions (ver .github/workflows/deploy.yml), no en local:
//   1. sirve una compilación de la app (dist-guide) con los archivos de prueba,
//   2. la usa con datos de demostración (carpetas del sistema de archivos privado del navegador),
//   3. hace capturas de cada pantalla,
//   4. imprime docs/guia/guia.html a PDF.
//
//   node scripts/guide/make-guide.mjs <salida.pdf>

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = path.resolve(process.argv[2] ?? 'guia-de-uso.pdf')
const dist = path.join(root, 'dist-guide')
const imgDir = path.join(root, 'docs', 'guia', 'img')
const PORT = 4179
const APP = `http://localhost:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- Archivos de prueba dentro de la compilación ----
const fixturesSrc = path.join(root, 'tests', 'fixtures', 'set')
const fixturesDst = path.join(dist, '__fixtures')
fs.cpSync(fixturesSrc, fixturesDst, { recursive: true })
const list = fs.readdirSync(fixturesDst, { recursive: true }).filter((f) => fs.statSync(path.join(fixturesDst, f)).isFile()).map((f) => f.split(path.sep).join('/'))
fs.writeFileSync(path.join(fixturesDst, 'list.json'), JSON.stringify(list))
fs.mkdirSync(imgDir, { recursive: true })
fs.copyFileSync(path.join(root, 'public', 'favicon.svg'), path.join(imgDir, 'logo.svg'))

// ---- Servidor de la app ----
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', 'dist-guide', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'inherit' })
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(APP)).ok) break
  } catch {}
  await sleep(500)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'es-ES' })
const page = await context.newPage()
page.setDefaultTimeout(180_000)
page.on('console', (m) => m.type() === 'error' && console.log('[consola]', m.text()))

const main = page.locator('main')
const waitText = (t) => main.getByText(t, { exact: false }).first().waitFor()
const click = (t, scope = 'main') => page.locator(`${scope} button`, { hasText: t }).first().click()
const nav = (t) => click(t, 'aside nav')
const shot = async (name, locator) => {
  const file = path.join(imgDir, `${name}.png`)
  if (locator) {
    await locator.scrollIntoViewIfNeeded()
    await sleep(300)
    await locator.screenshot({ path: file })
  } else await page.screenshot({ path: file })
  console.log('captura', name)
}

await page.goto(APP)
await sleep(1500)

// ---- Datos de demostración ----
await page.evaluate(async () => {
  localStorage.setItem('theme', 'light')
  const opfs = await navigator.storage.getDirectory()
  async function put(root, rel, blob) {
    const parts = rel.split('/')
    let d = root
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true })
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable()
    await w.write(blob)
    await w.close()
  }
  const cam = await opfs.getDirectoryHandle('Camara', { create: true })
  const wa = await opfs.getDirectoryHandle('WhatsApp', { create: true })
  const list = await (await fetch('/__fixtures/list.json')).json()
  for (const rel of list) await put(cam, rel, await (await fetch('/__fixtures/' + encodeURI(rel))).blob())
  await put(wa, 'IMG-20250101-WA0001.jpg', await (await fetch('/__fixtures/DCIM/IMG_0002.jpg')).blob())
  const disks = []
  for (const [key, dir, name] of [['k1', 'disco-casa', 'Disco de casa'], ['k2', 'disco-oficina', 'Disco de la oficina']]) {
    const d = await opfs.getDirectoryHandle(dir, { create: true })
    const id = crypto.randomUUID()
    const w = await (await d.getFileHandle('.backup-disk-id', { create: true })).createWritable()
    await w.write(JSON.stringify({ id, name, createdAt: new Date().toISOString() }))
    await w.close()
    disks.push({ key, diskId: id, name, handle: d, addedAt: new Date(Date.now() + disks.length).toISOString() })
  }
  const db = await new Promise((res) => {
    const r = indexedDB.open('backup-fotos')
    r.onsuccess = () => res(r.result)
  })
  const tx = db.transaction(['disks', 'kv', 'sources'], 'readwrite')
  for (const d of disks) tx.objectStore('disks').put(d)
  const t = Date.now()
  tx.objectStore('sources').put({ key: 's1', name: 'Cámara', handle: cam, addedAt: new Date(t).toISOString() })
  tx.objectStore('sources').put({ key: 's2', name: 'WhatsApp', handle: wa, addedAt: new Date(t + 1).toISOString() })
  tx.objectStore('kv').put('k2', 'activeDisk')
  tx.objectStore('kv').put({ id: crypto.randomUUID(), name: 'Portátil de Ana' }, 'device')
  await new Promise((r) => (tx.oncomplete = r))
  db.close()
})
await page.reload()
await waitText('Dónde guardar')
await sleep(4000)

// Primer backup (disco de la oficina)
await click('Hacer backup')
await waitText('Informe del backup')

// Vídeos grandes para capturar el progreso a mitad
await page.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory()
  const dcim = await (await opfs.getDirectoryHandle('Camara')).getDirectoryHandle('DCIM')
  for (let i = 0; i < 3; i++) {
    const b = new Uint8Array(180 * 1024 * 1024)
    for (let o = 0; o < b.length; o += 1048576) crypto.getRandomValues(b.subarray(o, o + 1024))
    const w = await (await dcim.getFileHandle(`VID_2025080${i}_vacaciones.mp4`, { create: true })).createWritable()
    await w.write(b)
    await w.close()
  }
})
await nav('Inicio')
await waitText('Dónde guardar')
await sleep(1000)
await click('Usar este')
await click('Hacer backup')
await page.waitForFunction(() => {
  const t = document.querySelector('main')?.innerText ?? ''
  const m = t.match(/(\d+)%/)
  return m && +m[1] >= 30 && /Copiando|Verificando/.test(t)
}, null, { polling: 100 })
await shot('progreso', page.locator('main section.card').first())
await waitText('Informe del backup')
await sleep(1000)
await shot('informe')
await shot('informe-descartados', page.locator('main section', { hasText: 'Copiar todos igualmente' }).first())

await nav('Inicio')
await waitText('Dónde guardar')
await sleep(1500)
await shot('inicio')
await click('¿Fotos de un móvil conectado por USB?')
await sleep(500)
await shot('movil-usb', page.locator('main section', { hasText: 'Fotos que copiar' }).first())

await nav('Explorar')
await waitText('Explorar el backup')
await sleep(4000)
await shot('explorar')

await nav('Herramientas')
await waitText('Comprobar disco')
await page.locator('main button', { hasText: /^Comprobar disco$/ }).first().click()
await waitText('Todo correcto')
await sleep(500)
await shot('herramientas')

await nav('Ajustes')
await waitText('Descartar archivos')
await sleep(600)
await shot('ajustes-filtros', page.locator('main section', { hasText: 'Descartar archivos que no sirven' }).first())

// ---- Móvil (mismo contexto, para conservar los datos de demostración) ----
await page.setViewportSize({ width: 390, height: 844 })
await page.reload()
await waitText('Tus fotos, a salvo')
await sleep(3000)
await shot('movil')

await page.goto(APP + '?compatible')
await waitText('Modo compatible')
await sleep(1500)
await shot('compatible')

// ---- PDF ----
const pdfPage = await browser.newPage()
await pdfPage.goto(pathToFileURL(path.join(root, 'docs', 'guia', 'guia.html')).href, { waitUntil: 'networkidle' })
await pdfPage.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true })
console.log('PDF:', out, Math.round(fs.statSync(out).size / 1024), 'KB')

await browser.close()
server.kill()
process.exit(0)
