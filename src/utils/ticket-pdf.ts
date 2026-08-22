// Ticket PDF-generator met QR-code
// ----------------------------------
// Gebruikt pdf-lib (pure JS, Cloudflare-Workers-compatible) en qrcode-npm.
//
// Twee modi:
//   1. generateTicketPdf()        — 1 PDF met alle categorieën als pagina's (legacy, behouden)
//   2. generateSeatTicketPdf()    — 1 PDF voor 1 specifieke stoel (NIEUW)
//   3. generateSeatTicketPdfs()   — Array van per-stoel PDF's voor een bestelling (NIEUW)
//
// De PDF toont:
//   - Header met Animato-merk + ordernummer
//   - Concert-info (titel, datum, aanvang, deuren-open, locatie, adres)
//   - Stoel-info (sectie, rij, stoelnummer) — alleen bij seat-PDF
//   - QR-code (groot, scanbaar)
//   - Voorwaarden-footer

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
// LET OP: NIET `import QRCode from 'qrcode'` gebruiken — die haalt
// `lib/browser.js` op via het `browser`-veld in package.json (canvas-deps),
// en server.js heeft Node's fs/pngjs. Beide crashes in Workers.
// Zie src/utils/qr-to-png.ts voor de pure-JS workaround.
import { qrToPngBytes } from './qr-to-png'

// ── Legacy interface (multi-categorie order) ─────────────────────────
export interface TicketPdfLine {
  qr_code: string
  categorie: string
  aantal: number
  prijs_totaal: number
}

export interface TicketPdfData {
  order_ref: string
  koper_naam: string
  koper_email: string
  concert_titel: string
  concert_datum: string  // pre-geformatteerd "zaterdag 10 oktober 2026"
  concert_tijd: string   // pre-geformatteerd "20:00"
  concert_locatie: string
  concert_adres?: string | null
  concert_doors_open?: string | null  // "19:30" of null
  lines: TicketPdfLine[]
  totaal_bedrag: number
}

// ── NIEUW: per-stoel interface ───────────────────────────────────────
export interface SeatTicketPdfData {
  order_ref: string
  koper_naam: string
  koper_email: string
  concert_titel: string
  concert_datum: string
  concert_tijd: string          // aanvang concert
  concert_doors_open?: string | null  // deuren open
  concert_locatie: string
  concert_adres?: string | null
  categorie: string
  prijs: number
  qr_code: string               // QR string (uniek per stoel)
  seat_label: string            // bv. "Rij C — Stoel 12"
  seat_sectie?: string | null   // optioneel, bv. "Balkon"
  ticket_index?: number         // 1, 2, 3... van de bestelling
  ticket_total?: number         // 4 (totaal aantal kaarten in deze bestelling)
  logo_png_bytes?: Uint8Array | null  // optionele Animato-logo PNG
}

// ── Kleuren ──────────────────────────────────────────────────────────
const COLOR = {
  primary: rgb(0.063, 0.659, 0.812),  // #10A8CF teal
  accent:  rgb(0.961, 0.620, 0.043),  // #F59E0B amber
  gray800: rgb(0.18, 0.20, 0.24),
  gray700: rgb(0.29, 0.337, 0.388),
  gray500: rgb(0.42, 0.45, 0.5),
  gray300: rgb(0.82, 0.83, 0.86),
  gray200: rgb(0.898, 0.906, 0.922),
  gray100: rgb(0.96, 0.96, 0.97),
  white:   rgb(1, 1, 1)
}

/**
 * Genereer per-stoel PDF (NIEUW, aanbevolen).
 * Output = 1 pagina, 1 PDF, voor 1 stoel.
 */
