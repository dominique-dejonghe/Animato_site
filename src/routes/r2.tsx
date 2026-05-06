// =============================================================================
// R2 public file server — serveert objecten met long-cache headers
// =============================================================================
// Pad: /r2/<key>   waarbij <key> dezelfde key is als in R2-bucket.
// Voorbeelden:
//   /r2/photos/12/1736-abc.jpg
//   /r2/member-photos/42-1736.jpg
//   /r2/materials/8/1736-xyz.pdf
//
// Caching: 30 dagen, immutable (we genereren altijd nieuwe keys bij upload).
// =============================================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/r2/*', async (c) => {
  const fullPath = c.req.path
  // Strip "/r2/" prefix
  const key = decodeURIComponent(fullPath.replace(/^\/r2\//, ''))
  if (!key) return c.notFound()

  // Defensieve check: geen path traversal
  if (key.includes('..')) return c.text('Bad request', 400)

  if (!c.env.R2) {
    return c.text('R2 binding not configured', 500)
  }

  const obj = await c.env.R2.get(key)
  if (!obj) return c.notFound()

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=2592000, immutable')
  }
  // ETag voor conditional requests
  if (obj.httpEtag) headers.set('etag', obj.httpEtag)

  // 304 Not Modified support
  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch && obj.httpEtag && ifNoneMatch === obj.httpEtag) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(obj.body, { headers })
})

export default app
