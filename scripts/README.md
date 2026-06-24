# scripts/

Project-utility scripts. Runnen via `npm run <script>`.

## `check-naive-dates.mjs`

Detecteert het `new Date(<db-veld>)` patroon dat op Cloudflare Workers
(UTC runtime) verkeerd geïnterpreteerd wordt voor naive Brussels-strings.

### Waarom

`new Date("2026-10-10T19:30")` — een string zónder `Z` of offset — wordt op
Cloudflare Workers geparsed als **UTC**. Op een laptop met Brussels-locale
parse hij als local time. Dat verschil veroorzaakte de Dancing Voices bug:
tickets toonden 21:30 (zomer) of 20:30 (winter) ipv 19:30.

Bug #213 fixte dit in `src/utils/time.ts`, maar de helpers werden niet overal
gebruikt. Deze check voorkomt dat het opnieuw insluipt.

### Commands

```bash
npm run check:dates                  # standaard: faal bij nieuwe overtredingen
npm run check:dates:list             # toon alle hits (geen fail)
npm run check:dates:update-baseline  # herschrijf baseline na grote refactor
```

De check loopt automatisch als `prebuild` step in `npm run build`.

### Wanneer baseline updaten?

- Je hebt legacy callsites **gefixt** (van `new Date(row.start_at)` →
  `parseBrusselsDate(row.start_at)`). Dan update je de baseline om die niet
  meer als legacy te tellen.
- Een hit is een **false positive** (bv. een commentaar of een variabele die
  toevallig `start_at` heet maar geen DB-veld is). Dan accepteer je het via
  baseline-update.

```bash
npm run check:dates:update-baseline
git add scripts/.naive-dates-baseline.json
git commit -m "chore(time): update baseline na fix van X callsites"
```

### Wat met écht nieuwe DB-velden met tijd?

Voeg ze toe aan `DB_TIME_FIELDS` in `check-naive-dates.mjs`.

### Correct gebruik in code

```typescript
import {
  parseBrusselsDate,    // → Date object
  formatBrusselsTime,   // → "19:30"
  formatBrusselsDate,   // → "zaterdag 10 oktober 2026"
  formatBrusselsDateTime, // → "10 okt 2026 19:30"
} from '../utils/time'

// ❌ FOUT — op Workers shift dit +1u/+2u
const d = new Date(row.start_at)

// ✅ GOED
const d = parseBrusselsDate(row.start_at)
const tijd = formatBrusselsTime(row.start_at)
```