export async function generateSeatTicketPdf(data: SeatTicketPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // QR genereren (Workers-compatible — pure JS, geen canvas)
  const qrPngBytes = qrToPngBytes(data.qr_code, {
    errorCorrectionLevel: 'H',
    scale: 8,
    margin: 1
  })
  const qrImg = await pdf.embedPng(qrPngBytes)

  // Optionele Animato-logo PNG
  let logoImg: any = null
  if (data.logo_png_bytes && data.logo_png_bytes.length > 0) {
    try {
      logoImg = await pdf.embedPng(data.logo_png_bytes)
    } catch (e) {
      // Logo embed faalde — niet kritiek
      console.warn('[ticket-pdf] logo embed mislukt:', (e as any)?.message)
    }
  }

  // A4 portrait (595 x 842 pt)
  const page = pdf.addPage([595, 842])
  const { width, height } = page.getSize()

  // ── 1. HEADER-BALK ──────────────────────────────────────
  page.drawRectangle({
    x: 0, y: height - 100,
    width, height: 100,
    color: COLOR.primary
  })

  // Logo links bovenaan (als beschikbaar)
  let titleX = 40
  if (logoImg) {
    const logoH = 60
    const logoW = logoImg.width * (logoH / logoImg.height)
    const maxLogoW = 120
    const finalLogoW = Math.min(logoW, maxLogoW)
    const finalLogoH = logoImg.height * (finalLogoW / logoImg.width)
    page.drawImage(logoImg, {
      x: 30,
      y: height - 30 - finalLogoH,
      width: finalLogoW,
      height: finalLogoH
    })
    titleX = 30 + finalLogoW + 16
  }

  page.drawText('GEMENGD KOOR ANIMATO', {
    x: titleX, y: height - 45,
    size: 18, font: fontBold,
    color: COLOR.white
  })
  page.drawText('E-TICKET', {
    x: titleX, y: height - 72,
    size: 12, font,
    color: COLOR.white
  })

  // Order ref rechts
  const orderText = `Order: ${data.order_ref}`
  page.drawText(orderText, {
    x: width - 40 - font.widthOfTextAtSize(orderText, 11),
    y: height - 45,
    size: 11, font,
    color: COLOR.white
  })

  // Ticket X van Y rechts onderaan header
  if (data.ticket_index && data.ticket_total) {
    const idxText = `Ticket ${data.ticket_index} / ${data.ticket_total}`
    page.drawText(idxText, {
      x: width - 40 - font.widthOfTextAtSize(idxText, 10),
      y: height - 72,
      size: 10, font,
      color: COLOR.white
    })
  }

  // ── 2. CONCERT-TITEL ────────────────────────────────────
  page.drawText(truncate(data.concert_titel, 52), {
    x: 40, y: height - 145,
    size: 24, font: fontBold,
    color: COLOR.gray800
  })

  // ── 3. DETAIL-TABEL ─────────────────────────────────────
  let y = height - 195
  const labelX = 40
  const valueX = 175
  const lineGap = 24

  drawRow(page, font, fontBold, labelX, valueX, y, 'DATUM', data.concert_datum)
  y -= lineGap

  // Aanvang + deuren open in één regel (compact)
  const aanvangValue = data.concert_doors_open
    ? `${data.concert_tijd} uur  (deuren open om ${data.concert_doors_open})`
    : `${data.concert_tijd} uur`
  drawRow(page, font, fontBold, labelX, valueX, y, 'AANVANG', aanvangValue)
  y -= lineGap

  drawRow(page, font, fontBold, labelX, valueX, y, 'LOCATIE', data.concert_locatie || '—')
  y -= lineGap

  if (data.concert_adres) {
    drawRow(page, font, fontBold, labelX, valueX, y, 'ADRES', truncate(data.concert_adres, 48))
    y -= lineGap
  }

  drawRow(page, font, fontBold, labelX, valueX, y, 'NAAM', truncate(data.koper_naam, 48))
  y -= lineGap

  drawRow(page, font, fontBold, labelX, valueX, y, 'CATEGORIE', data.categorie)
  y -= lineGap

  // ── 4. STOEL-BLOK (prominent geaccentueerd) ─────────────
  y -= 8
  const seatBoxY = y - 70
  page.drawRectangle({
    x: 40, y: seatBoxY,
    width: width - 80, height: 70,
    color: COLOR.gray100,
    borderColor: COLOR.accent,
    borderWidth: 2
  })
  page.drawText('JOUW STOEL', {
    x: 56, y: seatBoxY + 48,
    size: 10, font: fontBold,
    color: COLOR.gray500
  })
  const seatText = data.seat_sectie
    ? `${data.seat_sectie} — ${data.seat_label}`
    : data.seat_label
  page.drawText(truncate(seatText, 40), {
    x: 56, y: seatBoxY + 22,
    size: 20, font: fontBold,
    color: COLOR.gray800
  })

  y = seatBoxY - 24

  // ── 5. QR-CODE CENTRAAL ─────────────────────────────────
  const qrSize = 200
  const qrX = (width - qrSize) / 2
  const qrY = y - qrSize
  page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize })

  page.drawText('Scan bij de ingang', {
    x: (width - font.widthOfTextAtSize('Scan bij de ingang', 12)) / 2,
    y: qrY - 22,
    size: 12, font,
    color: COLOR.gray700
  })
  page.drawText(data.qr_code, {
    x: (width - font.widthOfTextAtSize(data.qr_code, 9)) / 2,
    y: qrY - 38,
    size: 9, font,
    color: COLOR.gray500
  })

  // ── 6. VOORWAARDEN-FOOTER ───────────────────────────────
  const footerY = 80
  page.drawLine({
    start: { x: 40, y: footerY + 24 },
    end: { x: width - 40, y: footerY + 24 },
    thickness: 1,
    color: COLOR.gray200
  })
  page.drawText('VOORWAARDEN', {
    x: 40, y: footerY + 10,
    size: 8, font: fontBold,
    color: COLOR.gray500
  })
  const footerLines = [
    '• Eén QR-code per stoel. Toon dit ticket op je smartphone of geprint bij de ingang.',
    '• Tickets zijn persoonlijk en niet-overdraagbaar zonder voorafgaande toestemming.',
    '• Bij verlies kan je een duplicaat opvragen via info@gemengdkooranimato.be (vermeld je ordernummer).',
    `• Vragen? Mail naar info@gemengdkooranimato.be — vermeld order ${data.order_ref}.`
  ]
  let fy = footerY - 4
  for (const fl of footerLines) {
    page.drawText(fl, { x: 40, y: fy, size: 7, font, color: COLOR.gray500 })
    fy -= 10
  }

  return await pdf.save()
}

