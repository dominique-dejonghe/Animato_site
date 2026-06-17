// =============================================================================
// R2 Storage helpers — uploads, deletes, key generation
// =============================================================================
// Cloudflare R2 wordt gebruikt voor alle media (foto's, partituur-PDFs, covers)
// Vervangt base64-in-D1 (~1MB row limit) door echte object storage (geen limiet).
//
// Convention voor R2-keys:
//   photos/<albumId>/<timestamp>-<rand>.<ext>
//   member-photos/<userId>-<timestamp>.<ext>
//   covers/albums/<albumId>-<timestamp>.<ext>
//   covers/events/<eventId>-<timestamp>.<ext>
//   materials/<pieceId>/<timestamp>-<rand>.<ext>
//
// Publieke URL: /r2/<key>  (geserveerd door /src/routes/r2.tsx met long-cache)
// =============================================================================

export interface R2UploadResult {
  key: string
  url: string // public path, b.v. "/r2/photos/12/1736123-abc.jpg"
  size: number
  contentType: string
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/zip': 'zip'
}

function extFor(contentType: string, fallbackName?: string): string {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim()
  if (EXT_BY_MIME[ct]) return EXT_BY_MIME[ct]
  if (fallbackName) {
    const m = fallbackName.match(/\.([a-zA-Z0-9]+)$/)
    if (m) return m[1].toLowerCase()
  }
  return 'bin'
}

function randomHex(len = 8): string {
  const buf = new Uint8Array(len / 2)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Genereer een veilige, unieke R2-key voor een upload. */
export function makeR2Key(prefix: string, contentType: string, fallbackName?: string): string {
  const ts = Date.now()
  const rand = randomHex(8)
  const ext = extFor(contentType, fallbackName)
  // Schoon de prefix: alleen pad-veilige tekens, geen leading/trailing slash
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '_')
  return `${cleanPrefix}/${ts}-${rand}.${ext}`
}

/** Convert een data:URL string naar een Uint8Array + content-type. */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const m = dataUrl.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s)
  if (!m) return null
  const contentType = m[1] || 'application/octet-stream'
  const isBase64 = /;base64,/.test(dataUrl.slice(0, 200))
  const payload = m[2]
  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { bytes, contentType }
  }
  // URL-encoded variant
  const decoded = decodeURIComponent(payload)
  const bytes = new TextEncoder().encode(decoded)
  return { bytes, contentType }
}

/** Upload bytes naar R2 onder de gegeven key. */
export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | Uint8Array | ReadableStream,
  contentType: string
): Promise<R2UploadResult> {
  const body: any = data
  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
      // 30 dagen browser-cache; immutable want we genereren altijd nieuwe keys
      cacheControl: 'public, max-age=2592000, immutable'
    }
  })
  // Bepaal grootte
  let size = 0
  if (data instanceof ArrayBuffer) size = data.byteLength
  else if ((data as Uint8Array).byteLength !== undefined) size = (data as Uint8Array).byteLength

  return {
    key,
    url: `/r2/${key}`,
    size,
    contentType
  }
}

/** Upload een data: URL rechtstreeks naar R2 (handig voor migratie van base64). */
export async function uploadDataUrlToR2(
  bucket: R2Bucket,
  prefix: string,
  dataUrl: string,
  fallbackName?: string
): Promise<R2UploadResult | null> {
  const decoded = dataUrlToBytes(dataUrl)
  if (!decoded) return null
  const key = makeR2Key(prefix, decoded.contentType, fallbackName)
  return await uploadToR2(bucket, key, decoded.bytes, decoded.contentType)
}

/** Upload een File / Blob naar R2. */
export async function uploadFileToR2(
  bucket: R2Bucket,
  prefix: string,
  file: File | Blob,
  fallbackName?: string
): Promise<R2UploadResult> {
  const contentType = (file as File).type || 'application/octet-stream'
  const key = makeR2Key(prefix, contentType, fallbackName || (file as File).name)
  const buf = await file.arrayBuffer()
  return await uploadToR2(bucket, key, buf, contentType)
}

/** Verwijder een object uit R2. Faalt stil (logt alleen). */
export async function deleteFromR2(bucket: R2Bucket, key: string | null | undefined): Promise<void> {
  if (!key) return
  try {
    await bucket.delete(key)
  } catch (e) {
    console.warn('R2 delete failed for key', key, e)
  }
}

/** Helper: extract R2-key uit een /r2/<key> URL, of null als het geen R2-URL is. */
export function r2KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/^\/r2\/(.+)$/)
  return m ? m[1] : null
}

/** Test of een waarde een data:URL is. */
export function isDataUrl(value: string | null | undefined): boolean {
  return !!value && typeof value === 'string' && value.startsWith('data:')
}

/**
 * Scant een HTML-fragment op `<img src="data:image/...">` tags, uploadt elke
 * inline data-URL naar R2, en vervangt de src door de /r2/<key> URL.
 *
 * Waarom: Quill (en andere rich-text editors) embedden geplakte/gedropte
 * afbeeldingen by default als base64. Eén foto = ~1MB inline base64 in HTML.
 * Dat blaast je posts/editable_pages tabel op, kan de SQLITE_TOOBIG kolomlimiet
 * raken, en vertraagt elke SELECT. Deze helper saneert de HTML server-side.
 *
 * @returns Het bewerkte HTML-fragment (zelfde input als er geen data-URLs in zaten).
 * @throws Error als R2-upload mislukt voor één van de gevonden data-URLs.
 */
export async function uploadInlineDataUrlsInHtml(
  bucket: R2Bucket,
  prefix: string,
  html: string | null | undefined
): Promise<string> {
  if (!html || typeof html !== 'string') return html || ''
  // Geen data: prefix? Dan niks te doen, snelle exit.
  if (html.indexOf('data:image/') === -1) return html

  // Match <img ... src="data:image/...;base64,...">  (single OR double quotes)
  // Niet-greedy om meerdere img-tags in dezelfde body te ondersteunen.
  const IMG_DATA_RE = /(<img\b[^>]*\bsrc=)(["'])(data:image\/[^"']+)\2/gi

  // Eerst alle matches verzamelen (regex.exec in loop is foutgevoelig met async)
  const matches: { full: string; prefix: string; quote: string; dataUrl: string }[] = []
  let m: RegExpExecArray | null
  IMG_DATA_RE.lastIndex = 0
  while ((m = IMG_DATA_RE.exec(html)) !== null) {
    matches.push({ full: m[0], prefix: m[1], quote: m[2], dataUrl: m[3] })
  }

  if (matches.length === 0) return html

  // Upload elke unieke data-URL naar R2
  const replacements = new Map<string, string>() // dataUrl → /r2/url
  for (const match of matches) {
    if (replacements.has(match.dataUrl)) continue
    const up = await uploadDataUrlToR2(bucket, prefix, match.dataUrl)
    if (!up) {
      throw new Error('Inline image upload naar R2 mislukt')
    }
    replacements.set(match.dataUrl, up.url)
  }

  // Vervang in HTML
  let result = html
  for (const [dataUrl, r2Url] of replacements) {
    // Escape special regex chars in data-URL voor exacte vervanging
    // (base64 bevat /, + en = die als regex special tellen)
    const escaped = dataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`(<img\\b[^>]*\\bsrc=)(["'])${escaped}\\2`, 'gi'),
      (_full, p1, p2) => `${p1}${p2}${r2Url}${p2}`)
  }
  return result
}
