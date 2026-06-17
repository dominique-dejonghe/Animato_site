// Workers-compatible QR-code naar PNG converter
// ------------------------------------------------
// De `qrcode` npm-lib heeft een browser-veld in package.json dat naar
// `lib/browser.js` mapt — die heeft `document.createElement('canvas')`
// nodig. In Cloudflare Workers crashes dat met "You need to specify
// a canvas element". De server-variant `lib/server.js` gebruikt op
// zijn beurt Node's `fs` en `pngjs` — óók niet beschikbaar.
//
// Oplossing: pak alleen de pure-JS `QRCode.create()` (die rendert NIET,
// geeft enkel de BitMatrix terug) en encode zelf een minimale 1-bit
// PNG met `fflate` voor deflate-compressie.
//
// Resultaat: PNG bytes die direct in pdf-lib.embedPng() kunnen.

import QRCode from 'qrcode'
// IMPORTANT: gebruik zlibSync, NIET deflateSync. PNG IDAT-spec vereist
// het zlib-formaat (deflate met header + adler32 trailer). `deflateSync`
// produceert RAW deflate zonder wrapper — dat triggert in pdf-lib's
// PNG-decoder een "Invalid typed array length"-crash bij sommige groottes.
import { zlibSync } from 'fflate'

interface Options {
  scale?: number              // pixels per QR-module (default 8)
  margin?: number             // quiet-zone in modules (default 1)
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
}

/**
 * Genereer een PNG-byte-array voor een QR-code.
 * Output is een grayscale-8bit PNG (zwart op wit, geen alpha).
 */
export function qrToPngBytes(text: string, options: Options = {}): Uint8Array {
  const scale = options.scale ?? 8
  const margin = options.margin ?? 1
  const errorCorrectionLevel = options.errorCorrectionLevel ?? 'H'

  // QRCode.create() = pure-JS matrix generation, geen canvas/fs nodig
  const qr = QRCode.create(text, { errorCorrectionLevel })
  const modules = qr.modules
  const size = modules.size
  const data: Uint8Array = modules.data // 1 byte per module, 0=licht, 1=donker

  const totalModules = size + margin * 2
  const pxSize = totalModules * scale

  // Bouw pixel-rijen op (1 byte per pixel, 0x00=zwart, 0xFF=wit, met
  // PNG-filter byte 0x00 vooraan per row)
  const rowLen = pxSize + 1 // +1 voor filter-byte
  const raw = new Uint8Array(rowLen * pxSize)

  for (let py = 0; py < pxSize; py++) {
    const rowStart = py * rowLen
    raw[rowStart] = 0 // filter type "None"
    // Welke module-rij ligt onder deze pixel-rij?
    const my = Math.floor(py / scale) - margin
    for (let px = 0; px < pxSize; px++) {
      const mx = Math.floor(px / scale) - margin
      let isDark = 0
      if (my >= 0 && my < size && mx >= 0 && mx < size) {
        isDark = data[my * size + mx]
      }
      raw[rowStart + 1 + px] = isDark ? 0x00 : 0xff
    }
  }

  // Comprimeer de raw pixel-stream (zlib-formaat: deflate + header + adler32)
  const idatData = zlibSync(raw, { level: 6 })

  // ── PNG opbouwen ────────────────────────────────────────
  // Signature + IHDR + IDAT + IEND
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = new Uint8Array(13)
  writeUint32BE(ihdr, 0, pxSize)        // width
  writeUint32BE(ihdr, 4, pxSize)        // height
  ihdr[8] = 8                            // bit depth
  ihdr[9] = 0                            // color type = grayscale
  ihdr[10] = 0                           // compression
  ihdr[11] = 0                           // filter
  ihdr[12] = 0                           // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr)
  const idatChunk = makeChunk('IDAT', idatData)
  const iendChunk = makeChunk('IEND', new Uint8Array(0))

  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const png = new Uint8Array(total)
  let off = 0
  png.set(sig, off); off += sig.length
  png.set(ihdrChunk, off); off += ihdrChunk.length
  png.set(idatChunk, off); off += idatChunk.length
  png.set(iendChunk, off)

  return png
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i)

  const len = data.length
  const chunk = new Uint8Array(4 + 4 + len + 4)
  writeUint32BE(chunk, 0, len)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)

  // CRC32 over type + data
  const crcInput = new Uint8Array(4 + len)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  const crc = crc32(crcInput)
  writeUint32BE(chunk, 8 + len, crc)

  return chunk
}

// CRC32 tabel-cache
let crcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    t[n] = c >>> 0
  }
  crcTable = t
  return t
}

function crc32(buf: Uint8Array): number {
  const t = getCrcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}