/**
 * Genereer per-stoel PDF's voor een hele bestelling.
 * Retourneert array van { filename, bytes } — klaar voor email-attachments of ZIP.
 */
export async function generateSeatTicketPdfs(params: {
  order_ref: string
  koper_naam: string
  koper_email: string
  concert_titel: string
  concert_datum: string
  concert_tijd: string
  concert_doors_open?: string | null
  concert_locatie: string
  concert_adres?: string | null
  logo_png_bytes?: Uint8Array | null
  seats: Array<{
    qr_code: string
    categorie: string
    prijs: number
    seat_label: string
    seat_sectie?: string | null
  }>
}): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  const results: Array<{ filename: string; bytes: Uint8Array }> = []
  const total = params.seats.length
  let idx = 0
  for (const seat of params.seats) {
    idx++
    const bytes = await generateSeatTicketPdf({
      order_ref: params.order_ref,
      koper_naam: params.koper_naam,
      koper_email: params.koper_email,
      concert_titel: params.concert_titel,
      concert_datum: params.concert_datum,
      concert_tijd: params.concert_tijd,
      concert_doors_open: params.concert_doors_open,
      concert_locatie: params.concert_locatie,
      concert_adres: params.concert_adres,
      categorie: seat.categorie,
      prijs: seat.prijs,
      qr_code: seat.qr_code,
      seat_label: seat.seat_label,
      seat_sectie: seat.seat_sectie,
      ticket_index: idx,
      ticket_total: total,
      logo_png_bytes: params.logo_png_bytes
    })
    // Filename: ORDER123-rij-C-stoel-12.pdf
    const safeLabel = seat.seat_label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    results.push({
      filename: `${params.order_ref}-${safeLabel}.pdf`,
      bytes
    })
  }
  return results
}

