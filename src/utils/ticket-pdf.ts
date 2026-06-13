// Ticket PDF-generator met QR-code
// ----------------------------------
// Gebruikt pdf-lib (pure JS, Cloudflare-Workers-compatible) en qrcode-npm.
// Outputs één PDF met één pagina per ticket-line (multi-cat orders kunnen
// dus meerdere pagina's hebben). Elke pagina toont:
//   - Header met koorlogo-tekst + ordernummer
//   - Concert-info (titel, datum, locatie)
//   - Categorie + aantal
//   - QR-code (groot, scanbaar)
//   - Voorwaarden-footer

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

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
  concert_datum: string // pre-geformatteerd "zaterdag 10 oktober 2026"
  concert_tijd: string  // pre-geformatteerd "22:00"
  concert_locatie: string
  lines: TicketPdfLine[]
  totaal_bedrag: number
}

/**
 * Genereer ticket-PDF als Uint8Array.
 * Geef het resultaat door aan Buffer/base64 voor email-attachments.
 */
export async function generateTicketPdf(data: TicketPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Kleuren (Animato palette)
  const animatoPrimary = rgb(0.063, 0.659, 0.812)  // #10A8CF teal
  const animatoAccent = rgb(0.961, 0.620, 0.043)   // #F59E0B amber
  const gray700 = rgb(0.29, 0.337, 0.388)
  const gray500 = rgb(0.42, 0.45, 0.5)
  const gray200 = rgb(0.898, 0.906, 0.922)

  for (const line of data.lines) {
    // QR als PNG → embed
    // errorCorrectionLevel 'H' = ~30% redundancy, bestand tegen verkreukel/print
    const qrPngDataUrl = await QRCode.toDataURL(line.qr_code, {
      errorCorrectionLevel: 'H',
      width: 600,
      margin: 1
    })
    const qrPngBytes = base64ToUint8Array(qrPngDataUrl.split(',')[1] || '')
    const qrImg = await pdf.embedPng(qrPngBytes)

    // A4 portrait (595 x 842 pt)
    const page = pdf.addPage([595, 842])
    const { width, height } = page.getSize()

    // ── Header-balk ──
    page.drawRectangle({
      x: 0, y: height - 90,
      width, height: 90,
      color: animatoPrimary
    })
    page.drawText('GEMENGD KOOR ANIMATO', {
      x: 40, y: height - 45,
      size: 18, font: fontBold,
      color: rgb(1, 1, 1)
    })
    page.drawText('E-TICKET', {
      x: 40, y: height - 72,
      size: 12, font: font,
      color: rgb(1, 1, 1)
    })
    // Order ref rechts
    page.drawText(`Order: ${data.order_ref}`, {
      x: width - 40 - font.widthOfTextAtSize(`Order: ${data.order_ref}`, 11),
      y: height - 45,
      size: 11, font: font,
      color: rgb(1, 1, 1)
    })

    // ── Concert-titel ──
    page.drawText(truncate(data.concert_titel, 55), {
      x: 40, y: height - 140,
      size: 24, font: fontBold,
      color: gray700
    })

    // ── Detail-tabel ──
    let y = height - 200
    const labelX = 40
    const valueX = 180
    const lineGap = 28

    drawRow(page, font, fontBold, labelX, valueX, y, 'DATUM',     data.concert_datum, gray500, gray700);   y -= lineGap
    drawRow(page, font, fontBold, labelX, valueX, y, 'AANVANG',   `${data.concert_tijd} uur`, gray500, gray700); y -= lineGap
    drawRow(page, font, fontBold, labelX, valueX, y, 'LOCATIE',   data.concert_locatie || '—', gray500, gray700); y -= lineGap
    drawRow(page, font, fontBold, labelX, valueX, y, 'NAAM',      data.koper_naam, gray500, gray700);     y -= lineGap
    drawRow(page, font, fontBold, labelX, valueX, y, 'CATEGORIE', line.categorie, gray500, gray700);      y -= lineGap
    drawRow(page, font, fontBold, labelX, valueX, y, 'AANTAL',    `${line.aantal}`, gray500, gray700);     y -= lineGap

    // ── Scheiding ──
    page.drawLine({
      start: { x: 40, y: y - 10 },
      end: { x: width - 40, y: y - 10 },
      thickness: 1,
      color: gray200
    })
    y -= 40

    // ── QR-code centraal ──
    const qrSize = 220
    const qrX = (width - qrSize) / 2
    const qrY = y - qrSize
    page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize })

    // QR-label
    page.drawText('Scan bij de ingang', {
      x: (width - font.widthOfTextAtSize('Scan bij de ingang', 12)) / 2,
      y: qrY - 22,
      size: 12, font: font,
      color: gray700
    })
    page.drawText(line.qr_code, {
      x: (width - font.widthOfTextAtSize(line.qr_code, 9)) / 2,
      y: qrY - 38,
      size: 9, font: font,
      color: gray500
    })

    // ── Voorwaarden-footer ──
    const footerY = 80
    page.drawLine({
      start: { x: 40, y: footerY + 24 },
      end: { x: width - 40, y: footerY + 24 },
      thickness: 1,
      color: gray200
    })
    page.drawText('VOORWAARDEN', {
      x: 40, y: footerY + 10,
      size: 8, font: fontBold,
      color: gray500
    })
    const footerLines = [
      '• Eén QR-code per ticket-categorie. Toon dit ticket op je smartphone of geprint bij de ingang.',
      '• Tickets zijn persoonlijk en niet-overdraagbaar zonder voorafgaande toestemming.',
      '• Bij verlies kan je een duplicaat opvragen via tickets@animato.be (vermeld je ordernummer).',
      `• Vragen? Mail naar tickets@animato.be — vermeld order ${data.order_ref}.`
    ]
    let fy = footerY - 4
    for (const fl of footerLines) {
      page.drawText(fl, { x: 40, y: fy, size: 7, font: font, color: gray500 })
      fy -= 10
    }
  }

  // ── Samenvattings-pagina vooraan? Nee — houden we simpel: 1 line = 1 pagina.
  return await pdf.save()
}

// ── Helpers ─────────────────────────────────────────────

function drawRow(
  page: any,
  font: any,
  fontBold: any,
  labelX: number,
  valueX: number,
  y: number,
  label: string,
  value: string,
  labelColor: any,
  valueColor: any
) {
  page.drawText(label, { x: labelX, y, size: 9, font: fontBold, color: labelColor })
  page.drawText(truncate(value || '—', 48), { x: valueX, y, size: 12, font: font, color: valueColor })
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
  // Chunked om stack-overflow bij grote PDFs te voorkomen
  const chunkSize = 0x8000
  let result = ''
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.subarray(i, Math.min(i + chunkSize, arr.length))
    result += String.fromCharCode.apply(null, chunk as any)
  }
  return btoa(result)
}
