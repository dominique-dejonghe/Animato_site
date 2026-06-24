#!/usr/bin/env node
/**
 * check-naive-dates.mjs
 *
 * Detecteer gevaarlijke `new Date(<db-veld>)` patronen die op Cloudflare Workers
 * (UTC runtime) verkeerd geïnterpreteerd worden voor naive Brussels-strings.
 *
 * ACHTERGROND
 * -----------
 * `new Date("2026-10-10T19:30")` zonder Z parsed dit op Workers als UTC.
 * Bij weergave in Brussels timezone shift het uur dan +1u (winter) of +2u (zomer).
 * Dancing Voices stond daardoor op 21:30 ipv 19:30 op /tickets/127.
 *
 * Gebruik in plaats daarvan de helpers uit `src/utils/time.ts`:
 *   - parseBrusselsDate(input)       → Date object met juiste timezone
 *   - formatBrusselsTime(input)      → "19:30"
 *   - formatBrusselsDate(input, ...) → "zaterdag 10 oktober 2026"
 *   - formatBrusselsDateTime(input)  → "10 okt 2026 19:30"
 *
 * MODES
 * -----
 *   npm run check:dates           → check, faalt bij nieuwe overtredingen
 *   npm run check:dates -- --list → lijst alle hits zonder te falen
 *   npm run check:dates -- --update-baseline → herschrijf baseline
 *
 * Baseline-bestand: scripts/.naive-dates-baseline.json
 * Bevat de huidige (legacy) hits die we NIET onmiddellijk gaan fixen.
 * Nieuwe hits = build failure.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BASELINE_PATH = join(__dirname, '.naive-dates-baseline.json')

// Velden uit de DB die naive Brussels-strings bevatten (geen Z, geen offset)
const DB_TIME_FIELDS = [
  'start_at',
  'end_at',
  'voorverkoop_start_at',
  'doors_open_at',
  'published_at',
  'created_at',
  'updated_at',
  'concert_start_at',
  'event_start_at',
  'geboortedatum',
  'lid_sinds',
  'datum',
  'deadline',
  'deadline_at',
]

// Bestanden waar `new Date(...)` op DB-velden WEL mag (de helpers zelf)
const ALLOWED_FILES = new Set([
  'src/utils/time.ts',
])

const args = process.argv.slice(2)
const MODE_LIST = args.includes('--list')
const MODE_UPDATE = args.includes('--update-baseline')

// Bouw regex: new Date(...veld...) waar veld een DB-tijdveld is
const fieldsAlt = DB_TIME_FIELDS.join('|')
const dangerousRegex = new RegExp(
  String.raw`new\s+Date\s*\([^)]*\b(${fieldsAlt})\b`,
  'g'
)

function findSourceFiles() {
  const out = execSync(
    'git ls-files "src/*.ts" "src/*.tsx" "src/**/*.ts" "src/**/*.tsx"',
    { cwd: ROOT, encoding: 'utf8' }
  )
  return out.split('\n').filter(Boolean)
}

function scan() {
  const hits = []
  for (const file of findSourceFiles()) {
    if (ALLOWED_FILES.has(file)) continue
    const abs = join(ROOT, file)
    const content = readFileSync(abs, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      dangerousRegex.lastIndex = 0
      let m
      while ((m = dangerousRegex.exec(line)) !== null) {
        hits.push({
          file,
          line: i + 1,
          field: m[1],
          snippet: line.trim().slice(0, 120),
        })
      }
    }
  }
  return hits
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set()
  const data = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  return new Set(data.entries.map(e => `${e.file}:${e.field}`))
}

function saveBaseline(hits) {
  // Sla per (file, field) op, zonder regelnummer — anders elke refactor breekt het.
  const seen = new Set()
  const entries = []
  for (const h of hits) {
    const key = `${h.file}:${h.field}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ file: h.file, field: h.field })
  }
  entries.sort((a, b) => (a.file + a.field).localeCompare(b.file + b.field))
  const out = {
    description:
      'Baseline van bestaande naive `new Date(<db-veld>)` overtredingen. ' +
      'Nieuwe hits zijn build-fouten. Fix legacy en run `npm run check:dates -- --update-baseline`.',
    generated_at: new Date().toISOString(),
    count: entries.length,
    entries,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n')
}

const hits = scan()

if (MODE_UPDATE) {
  saveBaseline(hits)
  const uniq = new Set(hits.map(h => `${h.file}:${h.field}`)).size
  console.log(`✅ Baseline bijgewerkt: ${uniq} unieke (file,field) combinaties opgeslagen.`)
  console.log(`   (${hits.length} totale callsites — meerdere op zelfde file/field tellen als 1 entry)`)
  process.exit(0)
}

if (MODE_LIST) {
  console.log(`📋 Alle gevonden hits (${hits.length}):\n`)
  for (const h of hits) {
    console.log(`  ${h.file}:${h.line}  [${h.field}]`)
    console.log(`    ${h.snippet}`)
  }
  process.exit(0)
}

// Standaard mode: vergelijk met baseline, faal bij nieuwe overtredingen
const baseline = loadBaseline()
const newHits = hits.filter(h => !baseline.has(`${h.file}:${h.field}`))

if (newHits.length === 0) {
  console.log(`✅ Geen NIEUWE naive-date overtredingen (${hits.length} legacy hits in baseline).`)
  process.exit(0)
}

console.error(`\n❌ ${newHits.length} NIEUWE naive-date overtreding(en) gevonden:\n`)
for (const h of newHits) {
  console.error(`  ${h.file}:${h.line}  [${h.field}]`)
  console.error(`    ${h.snippet}`)
}
console.error(`\n💡 Op Cloudflare Workers (UTC runtime) levert \`new Date("2026-10-10T19:30")\``)
console.error(`   een tijd op die +1u (winter) of +2u (zomer) afwijkt van Brussels.`)
console.error(`\n   Gebruik in plaats daarvan:`)
console.error(`     import { parseBrusselsDate, formatBrusselsTime, formatBrusselsDate,`)
console.error(`              formatBrusselsDateTime } from '../utils/time'`)
console.error(`\n     const d = parseBrusselsDate(row.start_at)  // ✅`)
console.error(`     formatBrusselsTime(row.start_at)            // "19:30"`)
console.error(`\n   Als deze hit een false positive is (bv. ISO-string mét Z), voeg toe aan`)
console.error(`   baseline: npm run check:dates -- --update-baseline\n`)
process.exit(1)
