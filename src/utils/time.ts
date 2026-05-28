/**
 * time.ts — centrale timezone-helpers voor Animato.
 *
 * PROBLEEM: Cloudflare Workers/Pages draaien altijd in UTC. Onze database
 * slaat timestamps op als ISO-strings (UTC). Maar gebruikers (in België)
 * verwachten Brussels-tijd in de UI.
 *
 * Als je `new Date(isoString).toLocaleString('nl-BE', ...)` doet ZONDER
 * een `timeZone` optie, gebruikt de Workers-runtime UTC. Resultaat: een
 * betaling om 07:53 Brussels (zomertijd) wordt getoond als 05:53 — een
 * verschil van 2 uur dat gebruikers terecht verwart.
 *
 * Deze helpers wikkelen alle datum-formatting zodat we ALTIJD in
 * Brussels-tijd renderen — ongeacht waar de code draait (server of
 * browser, want browsers buiten BE zien sowieso hun eigen tijdzone als
 * we het niet expliciet zeggen).
 */

export const BRUSSELS_TZ = 'Europe/Brussels'
export const NL_LOCALE = 'nl-BE'

type DateInput = string | number | Date | null | undefined

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === '') return null
  const d = input instanceof Date ? input : new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Formatteert een datum (zonder tijd) in Brussels-tijd, nl-BE locale.
 * Default: '28 mei 2026'
 * Custom: pass extra options like { weekday: 'long' } => 'donderdag 28 mei 2026'
 */
export function formatBrusselsDate(
  input: DateInput,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }
): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleDateString(NL_LOCALE, { ...options, timeZone: BRUSSELS_TZ })
}

/**
 * Formatteert enkel het uur in Brussels-tijd. Default: '14:23'
 */
export function formatBrusselsTime(
  input: DateInput,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleTimeString(NL_LOCALE, { ...options, timeZone: BRUSSELS_TZ })
}

/**
 * Formatteert datum + tijd samen in Brussels-tijd.
 * Default: '28 mei 2026 14:23'
 */
export function formatBrusselsDateTime(
  input: DateInput,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleString(NL_LOCALE, { ...options, timeZone: BRUSSELS_TZ })
}

/**
 * "YYYY-MM-DD" voor Brussels-tijd. Handig voor input[type=date] en CSV.
 * Voorbeeld: 2026-05-28 (gebaseerd op Brussels-kalender, niet UTC).
 */
export function brusselsDateISO(input: DateInput): string {
  const d = toDate(input)
  if (!d) return ''
  // sv-SE locale geeft yyyy-mm-dd uit, met timeZone parameter respecteert het Brussels
  return d.toLocaleDateString('sv-SE', { timeZone: BRUSSELS_TZ })
}

/**
 * Geeft de "vandaag" string in Brussels-tijd (YYYY-MM-DD).
 * Wordt gebruikt om CSV-bestandsnamen en day-comparisons te doen
 * zonder UTC-shift-bugs.
 */
export function brusselsToday(): string {
  return brusselsDateISO(new Date())
}

/**
 * Relatief: "vandaag" / "gisteren" / "X dagen geleden".
 * Berekening op basis van Brussels-kalender.
 */
export function formatBrusselsRelative(input: DateInput): string {
  const d = toDate(input)
  if (!d) return '—'
  const inputDay = brusselsDateISO(d)
  const today = brusselsToday()
  if (inputDay === today) return 'vandaag'

  const yesterday = new Date(Date.now() - 86400000)
  if (inputDay === brusselsDateISO(yesterday)) return 'gisteren'

  // Voor verdere historiek: gewoon datum tonen
  return formatBrusselsDate(d)
}
