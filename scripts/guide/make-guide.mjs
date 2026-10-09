// Genera la guía de uso en PDF con capturas reales de la app.
// Se ejecuta en GitHub Actions (ver .github/workflows/deploy.yml), no en local:
//   1. sirve una compilación de la app (dist-guide) con los archivos de prueba,
//   2. la usa con datos de demostración (carpetas del sistema de archivos privado del navegador),
//   3. hace capturas de cada pantalla (cada una por separado: si una falla, se sigue),
//   4. imprime docs/guia/guia.html a PDF (las figuras sin captura se ocultan).
// Los fallos se publican como anotaciones de GitHub (::warning::).
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
const oneLine = (s) => String(s).replace(/\s+/g, ' ').slice(0, 900)
const failures = []

/** Ejecuta un paso; si falla, lo anota y sigue. */
async function step(name, fn) {
  try {
    await fn()
    console.log(`ok: ${name}`)
    return true
  } catch (err) {
    failures.push(name)
    console.log(`::warning title=Guía: ${name}::${oneLine(err?.message ?? err)}`)
    return false
  }
}

// ---- Archivos de prueba dentro de la compilación ----
const fixturesSrc = path.join(root, 'tests', 'fixtures', 'set')
const fixturesDst = path.join(dist, '__fixtures')
fs.cpSync(fixturesSrc, fixturesDst, { recursive: true })
const list = fs
  .readdirSync(fixturesDst, { recursive: true })
  .filter((f) => fs.statSync(path.join(fixturesDst, f)).isFile())
  .map((f) => f.split(path.sep).join('/'))
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
page.setDefaultTimeout(60_000)
page.on('console', (m) => m.type() === 'error' && console.log('[consola]', m.text()))
page.on('pageerror', (e) => console.log('[error de página]', e.message))

const main = page.locator('main')
const waitText = (t, timeout) => main.getByText(t, { exact: false }).first().waitFor({ timeout })
const click = (t, scope = 'main') => page.locator(`${scope} button`, { hasText: t }).first().click()
const nav = async (t) => {
  await click(t, 'aside nav')
  await sleep(600)
}
const shot = async (name, locator) => {
  const file = path.join(imgDir, `${name}.png`)
  if (locator) {
    await locator.scrollIntoViewIfNeeded()
    await sleep(300)
    await locator.screenshot({ path: file })
  } else await page.screenshot({ path: file })
}

await step('abrir la app', async () => {
  await page.goto(APP)
  await sleep(1500)
  const mode = await page.evaluate(() => ('showDirectoryPicker' in window ? 'completo' : 'compatible'))
  console.log('modo de la app:', mode)
  if (mode !== 'completo') throw new Error('el navegador de las capturas no tiene File System Access')
})

const seeded = await step('datos de demostración', async () => {
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
    // La app crea la base de datos al arrancar; se espera a que esté en su versión actual.
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('backup-fotos')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    if (!db.objectStoreNames.contains('sources')) throw new Error('la base de datos de la app aún no existe: ' + [...db.objectStoreNames].join(','))
    const tx = db.transaction(['disks', 'kv', 'sources'], 'readwrite')
    for (const d of disks) tx.objectStore('disks').put(d)
    const t = Date.now()
    tx.objectStore('sources').put({ key: 's1', name: 'Cámara', handle: cam, addedAt: new Date(t).toISOString() })
    tx.objectStore('sources').put({ key: 's2', name: 'WhatsApp', handle: wa, addedAt: new Date(t + 1).toISOString() })
    tx.objectStore('kv').put('k2', 'activeDisk')
    tx.objectStore('kv').put({ id: crypto.randomUUID(), name: 'Portátil de Ana' }, 'device')
    await new Promise((r, j) => {
      tx.oncomplete = r
      tx.onerror = () => j(tx.error)
    })
    db.close()
  })
  await page.reload()
  await waitText('Dónde guardar')
  await sleep(4000)
})

