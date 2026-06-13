/**
 * Seat lock management for ticket_seats.
 *
 * Workflow:
 *  1. Bij INSERT in tickets.tsx (POST /api/tickets/order) krijgt elke ticket_seats-rij
 *     status='locked' en lock_expires_at = NOW + 15 min.
 *  2. Bij webhook 'paid' (webhooks.tsx) wordt locked -> sold gezet en lock_expires_at -> NULL.
 *  3. Bij webhook 'cancelled'/'expired'/'failed' wordt locked -> released gezet (soft delete,
 *     zodat we kunnen zien dat de stoel ooit gereserveerd was).
 *  4. Bij elke seat-listing (publieke seat picker + admin zaalplan-view) wordt
 *     releaseStaleLocks() eerst aangeroepen. Stoelen waarvan lock_expires_at < NOW
 *     en status='locked' worden op 'released' gezet.
 *
 * De UNIQUE(seat_id, concert_id) constraint op ticket_seats betekent dat we per stoel
 * per concert maar één actieve rij hebben. 'released' rijen blijven liggen voor audit
 * maar door de UNIQUE-constraint moeten we eerst de oude rij verwijderen voor een nieuwe
 * INSERT. Daarom werkt cleanup met DELETE in plaats van UPDATE voor stale locks.
 */
import { execute } from './db'

export const SEAT_LOCK_MINUTES = 15

/**
 * Verwijdert ticket_seats-rijen die meer dan SEAT_LOCK_MINUTES geleden gelockt zijn
 * en nooit op 'sold' zijn gezet (de webhook is nooit gekomen, of de gebruiker heeft
 * de Mollie checkout afgesloten).
 *
 * We DELETEN bewust ipv 'released' status omdat de UNIQUE(seat_id, concert_id) constraint
 * anders nieuwe boekingen blokkeert. De audit-trail loopt via de gekoppelde tickets-row
 * (die heeft status='cancelled' of 'pending' afhankelijk van Mollie).
 *
 * Best-effort: faalt stil. Mag de seat-picker nooit blokkeren.
 */
export async function releaseStaleLocks(
  db: D1Database,
  concertId?: number | string
): Promise<{ released: number }> {
  try {
    // Twee paden:
    // - concertId gegeven: enkel die stoelen
    // - geen concertId: alle stale locks (voor cron / admin-batch)
    const sql = concertId
      ? `DELETE FROM ticket_seats
         WHERE status = 'locked'
           AND lock_expires_at IS NOT NULL
           AND lock_expires_at < CURRENT_TIMESTAMP
           AND concert_id = ?`
      : `DELETE FROM ticket_seats
         WHERE status = 'locked'
           AND lock_expires_at IS NOT NULL
           AND lock_expires_at < CURRENT_TIMESTAMP`
    const params = concertId ? [concertId] : []
    const result = await execute(db, sql, params)
    // D1 result heeft meta.changes
    const released = (result as any)?.meta?.changes ?? 0
    return { released }
  } catch (e) {
    console.error('[releaseStaleLocks] faalde:', e)
    return { released: 0 }
  }
}

/**
 * Geeft een ISO-timestamp string terug voor NOW + SEAT_LOCK_MINUTES,
 * geschikt voor SQLite DATETIME-kolommen.
 * SQLite-vriendelijk: 'YYYY-MM-DD HH:MM:SS' UTC formaat.
 */
export function lockExpiryTimestamp(): string {
  const d = new Date(Date.now() + SEAT_LOCK_MINUTES * 60 * 1000)
  // Format: YYYY-MM-DD HH:MM:SS (UTC, geen 'Z' of 'T')
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
