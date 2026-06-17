// Ticket-ZIP utility
// ------------------
// Bundelt meerdere per-stoel PDF's tot één ZIP-bestand voor admin-download.
// Gebruikt fflate (pure JS, Cloudflare-Workers-compatible) met sync-API.
//
// PDF's zijn al gecomprimeerd (FlateDecode) → ZIP-compressie heeft weinig
// nut en kost CPU-tijd. We gebruiken store-mode (level: 0).

import { zipSync, strToU8 } from 'fflate'

export interface TicketZipFile {
  filename: string
  bytes: Uint8Array
}

/**
 * Bundel een lijst van files tot één ZIP als Uint8Array.
 * Gebruikt store-mode (geen extra compressie) — snelste optie voor PDFs.
 */
export function zipTicketPdfs(files: TicketZipFile[], readmeText?: string): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {}

  for (const file of files) {
    // Sanitize filename
    const safeName = file.filename.replace(/[<>:"|?*\x00-\x1f]/g, '_')
    // PDFs zijn al gecomprimeerd → store-mode
    entries[safeName] = [file.bytes, { level: 0 }]
  }

  if (readmeText) {
    entries['LEES-MIJ.txt'] = strToU8(readmeText)
  }

  return zipSync(entries)
}
