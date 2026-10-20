import { describe, expect, it } from 'vitest'
import { noControl } from '../src/core/control'
import { friendlyError } from '../src/core/errors'
import { checkReadable, walkSource } from '../src/platform/walk'

// Handles simulados de la File System Access API, con los fallos típicos de un móvil.
type Node = FakeDir | FakeFile
const gone = () => new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError')

class FakeFile {
  kind = 'file' as const
  constructor(public name: string, private bytes = 10, private vanish = false) {}
  async getFile() {
    if (this.vanish) throw gone()
    return new File([new Uint8Array(this.bytes)], this.name, { lastModified: 1_700_000_000_000 })
  }
}

class FakeDir {
  kind = 'directory' as const
  constructor(public name: string, public children: Node[] = [], private failAfter: number | null = null) {}
  async *entries(): AsyncGenerator<[string, Node]> {
    let i = 0
    for (const c of this.children) {
      if (this.failAfter !== null && i++ >= this.failAfter) throw gone()
      yield [c.name, c]
    }
    if (this.failAfter !== null && this.children.length <= this.failAfter) throw gone()
  }
  async isSameEntry(o: unknown) {
    return o === this
  }
}

const walk = (root: FakeDir, label?: string) => walkSource(root as unknown as FileSystemDirectoryHandle, null, noControl, () => {}, { label })