// ── LEGACY: multi-pagina order-PDF (behouden voor backward compat) ───
export async function generateTicketPdf(data: TicketPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  for (const line of data.lines) {
    const qrPngBytes = qrToPngBytes(line.qr_code, {
      errorCorrectionLevel: 'H',
      scale: 8,
      margin: 1
    })
    const qrImg = await pdf.embedPng(qrPngBytes)

    const page = pdf.addPage([595, 842])
    const { width, height } = page.getSize()

    page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: COLOR.primary })
    page.drawText('GEMENGD KOOR ANIMATO', { x: 40, y: height - 45, size: 18, font: fontBold, color: COLOR.white })
    page.drawText('E-TICKET', { x: 40, y: height - 72, size: 12, font, color: COLOR.white })
    page.drawText(`Order: ${data.order_ref}`, {
      x: width - 40 - font.widthOfTextAtSize(`Order: ${data.order_ref}`, 11),
      y: height - 45,
      size: 11, font, color: COLOR.white
    })

    page.drawText(truncate(data.concert_titel, 55), { x: 40, y: height - 140, size: 24, font: fontBold, color: COLOR.gray700 })

    let y = height - 200
    drawRow(page, font, fontBold, 40, 180, y, 'DATUM', data.concert_datum); y -= 28
    const aanvangValue = data.concert_doors_open
      ? `${data.concert_tijd} uur  (deuren ${data.concert_doors_open})`
      : `${data.concert_tijd} uur`
    drawRow(page, font, fontBold, 40, 180, y, 'AANVANG', aanvangValue); y -= 28
    drawRow(page, font, fontBold, 40, 180, y, 'LOCATIE', data.concert_locatie || '—'); y -= 28
    if (data.concert_adres) { drawRow(page, font, fontBold, 40, 180, y, 'ADRES', data.concert_adres); y -= 28 }
    drawRow(page, font, fontBold, 40, 180, y, 'NAAM', data.koper_naam); y -= 28
    drawRow(page, font, fontBold, 40, 180, y, 'CATEGORIE', line.categorie); y -= 28
    drawRow(page, font, fontBold, 40, 180, y, 'AANTAL', `${line.aantal}`); y -= 28

    page.drawLine({ start: { x: 40, y: y - 10 }, end: { x: width - 40, y: y - 10 }, thickness: 1, color: COLOR.gray200 })
    y -= 40

    const qrSize = 220
    const qrX = (width - qrSize) / 2
    const qrY = y - qrSize
    page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize })
    page.drawText('Scan bij de ingang', {
      x: (width - font.widthOfTextAtSize('Scan bij de ingang', 12)) / 2,
      y: qrY - 22, size: 12, font, color: COLOR.gray700
    })
    page.drawText(line.qr_code, {
      x: (width - font.widthOfTextAtSize(line.qr_code, 9)) / 2,
      y: qrY - 38, size: 9, font, color: COLOR.gray500
    })

    const footerY = 80
    page.drawLine({ start: { x: 40, y: footerY + 24 }, end: { x: width - 40, y: footerY + 24 }, thickness: 1, color: COLOR.gray200 })
    page.drawText('VOORWAARDEN', { x: 40, y: footerY + 10, size: 8, font: fontBold, color: COLOR.gray500 })
    const footerLines = [
      '• Eén QR-code per ticket-categorie. Toon dit ticket op je smartphone of geprint bij de ingang.',
      '• Tickets zijn persoonlijk en niet-overdraagbaar zonder voorafgaande toestemming.',
      '• Bij verlies kan je een duplicaat opvragen via info@gemengdkooranimato.be (vermeld je ordernummer).',
      `• Vragen? Mail naar info@gemengdkooranimato.be — vermeld order ${data.order_ref}.`
    ]
    let fy = footerY - 4
    for (const fl of footerLines) {
      page.drawText(fl, { x: 40, y: fy, size: 7, font, color: COLOR.gray500 })
      fy -= 10
    }
  }

  return await pdf.save()
}

// ── HELPERS ──────────────────────────────────────────────────────────

function drawRow(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  labelX: number,
  valueX: number,
  y: number,
  label: string,
  value: string
) {
  page.drawText(label, { x: labelX, y, size: 9, font: fontBold, color: COLOR.gray500 })
  page.drawText(truncate(value || '—', 50), { x: valueX, y, size: 12, font, color: COLOR.gray700 })
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.substring(0, n - 1) + '…' : s
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const len = bin.length
  const arr = new Uint8Array(len)
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

/**
 * Converteer een Uint8Array naar base64 (zonder data:-prefix).
 * Cloudflare Workers ondersteunt geen Buffer dus we doen het manueel.
 */
export function uint8ArrayToBase64(arr: Uint8Array): string {
  const chunkSize = 0x8000
  let result = ''
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.subarray(i, Math.min(i + chunkSize, arr.length))
    result += String.fromCharCode.apply(null, chunk as any)
  }
  return btoa(result)
}
