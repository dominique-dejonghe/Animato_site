// ============================================================
// Mollie Configuration Helper
// ============================================================
// Haalt de actieve Mollie API-key op.
// Prioriteit:
//   1. system_settings.mollie_api_key (bewerkbaar via /admin/settings)
//   2. env.MOLLIE_API_KEY (Cloudflare secret)
//   3. 'mock' → simuleert betalingen in dev
//
// HISTORY:
// Eerder was er een module-level in-memory cache van 60s. Probleem op
// Cloudflare Workers: elke isolate heeft zijn eigen cache, dus na een
// key-wijziging konden andere isolates (waar de webhook landt) nog 60s
// lang met de OUDE key werken — wat 401's gaf bij Mollie API en de
// status nooit op 'paid' liet komen. Cache nu verwijderd: 1 DB-query
// per Mollie-aanroep (< 2ms in D1) is geen probleem.
// ============================================================

import { queryOne } from './db'

/**
 * Haal de actieve Mollie API-key op voor deze deployment.
 * Geen cache: Cloudflare-isolates delen geen geheugen, dus een module-
 * level cache veroorzaakt stale keys na een instellingenwijziging.
 */
export async function getMollieApiKey(env: any): Promise<string> {
  let key: string | null = null

  // 1. Probeer uit system_settings (admin-bewerkbaar)
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

  return key
}

/**
 * Backwards-compat: oude callers roepen dit aan na key-opslag.
 * Cache bestaat niet meer, dus dit is een no-op (maar veilig te
 * laten staan zodat we geen import-fouten krijgen elders).
 */
export function invalidateMollieApiKeyCache(): void {
  // No-op sinds we de cache verwijderd hebben (zie HISTORY-blok hierboven).
}
