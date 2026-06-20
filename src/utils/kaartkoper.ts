// Kaartkoper-account helpers
// --------------------------
// Maakt een passwordless kaartkoper-account aan na een ticketbestelling,
// zodat de koper via een magic-link in de bevestigingsmail zijn wachtwoord
// kan instellen en daarna zijn tickets/profiel kan beheren.
//
// Belangrijk:
// - Werkt enkel voor e-mailadressen die NOG geen user-account hebben.
//   Bestaande leden (rol 'lid' enz.) blijven hun rol en wachtwoord behouden.
// - Genereert een setup-token dat 14 dagen geldig is.
// - Maakt een lege profile-row aan (voornaam = koper_naam, vóórbij gesplitst).

import type { D1Database } from '@cloudflare/workers-types'
import { generateRandomToken, hashPassword } from './auth'

const SETUP_TOKEN_TTL_DAYS = 14

/**
 * Splits "Voornaam Achternaam Met Spaties" naïef in voornaam + achternaam.
 * "Jan" → ('Jan', '')
 * "Jan Janssens" → ('Jan', 'Janssens')
 * "Jan Pieter Van Den Bosch" → ('Jan', 'Pieter Van Den Bosch')
 */
function splitFullName(name: string): { voornaam: string; achternaam: string } {
  const parts = String(name || '').trim().split(/\s+/)
  if (parts.length === 0 || (parts.length === 1 && !parts[0])) {
    return { voornaam: '', achternaam: '' }
  }
  if (parts.length === 1) return { voornaam: parts[0], achternaam: '' }
  return { voornaam: parts[0], achternaam: parts.slice(1).join(' ') }
}

export interface EnsureKaartkoperResult {
  /** true als er een NIEUW kaartkoper-account is aangemaakt */
  created: boolean
  /** Setup-token alleen meegegeven als created=true (voor de magic-link) */
  setup_token: string | null
  /** user.id van de (nieuwe of bestaande) gebruiker — null als er iets misging */
  user_id: number | null
}

/**
 * Maakt een kaartkoper-account aan voor een ticketkoper, ALS er nog geen
 * user-account bestaat met dat e-mailadres.
 *
 * Idempotent: als de user al bestaat (om het even welke rol), gebeurt er niets
 * en is created=false. Bestaande leden blijven dus volledig met rust.
 *
 * @returns object met `created` (true = nieuwe kaartkoper, mail magic-link!) en
 *          `setup_token` (alleen bij created=true) en `user_id`.
 */
export async function ensureKaartkoperAccount(
  db: D1Database,
  koperEmail: string,
  koperNaam: string
): Promise<EnsureKaartkoperResult> {
  const email = String(koperEmail || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return { created: false, setup_token: null, user_id: null }
  }

  // Bestaat er al een user met dit email? (collation NOCASE op email)
  const existing = await db.prepare(
    `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`
  ).bind(email).first<{ id: number }>()

  if (existing) {
    // Bestaande account — laat hem volledig met rust. Geen rol-wijziging,
    // geen profile-overschrijven, geen token-reset.
    return { created: false, setup_token: null, user_id: existing.id }
  }

  // Nieuwe kaartkoper — random "placeholder" wachtwoord-hash (kan toch niet
  // gebruikt worden tot account_setup_completed=1 + nieuwe hash gezet via /account/setup).
  const placeholderPassword = generateRandomToken(32)
  const placeholderHash = await hashPassword(placeholderPassword)

  const setupToken = generateRandomToken(40)
  const expires = new Date(Date.now() + SETUP_TOKEN_TTL_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) // SQLite-stijl: "YYYY-MM-DD HH:MM:SS"

  const insert = await db.prepare(`
    INSERT INTO users (
      email, password_hash, role, status, email_verified,
      account_setup_token, account_setup_token_expires, account_setup_completed
    ) VALUES (?, ?, 'kaartkoper', 'actief', 0, ?, ?, 0)
  `).bind(email, placeholderHash, setupToken, expires).run()

  const userId = (insert as any)?.meta?.last_row_id as number | undefined
  if (!userId) {
    return { created: false, setup_token: null, user_id: null }
  }

  // Profile aanmaken met de naam uit de bestelling (best effort splitsing)
  const { voornaam, achternaam } = splitFullName(koperNaam)
  try {
    await db.prepare(`
      INSERT INTO profiles (user_id, voornaam, achternaam)
      VALUES (?, ?, ?)
    `).bind(userId, voornaam, achternaam).run()
  } catch (e) {
    // Profile-creatie is niet kritiek — gebruiker kan later zelf invullen
    console.warn('[kaartkoper] profile insert faalde:', (e as any)?.message)
  }

  // Audit
  try {
    await db.prepare(`
      INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
      VALUES (NULL, 'kaartkoper_account_created', 'users', ?, ?)
    `).bind(userId, JSON.stringify({ email, koperNaam })).run()
  } catch (_) { /* niet kritiek */ }

  return { created: true, setup_token: setupToken, user_id: userId }
}
