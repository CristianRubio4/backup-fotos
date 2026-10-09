// Genera tests/fixtures/set/ a partir de las imágenes y vídeos reales de
// tests/fixtures/base/ (hechos con Chrome: canvas → JPEG/PNG, MediaRecorder → MP4).
//
//   node scripts/make-fixtures.mjs
//
// El resultado sirve para los tests y como carpeta de origen para probar la app
// con un disco real. Ver tests/fixtures/README.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')
const base = (n) => fs.readFileSync(path.join(root, 'base', n))
const outDir = path.join(root, 'set')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'DCIM'), { recursive: true })
const write = (n, data) => fs.writeFileSync(path.join(outDir, n), data)

// ---------- utilidades ----------

function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

function u16be(n) {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff])
}

/** Inserta un segmento APPn justo después de SOI (y de APP0/JFIF si lo hay). */
function insertSegment(jpeg, marker, payload) {
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5])
  const seg = Buffer.concat([Buffer.from([0xff, marker]), u16be(payload.length + 2), payload])
  return Buffer.concat([jpeg.subarray(0, at), seg, jpeg.subarray(at)])
}

/** APP1 EXIF mínimo: DateTimeOriginal y PixelX/YDimension (little-endian). */
function exifApp1({ date, width, height }) {
  const t = Buffer.alloc(88)
  t.write('II', 0, 'latin1')
  t.writeUInt16LE(42, 2)
  t.writeUInt32LE(8, 4)
  // IFD0: un solo campo, el puntero al IFD EXIF
  t.writeUInt16LE(1, 8)
  t.writeUInt16LE(0x8769, 10)
  t.writeUInt16LE(4, 12) // LONG
  t.writeUInt32LE(1, 14)
  t.writeUInt32LE(26, 18)
  t.writeUInt32LE(0, 22)
  // IFD EXIF
  t.writeUInt16LE(3, 26)
  const entry = (i, tag, type, count, value) => {
    const o = 28 + i * 12
    t.writeUInt16LE(tag, o)
    t.writeUInt16LE(type, o + 2)
    t.writeUInt32LE(count, o + 4)
    t.writeUInt32LE(value, o + 8)
  }
  entry(0, 0x9003, 2, 20, 68) // DateTimeOriginal (ASCII) → offset 68
  entry(1, 0xa002, 4, 1, width)
  entry(2, 0xa003, 4, 1, height)
  t.writeUInt32LE(0, 64)
  t.write(date + '\0', 68, 'latin1')
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t])
}

const withExif = (jpeg, exif) => insertSegment(jpeg, 0xe1, exifApp1(exif))

function xmpApp1(xml) {
  return Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')])
}

/** MP4 → MOV: cambia la marca principal de "ftyp" a QuickTime. */
function toMov(mp4) {
  const b = Buffer.from(mp4)
  b.write('qt  ', 8, 'latin1')
  return b
}

function box(type, ...payload) {
  const body = Buffer.concat(payload)
  const h = Buffer.alloc(8)
  h.writeUInt32BE(8 + body.length, 0)
  h.write(type, 4, 'latin1')
  return Buffer.concat([h, body])
}

/** HEIC sintético: estructura ISOBMFF correcta (ftyp + meta + mdat) sin imagen decodificable. */
function heicShell() {
  const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), Buffer.alloc(4), Buffer.from('mif1heic', 'latin1'))
  const hdlr = box('hdlr', Buffer.alloc(8), Buffer.from('pict', 'latin1'), Buffer.alloc(13))
  const pitm = box('pitm', Buffer.alloc(4), u16be(1))
  const meta = box('meta', Buffer.alloc(4), hdlr, pitm)
  const r = rng(42)
  const mdat = box('mdat', Buffer.from(Array.from({ length: 4096 }, () => Math.floor(r() * 256))))
  return Buffer.concat([ftyp, meta, mdat])
}

const cut = (b, frac) => b.subarray(0, Math.floor(b.length * frac))

// ---------- conjunto ----------

const img1 = withExif(base('photo-a.jpg'), { date: '2023:07:14 18:22:05', width: 1024, height: 768 })
const img2 = withExif(base('photo-b.jpg'), { date: '2024:12:24 21:05:00', width: 768, height: 1024 })
const img3 = withExif(base('photo-c.jpg'), { date: '2025:03:02 09:10:11', width: 1024, height: 768 })

// Válidos
write('DCIM/IMG_0001.jpg', img1)
write('DCIM/IMG_0002.jpg', img2)
write('DCIM/IMG_0003.jpg', img3)
write('valida.png', base('valid.png'))
write('DCIM/VID_0001.mp4', base('clip.mp4'))
write('DCIM/VID_0002.mov', toMov(base('clip.mp4')))
write('DCIM/IMG_0004.heic', heicShell())

// Duplicado con otro nombre
write('copia de IMG_0001.jpg', img1)

// Corruptos y truncados
const r = rng(7)
write('corrupto.jpg', Buffer.from(Array.from({ length: 30_000 }, () => Math.floor(r() * 256))))
write('ceros.jpg', Buffer.alloc(50_000))
write('vacio.jpg', Buffer.alloc(0))
write('truncado.jpg', cut(img3, 0.6))
write('truncado.png', cut(base('valid.png'), 0.7))
write('video-truncado.mp4', cut(base('clip.mp4'), 0.5))

// Sin contenido útil
write('negra.jpg', base('black.jpg'))
write('blanca.png', base('white.png'))
write('diminuta.jpg', base('tiny.jpg'))
write('borrosa.jpg', base('blurry.jpg'))

// Posible versión reducida (el EXIF dice 4032×3024 pero mide 512×384)
write('reducida.jpg', withExif(base('reduced.jpg'), { date: '2022:08:20 12:00:00', width: 4032, height: 3024 }))

// Live Photo (iPhone): foto + vídeo con el mismo nombre base
write('DCIM/IMG_0100.jpg', withExif(base('live.jpg'), { date: '2025:06:01 20:15:30', width: 1024, height: 768 }))
write('DCIM/IMG_0100.MOV', toMov(base('live.mp4')))

// Motion Photo (Android): JPEG + XMP de Google + MP4 al final
const motionVideo = base('motion.mp4')
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
 GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="0"
 GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" GCamera:MicroVideoOffset="${motionVideo.length}"/>
</rdf:RDF></x:xmpmeta>`
const motionJpeg = insertSegment(withExif(base('motion.jpg'), { date: '2025:09:15 17:45:00', width: 1024, height: 768 }), 0xe1, xmpApp1(xmp))
write('DCIM/MVIMG_0200.jpg', Buffer.concat([motionJpeg, motionVideo]))

// No es foto ni vídeo
write('notas.txt', 'Este archivo no es una foto: la app debe ignorarlo.\n')

console.log('Generados en', outDir)
for (const f of fs.readdirSync(outDir, { recursive: true })) {
  const p = path.join(outDir, f)
  if (fs.statSync(p).isFile()) console.log(String(fs.statSync(p).size).padStart(8), f)
}