if (seeded) {
  await step('primer backup', async () => {
    await click('Hacer backup')
    await waitText('Informe del backup', 180_000)
  })

  await step('progreso', async () => {
    await page.evaluate(async () => {
      const opfs = await navigator.storage.getDirectory()
      const dcim = await (await opfs.getDirectoryHandle('Camara')).getDirectoryHandle('DCIM')
      for (let i = 0; i < 3; i++) {
        const b = new Uint8Array(160 * 1024 * 1024)
        for (let o = 0; o < b.length; o += 1048576) crypto.getRandomValues(b.subarray(o, o + 1024))
        const w = await (await dcim.getFileHandle(`VID_2025080${i}_vacaciones.mp4`, { create: true })).createWritable()
        await w.write(b)
        await w.close()
      }
    })
    await nav('Inicio')
    await waitText('Dónde guardar')
    await sleep(800)
    await click('Usar este')
    await sleep(400)
    await click('Hacer backup')
    await page.waitForFunction(
      () => {
        const t = document.querySelector('main')?.innerText ?? ''
        const m = t.match(/(\d+)\s*%/)
        return !!m && +m[1] >= 25 && /Copiando|Verificando/.test(t)
      },
      null,
      { polling: 100, timeout: 120_000 },
    )
    await shot('progreso', page.locator('main section.card').first())
  })

  await step('informe', async () => {
    await waitText('Informe del backup', 240_000)
    await sleep(1000)
    await shot('informe')
    await shot('informe-descartados', page.locator('main section', { hasText: 'Copiar todos igualmente' }).first())
  })

  await step('inicio', async () => {
    await nav('Inicio')
    await waitText('Dónde guardar')
    await sleep(1500)
    await shot('inicio')
  })

  await step('móvil por USB', async () => {
    await click('¿Fotos de un móvil conectado por USB?')
    await sleep(500)
    await shot('movil-usb', page.locator('main section', { hasText: 'Fotos que copiar' }).first())
  })

  await step('explorar', async () => {
    await nav('Explorar')
    await waitText('Explorar el backup')
    await sleep(4000)
    await shot('explorar')
  })

  await step('herramientas', async () => {
    await nav('Herramientas')
    await waitText('Comprobar disco')
    await page.locator('main button', { hasText: /^Comprobar disco$/ }).first().click()
    await waitText('Todo correcto', 120_000)
    await sleep(500)
    await shot('herramientas')
  })

  await step('ajustes', async () => {
    await nav('Ajustes')
    await waitText('Descartar archivos')
    await sleep(600)
    await shot('ajustes-filtros', page.locator('main section', { hasText: 'Descartar archivos que no sirven' }).first())
  })

  await step('móvil', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await waitText('Tus fotos, a salvo')
    await sleep(3000)
    await shot('movil')
  })
}

await step('modo compatible', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(APP + '?compatible')
  await waitText('Modo compatible')
  await sleep(1500)
  await shot('compatible')
})

// ---- PDF (siempre) ----
const pdfPage = await browser.newPage()
await pdfPage.goto(pathToFileURL(path.join(root, 'docs', 'guia', 'guia.html')).href, { waitUntil: 'load' })
await sleep(800)
// Las figuras cuya captura no se ha podido hacer se ocultan.
const hidden = await pdfPage.evaluate(() => {
  let n = 0
  for (const img of document.images) {
    if (!img.complete || img.naturalWidth === 0) {
      ;(img.closest('figure, .shot') ?? img).remove()
      n++
    }
  }
  return n
})
await pdfPage.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true })
const kb = Math.round(fs.statSync(out).size / 1024)
console.log(`::notice title=Guía de uso::PDF de ${kb} KB. Capturas fallidas: ${failures.length ? failures.join(', ') : 'ninguna'}. Figuras ocultas: ${hidden}.`)

await browser.close()
server.kill()
process.exit(0)
