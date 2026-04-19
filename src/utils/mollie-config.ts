// ============================================================
// Mollie Configuration Helper
// ============================================================
// Haalt de actieve Mollie API-key op.
// Prioriteit:
//   1. system_settings.mollie_api_key (bewerkbaar via /admin/settings)
//   2. env.MOLLIE_API_KEY (Cloudflare secret)
//   3. 'mock' → simuleert betalingen in dev
// ============================================================

import { queryOne } from './db'

let cachedKey: { value: string; fetchedAt: number } | null = null
const CACHE_MS = 60_000 // 1 minuut — instellingen veranderen zelden

/**
 * Haal de actieve Mollie API-key op voor deze deployment.
 * Gebruikt een korte in-memory cache om DB-roundtrips per request te vermijden.
 */
export async function getMollieApiKey(env: any): Promise<string> {
  // Cache-hit?
  if (cachedKey && Date.now() - cachedKey.fetchedAt < CACHE_MS) {
    return cachedKey.value
  }

  let key: string | null = null

  // 1. Probeer uit system_settings
  try {
    const row = await queryOne<any>(
      env.DB,
      `SELECT value FROM system_settings WHERE key = 'mollie_api_key' LIMIT 1`
    )
    if (row?.value && String(row.value).trim()) {
      key = String(row.value).trim()
    }
  } catch (_) {
    // tabel bestaat niet in oudere dev-DB's — negeren
  }

  // 2. Fallback op Cloudflare secret
  if (!key) {
    key = env.MOLLIE_API_KEY || ''
  }

  // 3. Ultieme fallback: mock-modus
  if (!key || !key.trim()) {
    key = 'mock'
  }

  cachedKey = { value: key, fetchedAt: Date.now() }
  return key
}

/** Forceer een cache-reset (bv. direct na het opslaan van instellingen). */
export function invalidateMollieApiKeyCache(): void {
  cachedKey = null
}
