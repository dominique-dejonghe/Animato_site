// Text formatting utilities

/**
 * Convert escaped line breaks to actual line breaks
 * Handles: \r\n, \n, \r
 */
export function formatLineBreaks(text: string | null | undefined): string {
  if (!text) return ''
  
  return text
    .replace(/\\r\\n/g, '\n')  // Windows style (escaped)
    .replace(/\\n/g, '\n')     // Unix style (escaped)
    .replace(/\\r/g, '\n')     // Old Mac style (escaped)
    .replace(/\r\n/g, '\n')    // Windows style (real)
    .replace(/\r/g, '\n')      // Old Mac style (real)
}

/**
 * Truncate text to a certain length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength).trim() + '...'
}

/**
 * Convert plain text to HTML with line breaks
 */
export function textToHtml(text: string | null | undefined): string {
  if (!text) return ''
  
  return formatLineBreaks(text)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return text.replace(/[&<>"']/g, char => map[char])
}

/**
 * Post-process rich text body HTML for safe link target behavior (#90).
 * - Internal links (relative paths or same-host absolute URLs) → no target attribute (open in same tab)
 * - External links (different host) → target="_blank" rel="noopener noreferrer"
 *
 * The Quill editor stores absolute URLs by default, so we need to detect host equality.
 * We accept the host strings of the running site so we can use this safely server-side.
 */
export function processBodyLinks(html: string | null | undefined, siteHosts: string[] = []): string {
  if (!html) return ''
  const internalHosts = new Set(siteHosts.map(h => h.toLowerCase().replace(/^www\./, '')))

  // Match <a ...> open tags with their attributes — keep them simple, don't touch the body
  return html.replace(/<a\b([^>]*)>/gi, (match, rawAttrs) => {
    let attrs = rawAttrs as string

    // Pull href value (single or double quotes)
    const hrefMatch = attrs.match(/\bhref\s*=\s*(['"])([^'"]*)\1/i)
    if (!hrefMatch) return match // no href → leave as-is
    const href = hrefMatch[2].trim()

    // Bepaal of dit een interne link is
    let isInternal = false
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      // anchor / mailto / tel — NIET in een nieuw tabblad
      isInternal = true
    } else if (href.startsWith('/') && !href.startsWith('//')) {
      // Relatief pad — intern
      isInternal = true
    } else {
      // Absolute URL → host vergelijken
      try {
        const u = new URL(href)
        const host = u.hostname.toLowerCase().replace(/^www\./, '')
        if (internalHosts.has(host)) {
          isInternal = true
        }
      } catch {
        // Relatieve URL zonder /, behandel als intern
        isInternal = true
      }
    }

    // Verwijder bestaande target/rel attributen
    attrs = attrs
      .replace(/\s+target\s*=\s*(['"])[^'"]*\1/gi, '')
      .replace(/\s+rel\s*=\s*(['"])[^'"]*\1/gi, '')

    if (isInternal) {
      // intern: geen target, geen rel — opent in zelfde tab
      return `<a${attrs}>`
    } else {
      // extern: nieuw tabblad + veilige rel
      return `<a${attrs} target="_blank" rel="noopener noreferrer">`
    }
  })
}
