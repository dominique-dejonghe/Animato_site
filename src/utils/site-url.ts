// ============================================================
// Site URL Helper
// ============================================================
// Levert de juiste publieke basis-URL voor:
//   - Mollie redirect-URLs (terugkeer na betaling)
//   - Mollie webhook-URLs (Mollie roept ons aan)
//   - Email-links
//
// Prioriteit (eerste niet-lege wint):
//   1. system_settings.site_url        (admin-bewerkbaar via /admin/settings)
//   2. env.SITE_URL                    (Cloudflare env-var, zet in wrangler.json/secret)
//   3. Request-origin (https + host)   (auto-detect bij requests)
//   4. Hardcoded fallback              (www.gemengdkooranimato.be)
//
// Waarom een helper?
//   Eerder stond overal `c.env.SITE_URL || 'https://animato.be'` hardcoded
//   verspreid in 6 bestanden. `animato.be` is echter niet de actieve
//   deployment-host, waardoor Mollie-redirects faalden en webhooks
//   nooit binnenkwamen (ticket bleef vast op 'pending').
// ============================================================

import { queryOne } from './db'
import type { Context } from 'hono'

// Publieke koor-domein — één fallback voor e-mails en publieke links
export const DEFAULT_SITE_URL = 'https://www.gemengdkooranimato.be'

/**
 * Normaliseer een URL-string: trim, strip trailing slash.
 * Geeft '' terug als input ongeldig/leeg is.
 */
function normalize(raw: string | null | undefined): string {
  if (!raw) return ''
  const t = String(raw).trim().replace(/\/+$/, '')
  if (!t) return ''
  // Moet beginnen met http(s)://
  if (!/^https?:\/\//i.test(t)) return ''
  return t
}

/**
 * Sync helper: c.env.SITE_URL met één fallback (geen DB / request-origin).
 * Gebruik dit voor e-mail- en share-links die altijd het publieke domein moeten
 * gebruiken, ook als system_settings.site_url nog een preview-host bevat.
 */
export function siteUrlFromEnv(siteUrl: string | undefined | null): string {
  return normalize(siteUrl) || DEFAULT_SITE_URL
}

/**
 * Detecteer site-origin uit het inkomende request (Hono Context).
 * Werkt voor Cloudflare Pages, custom domains, etc.
 */
function originFromContext(c: Context | undefined): string {
  if (!c) return ''
  try {
    const url = new URL(c.req.url)
    // Forceer https in productie (Cloudflare termineert TLS aan de edge)
    const proto = url.hostname.includes('localhost') ? url.protocol.replace(':', '') : 'https'
    return `${proto}://${url.host}`
  } catch {
    return ''
  }
}

/**
 * Haal de publieke site-URL op (zonder trailing slash).
 *
 * @param c   Hono context — gebruikt voor env-toegang en request-origin fallback.
 *            Mag undefined zijn als je het buiten een request oproept (dan slaan
 *            we stap 3 over).
 *
 * Voorbeeld: 'https://www.gemengdkooranimato.be'
 */
export async function getSiteUrl(c: Context | undefined): Promise<string> {
  // 1. system_settings.site_url (admin-bewerkbaar)
  try {
    if (c?.env?.DB) {
      const row = await queryOne<any>(
        c.env.DB,
        `SELECT value FROM system_settings WHERE key = 'site_url' LIMIT 1`
      )
      const fromDb = normalize(row?.value)
      if (fromDb) return fromDb
    }
  } catch (_) {
    // tabel bestaat niet in dev-DB — negeren
  }

  // 2. env.SITE_URL
  const fromEnv = normalize(c?.env?.SITE_URL)
  if (fromEnv) return fromEnv

  // 3. Request-origin (auto-detect)
  const fromReq = normalize(originFromContext(c))
  if (fromReq) return fromReq

  // 4. Hardcoded fallback
  return DEFAULT_SITE_URL
}
