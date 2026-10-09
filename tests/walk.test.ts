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
