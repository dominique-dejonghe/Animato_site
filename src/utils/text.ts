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

/**
 * Convert plain-text URLs into clickable HTML links + render embed previews
 * for known media providers (YouTube, Vimeo, Spotify, SoundCloud, Google Drive).
 *
 * Returns a HTML-safe string. The original text is HTML-escaped first; URLs are
 * detected on the escaped string (which still contains the original characters
 * for ascii URLs). Multiple line breaks are converted to <br>.
 *
 * Used by /leden/voorstellen and similar pages that store user-typed plain text.
 */
export function linkifyAndEmbed(text: string | null | undefined): string {
  if (!text) return ''
  const escaped = escapeHtml(formatLineBreaks(text))

  // URL regex — captures http(s)://… up to whitespace or end
  const urlRe = /(https?:\/\/[^\s<>"]+)/g

  const embeds: string[] = []
  const seen = new Set<string>()

  const linkified = escaped.replace(urlRe, (rawUrl) => {
    // Trim trailing punctuation that often glues to a URL (.,;:!?)
    let url = rawUrl
    let trail = ''
    while (url.length > 0 && /[.,;:!?)\]]/.test(url[url.length - 1])) {
      trail = url[url.length - 1] + trail
      url = url.slice(0, -1)
    }

    // Build embed if recognised — but only once per URL
    if (!seen.has(url)) {
      const embed = buildEmbed(url)
      if (embed) embeds.push(embed)
      seen.add(url)
    }

    // Display: show the URL as link text (truncate if very long)
    const display = url.length > 80 ? url.slice(0, 77) + '…' : url
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-animato-primary hover:underline break-all">${display}</a>${trail}`
  })

  // Convert line breaks to <br>
  const withBreaks = linkified.replace(/\n/g, '<br />')

  return withBreaks + (embeds.length > 0 ? `<div class="mt-4 space-y-3">${embeds.join('')}</div>` : '')
}

/**
 * Generate an embed/preview block for a known media URL.
 * Returns empty string for unknown URLs.
 */
function buildEmbed(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')

    // YouTube
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vid = u.searchParams.get('v')
      if (vid && /^[\w-]{6,15}$/.test(vid)) {
        return ytEmbed(vid)
      }
      // /shorts/ID or /embed/ID
      const m = u.pathname.match(/\/(shorts|embed)\/([\w-]{6,15})/)
      if (m) return ytEmbed(m[2])
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      if (/^[\w-]{6,15}$/.test(id)) return ytEmbed(id)
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const m = u.pathname.match(/^\/(\d+)/)
      if (m) {
        return `<div class="relative w-full" style="padding-bottom:56.25%"><iframe src="https://player.vimeo.com/video/${m[1]}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen class="absolute inset-0 w-full h-full rounded-lg shadow-sm"></iframe></div>`
      }
    }

    // Spotify (track / album / playlist / episode)
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/)
      if (m) {
        return `<iframe src="https://open.spotify.com/embed/${m[1]}/${m[2]}" loading="lazy" allow="encrypted-media" class="w-full rounded-lg shadow-sm" style="height:${m[1] === 'track' ? '152px' : '352px'}"></iframe>`
      }
    }

    // SoundCloud — use their oEmbed widget
    if (host === 'soundcloud.com' || host === 'snd.sc') {
      const enc = encodeURIComponent(url)
      return `<iframe src="https://w.soundcloud.com/player/?url=${enc}&color=%2336454F&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=true" loading="lazy" allow="autoplay" class="w-full rounded-lg shadow-sm" style="height:166px"></iframe>`
    }

    // Google Drive (preview supports docs/sheets/slides/pdf)
    if (host === 'drive.google.com') {
      // Convert /file/d/ID/view to /file/d/ID/preview
      const fileMatch = u.pathname.match(/^\/file\/d\/([^/]+)/)
      if (fileMatch) {
        return `<iframe src="https://drive.google.com/file/d/${fileMatch[1]}/preview" loading="lazy" class="w-full rounded-lg shadow-sm border border-gray-200" style="height:480px"></iframe>`
      }
    }

    // Direct image (jpg/png/gif/webp)
    if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(u.pathname + u.search)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="" loading="lazy" class="rounded-lg shadow-sm max-h-96 object-contain bg-gray-50 border border-gray-200" /></a>`
    }
  } catch {
    /* ignore malformed URLs */
  }
  return ''
}

function ytEmbed(videoId: string): string {
  return `<div class="relative w-full" style="padding-bottom:56.25%"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="absolute inset-0 w-full h-full rounded-lg shadow-sm"></iframe></div>`
}