describe('escaneo de un móvil u otro dispositivo', () => {
  it('un archivo que desaparece al leerlo no detiene el escaneo', async () => {
    const root = new FakeDir('DCIM', [new FakeDir('Camera', [new FakeFile('IMG_1.jpg'), new FakeFile('IMG_2.jpg', 10, true), new FakeFile('IMG_3.jpg')])])
    const r = await walk(root, 'Móvil')
    expect(r.files.map((f) => f.relPath)).toEqual(['Móvil/Camera/IMG_1.jpg', 'Móvil/Camera/IMG_3.jpg'])
    expect(r.unreadable).toEqual([{ relPath: 'Móvil/Camera/IMG_2.jpg', reason: friendlyError(gone()) }])
  })

  it('una subcarpeta que deja de existir a mitad: se conserva lo leído y se sigue con el resto', async () => {
    const root = new FakeDir('Interno', [
      new FakeDir('Pictures', [new FakeFile('a.jpg'), new FakeFile('b.jpg'), new FakeFile('c.jpg')], 1),
      new FakeDir('DCIM', [new FakeFile('d.jpg')]),
    ])
    const r = await walk(root)
    expect(r.files.map((f) => f.relPath)).toEqual(['Pictures/a.jpg', 'DCIM/d.jpg'])
    expect(r.unreadable?.[0].relPath).toBe('Pictures')
  })

  it('al elegir el móvil entero encuentra las fotos y se salta datos internos y carpetas ocultas', async () => {
    const root = new FakeDir('Almacenamiento interno', [
      new FakeDir('DCIM', [new FakeDir('Camera', [new FakeFile('IMG_1.jpg')]), new FakeDir('.thumbnails', [new FakeFile('t.jpg')])]),
      new FakeDir('Android', [
        new FakeDir('data', [new FakeDir('com.juego', [new FakeFile('textura.png')])]),
        new FakeDir('obb', [new FakeFile('assets.png')]),
        new FakeDir('media', [new FakeDir('com.whatsapp', [new FakeDir('WhatsApp', [new FakeDir('Media', [new FakeFile('IMG-WA0001.jpg')])])])]),
      ]),
      new FakeDir('LOST.DIR', [new FakeFile('x.jpg')]),
      new FakeDir('.trashed', [new FakeFile('borrada.jpg')]),
      new FakeFile('notas.txt'),
    ])
    const r = await walk(root)
    expect(r.files.map((f) => f.relPath)).toEqual(['DCIM/Camera/IMG_1.jpg', 'Android/media/com.whatsapp/WhatsApp/Media/IMG-WA0001.jpg'])
    expect(r.ignored).toEqual(['notas.txt'])
  })

  it('recorre todas las subcarpetas, a cualquier profundidad', async () => {
    // 12 niveles de carpetas, con una foto en cada nivel.
    let deepest = new FakeDir('n12', [new FakeFile('foto12.jpg')])
    for (let i = 11; i >= 1; i--) deepest = new FakeDir(`n${i}`, [new FakeFile(`foto${i}.jpg`), deepest])
    const r = await walk(new FakeDir('raíz', [deepest]))
    expect(r.files).toHaveLength(12)
    expect(r.files.at(-1)!.relPath).toBe('n1/n2/n3/n4/n5/n6/n7/n8/n9/n10/n11/n12/foto12.jpg')
    expect(r.dirs).toHaveLength(13) // la raíz y sus 12 subcarpetas
  })

  it('un móvil típico: encuentra todas las fotos y vídeos de todas sus carpetas', async () => {
    const files = (prefix: string, n: number, ext = 'jpg') => Array.from({ length: n }, (_, i) => new FakeFile(`${prefix}_${i}.${ext}`))
    const root = new FakeDir('Almacenamiento interno', [
      new FakeDir('DCIM', [
        new FakeDir('Camera', [...files('IMG', 300), ...files('VID', 20, 'mp4')]),
        new FakeDir('Screenshots', files('Screenshot', 40, 'png')),
        new FakeDir('100ANDRO', files('DSC', 5, 'JPG')), // extensión en mayúsculas
      ]),
      new FakeDir('Pictures', [new FakeDir('Instagram', files('ig', 7)), new FakeDir('Telegram', files('tg', 3, 'webp'))]),
      new FakeDir('Movies', files('clip', 2, 'MOV')),
      new FakeDir('Download', [...files('foto', 4, 'jpeg'), new FakeFile('factura.pdf')]),
      new FakeDir('Android', [new FakeDir('media', [new FakeDir('com.whatsapp', [new FakeDir('WhatsApp', [new FakeDir('Media', [
        new FakeDir('WhatsApp Images', [...files('IMG-WA', 50), new FakeDir('Sent', files('IMG-WA-sent', 10))]),
        new FakeDir('WhatsApp Video', files('VID-WA', 6, 'mp4')),
      ])])])])]),
    ])
    const r = await walk(root, 'Móvil')
    expect(r.files).toHaveLength(300 + 20 + 40 + 5 + 7 + 3 + 2 + 4 + 50 + 6) // sin WhatsApp Images/Sent (fotos enviadas)
    expect(r.ignored).toEqual(['Móvil/Download/factura.pdf'])
    expect(r.files.some((f) => f.relPath === 'Móvil/DCIM/100ANDRO/DSC_4.JPG')).toBe(true)
    expect(r.files.some((f) => f.relPath.includes('/Sent/'))).toBe(false)
    expect(r.dirs).toContain('Móvil/DCIM/Camera')
    expect(r.unreadable).toEqual([])
  })

  it('las carpetas con puntos en el nombre (no ocultas) se recorren', async () => {
    const root = new FakeDir('Fotos', [new FakeDir('Viaje a Roma 2024.06', [new FakeFile('a.jpg')]), new FakeDir('Cámara v2.1', [new FakeFile('b.heic')])])
    const r = await walk(root)
    expect(r.files.map((f) => f.relPath)).toEqual(['Viaje a Roma 2024.06/a.jpg', 'Cámara v2.1/b.heic'])
  })

  it('una carpeta ilegible en lo profundo no impide encontrar las demás', async () => {
    const root = new FakeDir('Móvil', [
      new FakeDir('A', [new FakeDir('B', [new FakeDir('rota', [new FakeFile('x.jpg')], 0), new FakeFile('b.jpg')])]),
      new FakeDir('C', [new FakeFile('c.jpg')]),
    ])
    const r = await walk(root)
    expect(r.files.map((f) => f.relPath)).toEqual(['A/B/b.jpg', 'C/c.jpg'])
    expect(r.unreadable?.map((u) => u.relPath)).toEqual(['A/B/rota'])
  })

  it('no entra en la carpeta de destino si está dentro del origen', async () => {
    const dest = new FakeDir('Backup', [new FakeFile('copia.jpg')])
    const root = new FakeDir('Disco', [new FakeDir('DCIM', [new FakeFile('a.jpg')]), dest])
    const r = await walkSource(root as unknown as FileSystemDirectoryHandle, dest as unknown as FileSystemDirectoryHandle, noControl, () => {})
    expect(r.files.map((f) => f.relPath)).toEqual(['DCIM/a.jpg'])
  })

  it('si la carpeta raíz no se puede leer (móvil desconectado), lo indica', async () => {
    const root = new FakeDir('DCIM', [new FakeFile('a.jpg')], 0)
    await expect(walk(root)).rejects.toThrow()
    expect(await checkReadable(root as unknown as FileSystemDirectoryHandle)).toMatch(/desconectado/)
    expect(await checkReadable(new FakeDir('ok', [new FakeFile('a.jpg')]) as unknown as FileSystemDirectoryHandle)).toBeNull()
  })

  it('los errores del navegador se muestran en español', () => {
    expect(friendlyError(gone())).toMatch(/No se encuentra el archivo o la carpeta/)
    expect(friendlyError(new DOMException('x', 'NotReadableError'))).toMatch(/No se puede leer/)
  })
})
