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

/**
 * Bug #213 — historische conventie in deze codebase: datetime-strings
 * zonder timezone-suffix (geen 'Z', geen '+02:00') zijn ALTIJD bedoeld als
 * Brussels-lokale tijd. Cloudflare Workers draait in UTC, en `new Date()`
 * interpreteert een naive string daar als UTC → uur schuift +1u in winter,
 * +2u in zomer.
 *
 * Deze helper detecteert naive strings en zet er de juiste Brussels-offset
 * achter (bv. `+01:00` of `+02:00`) zodat `new Date()` ze correct laadt.
 *
 * Records mét Z of expliciete offset blijven onaangeraakt.
 */
function isNaiveLocalString(s: string): boolean {
  // "2026-05-09T19:30" of "2026-05-09T19:30:00" — geen Z, geen +HH:MM
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
}

/**
 * Geeft de Brussels-offset (in minuten t.o.v. UTC) voor een naive
 * Brussels-tijdstring. Houdt rekening met DST.
 * Voorbeeld: "2026-07-15T14:00" → 120 (CEST = UTC+2)
 *           "2026-12-15T14:00" → 60  (CET  = UTC+1)
 */
function brusselsOffsetMinutesFor(naiveLocal: string): number {
  // Interpreteer eerst als UTC om een referentiemoment te krijgen
  const asUtc = new Date(naiveLocal.length === 16 ? naiveLocal + ':00Z' : naiveLocal + 'Z')
  if (isNaN(asUtc.getTime())) return 60 // fallback CET
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRUSSELS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(asUtc)
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00'
  let brusHour = parseInt(get('hour'), 10)
  if (brusHour === 24) brusHour = 0
  const brusAsUtc = Date.UTC(
    parseInt(get('year'), 10),
    parseInt(get('month'), 10) - 1,
    parseInt(get('day'), 10),
    brusHour,
    parseInt(get('minute'), 10),
    parseInt(get('second'), 10)
  )
  return Math.round((brusAsUtc - asUtc.getTime()) / 60000)
}

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === '') return null
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input
  if (typeof input === 'number') {
    const d = new Date(input)
    return isNaN(d.getTime()) ? null : d
  }
  const s = String(input).trim()
  // Naive Brussels-local string? Hang de juiste offset eraan zodat
  // `new Date()` 'm niet als UTC interpreteert.
  if (isNaiveLocalString(s)) {
    const offsetMin = brusselsOffsetMinutesFor(s)
    const sign = offsetMin >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMin)
    const hh = String(Math.floor(abs / 60)).padStart(2, '0')
    const mm = String(abs % 60).padStart(2, '0')
    const padded = s.length === 16 ? s + ':00' : s
    const d = new Date(`${padded}${sign}${hh}:${mm}`)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
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
 * Converteert een naive datetime-local string ("2026-06-15T20:00") die de
 * gebruiker invoerde in Brussels-tijd, naar een UTC ISO-string voor
 * opslag in de DB. Houdt rekening met DST (zomer/winter).
 *
 * Voorbeeld: "2026-06-15T20:00" (zomer, CEST = UTC+2) → "2026-06-15T18:00:00.000Z"
 *           "2026-12-15T20:00" (winter, CET = UTC+1) → "2026-12-15T19:00:00.000Z"
 *
 * Werkt door eerst een Date te maken van de naive string (die door JS als
 * UTC wordt geïnterpreteerd), dan te kijken hoeveel uren Brussels verschuift
 * t.o.v. UTC op die datum, en dan dat verschil ervan af te trekken.
 */
export function brusselsLocalToUTC(localStr: string | null | undefined): string | null {
  if (!localStr) return null
  // Forceer formaat "YYYY-MM-DDTHH:MM" (HTML datetime-local input)
  const s = String(localStr).trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s // onbekend formaat → laat staan

  // Stap 1: maak een Date alsof het UTC was (naive string + 'Z')
  const naiveAsUTC = new Date(s.length === 16 ? s + ':00Z' : s + 'Z')
  if (isNaN(naiveAsUTC.getTime())) return s

  // Stap 2: bepaal de Brussels-offset op dat moment
  // We kijken hoe Intl 'this naieve datum' in Brussels zou renderen,
  // en vergelijken met UTC om de offset (in ms) te krijgen.
  const brusselsParts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRUSSELS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(naiveAsUTC)
  const get = (t: string) => brusselsParts.find(p => p.type === t)?.value || '00'
  // Brussels-equivalent van naiveAsUTC (alsof het echt UTC was)
  const brusselsHour = parseInt(get('hour'), 10)
  const brusselsAsIfUTC = new Date(Date.UTC(
    parseInt(get('year'), 10),
    parseInt(get('month'), 10) - 1,
    parseInt(get('day'), 10),
    brusselsHour === 24 ? 0 : brusselsHour,
    parseInt(get('minute'), 10),
    parseInt(get('second'), 10)
  ))
  const offsetMs = brusselsAsIfUTC.getTime() - naiveAsUTC.getTime()

  // Stap 3: trek de offset af van de naive-as-UTC interpretatie
  return new Date(naiveAsUTC.getTime() - offsetMs).toISOString()
}

/**
 * Inverse van brusselsLocalToUTC: UTC ISO-string → "YYYY-MM-DDTHH:mm" voor
 * een HTML datetime-local input, in Brussels-tijd.
 * Voorbeeld: "2026-06-15T18:00:00Z" → "2026-06-15T20:00" (zomer, CEST)
 */
export function utcToBrusselsLocal(input: DateInput): string {
  // Bug #213 — naive strings ("2026-05-09T19:30") zijn al Brussels-lokaal,
  // gewoon eerste 16 chars teruggeven. Records mét Z worden via toDate()
  // correct geparsed en daarna in Brussels-tijd geformatteerd.
  if (typeof input === 'string') {
    const s = input.trim()
    if (isNaiveLocalString(s)) {
      return s.length >= 16 ? s.substring(0, 16) : s
    }
  }
  const d = toDate(input)
  if (!d) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRUSSELS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00'
  // en-CA geeft "2026-06-15, 20:00" — wij willen "2026-06-15T20:00"
  let hour = get('hour')
  if (hour === '24') hour = '00' // Edge case: middernacht wordt soms als 24:00 gerapporteerd
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
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
