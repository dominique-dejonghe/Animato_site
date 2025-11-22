# 🎵 Concert Setup Checklist

## Probleem: Concert niet zichtbaar?

Als je een concert aanmaakt maar het verschijnt niet op de website of in het admin dashboard, check deze punten:

---

## ✅ Checklist voor Concert Zichtbaarheid

### 1. Events Tabel (`events`)

Een concert moet een rij hebben in de `events` tabel met:

```sql
SELECT 
  id, 
  titel, 
  type, 
  is_publiek, 
  start_at 
FROM events 
WHERE id = JOUW_EVENT_ID;
```

**Vereist**:
- ✅ `type = 'concert'`
- ✅ `is_publiek = 1` (voor publieke zichtbaarheid)
- ✅ `start_at >= now()` (toekomstige datum)

**Fix als is_publiek = 0**:
```sql
UPDATE events SET is_publiek = 1 WHERE id = JOUW_EVENT_ID;
```

---

### 2. Concerts Tabel (`concerts`)

Voor **ticketing functionaliteit** moet er ook een rij zijn in de `concerts` tabel:

```sql
SELECT 
  c.*,
  e.titel
FROM concerts c
JOIN events e ON e.id = c.event_id
WHERE c.event_id = JOUW_EVENT_ID;
```

**Vereist**:
- ✅ `event_id` = het event ID
- ✅ `ticketing_enabled = 1`
- ✅ `capaciteit` > 0
- ✅ `prijsstructuur` JSON met categorieën

**Fix als concerts rij ontbreekt**:
```sql
INSERT INTO concerts (
  event_id,
  programma,
  prijsstructuur,
  capaciteit,
  verkocht,
  ticketing_enabled,
  ticketing_provider,
  uitverkocht
) VALUES (
  JOUW_EVENT_ID,
  'Concert programma beschrijving',
  '[{"categorie":"Volwassenen","prijs":15},{"categorie":"Kinderen","prijs":8}]',
  200,           -- Capaciteit
  0,             -- Verkocht (start bij 0)
  1,             -- Ticketing enabled
  'intern',      -- Provider
  0              -- Niet uitverkocht
);
```

---

## 📍 Waar Verschijnt Een Concert?

### Publieke Pagina's

**1. `/concerten` - Concert Overzicht**
- Query: `SELECT * FROM events WHERE type='concert' AND is_publiek=1`
- Vereist: `is_publiek = 1`

**2. `/agenda` - Agenda Pagina**  
- Query: `SELECT * FROM events WHERE is_publiek=1 AND start_at >= now()`
- Vereist: `is_publiek = 1` EN toekomstige datum

**3. `/concerten/:slug` - Concert Detail**
- URL gebaseerd op `slug` kolom
- Vereist: `slug` ingesteld, `is_publiek = 1`

**4. `/concerten/:eventId/tickets` - Ticket Bestelpagina**
- Vereist: 
  - Concert rij in `concerts` tabel
  - `ticketing_enabled = 1`
  - Niet uitverkocht
  - Toekomstige datum

### Admin Pagina's

**1. `/admin/tickets` - Ticketing Dashboard**
- Query: `SELECT * FROM concerts JOIN events WHERE type='concert'`
- Vereist: **BEIDE** tabellen (events + concerts)
- Toont stats: verkocht, omzet, capaciteit

**2. `/admin/events` - Events Beheer**
- Query: `SELECT * FROM events`
- Toont ALLE events (ook zonder concerts rij)

---

## 🛠️ Handige Debug Queries

### Check Concert Status
```sql
-- Volledige concert status
SELECT 
  e.id as event_id,
  e.titel,
  e.type,
  e.is_publiek,
  e.start_at,
  c.id as concert_id,
  c.ticketing_enabled,
  c.capaciteit,
  c.verkocht
FROM events e
LEFT JOIN concerts c ON c.event_id = e.id
WHERE e.titel LIKE '%ZOEKTERM%';
```

### Alle Concerten Met Status
```sql
SELECT 
  e.id,
  e.titel,
  e.start_at,
  CASE WHEN e.is_publiek = 1 THEN '✅ Publiek' ELSE '❌ Privé' END as zichtbaarheid,
  CASE WHEN c.id IS NOT NULL THEN '✅ Ja' ELSE '❌ Nee' END as heeft_ticketing,
  COALESCE(c.capaciteit, 0) as capaciteit,
  COALESCE(c.verkocht, 0) as verkocht
FROM events e
LEFT JOIN concerts c ON c.event_id = e.id
WHERE e.type = 'concert'
ORDER BY e.start_at DESC;
```

### Verkoop Statistieken
```sql
SELECT 
  e.titel,
  c.capaciteit,
  c.verkocht,
  COUNT(t.id) as aantal_bestellingen,
  SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) as betaalde_orders,
  SUM(CASE WHEN t.status = 'paid' THEN t.prijs_totaal ELSE 0 END) as totale_omzet
FROM concerts c
JOIN events e ON e.id = c.event_id
LEFT JOIN tickets t ON t.concert_id = c.id
GROUP BY c.id
ORDER BY e.start_at DESC;
```

---

## 🎯 Typische Problemen & Oplossingen

### ❌ "Geen concerten gepland"

**Oorzaak**: `is_publiek = 0` of datum in verleden

**Oplossing**:
```sql
-- Check status
SELECT id, titel, is_publiek, start_at FROM events WHERE type='concert';

-- Fix publiek flag
UPDATE events SET is_publiek = 1 WHERE id = X;

-- Fix datum (als nodig)
UPDATE events SET start_at = '2026-12-31 20:00' WHERE id = X;
```

### ❌ "Concert wel zichtbaar maar geen tickets beschikbaar"

**Oorzaak**: Geen `concerts` tabel rij

**Oplossing**:
```sql
-- Check of concerts rij bestaat
SELECT * FROM concerts WHERE event_id = X;

-- Als NULL, maak aan:
INSERT INTO concerts (event_id, prijsstructuur, capaciteit, ticketing_enabled)
VALUES (X, '[{"categorie":"Standaard","prijs":15}]', 200, 1);
```

### ❌ "Admin dashboard toont 0 concerten"

**Oorzaak**: Geen concerts tabel rijen

**Oplossing**:
```sql
-- Check welke events geen concerts rij hebben
SELECT e.id, e.titel
FROM events e
LEFT JOIN concerts c ON c.event_id = e.id
WHERE e.type = 'concert' AND c.id IS NULL;

-- Maak concerts rij aan voor elk event
INSERT INTO concerts (event_id, ticketing_enabled, capaciteit)
VALUES (EVENT_ID, 1, 200);
```

### ❌ "Prijzen worden niet getoond"

**Oorzaak**: Ongeldige JSON in `prijsstructuur`

**Oplossing**:
```sql
-- Check huidige prijsstructuur
SELECT prijsstructuur FROM concerts WHERE id = X;

-- Update met correcte JSON
UPDATE concerts 
SET prijsstructuur = '[
  {"categorie":"Volwassenen","prijs":15,"beschrijving":"Standaard toegang"},
  {"categorie":"Kinderen","prijs":8,"beschrijving":"Tot 12 jaar"},
  {"categorie":"Studenten","prijs":10,"beschrijving":"Met studentenkaart"}
]'
WHERE id = X;
```

---

## 📝 Best Practices

### Bij Aanmaken Nieuw Concert

**Via Admin UI** (aanbevolen):
1. Ga naar `/admin/events/nieuw?type=concert`
2. Vul alle velden in
3. ✅ **Zet "Publiek zichtbaar" aan**
4. ✅ **Enable ticketing**
5. ✅ **Vul prijsstructuur in**
6. Save

**Via Database** (als UI niet werkt):
```sql
-- Stap 1: Maak event aan
INSERT INTO events (type, titel, slug, start_at, end_at, locatie, is_publiek, doelgroep)
VALUES (
  'concert',
  'Mijn Concert',
  'mijn-concert',
  '2026-06-15 20:00',
  '2026-06-15 22:00',
  'Concerthal',
  1,  -- Publiek!
  'all'
);

-- Stap 2: Haal event_id op
SELECT id FROM events WHERE slug = 'mijn-concert';

-- Stap 3: Maak concerts rij aan
INSERT INTO concerts (event_id, ticketing_enabled, capaciteit, prijsstructuur)
VALUES (
  EVENT_ID_VAN_STAP_2,
  1,
  200,
  '[{"categorie":"Standaard","prijs":15}]'
);
```

### Prijsstructuur JSON Format

**Minimaal**:
```json
[{"categorie":"Standaard","prijs":15}]
```

**Aanbevolen**:
```json
[
  {
    "categorie": "Volwassenen",
    "prijs": 15,
    "beschrijving": "Standaard toegang"
  },
  {
    "categorie": "Kinderen",
    "prijs": 8,
    "beschrijving": "Tot 12 jaar"
  },
  {
    "categorie": "Studenten",
    "prijs": 10,
    "beschrijving": "Met geldige studentenkaart"
  }
]
```

---

## 🧪 Test Commands

```bash
# Database query via command line
cd /home/user/webapp
npx wrangler d1 execute animato-production --local --command="
SELECT * FROM events WHERE type='concert' LIMIT 5
"

# Check specific concert
npx wrangler d1 execute animato-production --local --command="
SELECT e.*, c.* 
FROM events e 
LEFT JOIN concerts c ON c.event_id = e.id 
WHERE e.id = 225
"

# Test publieke concerten pagina
curl -s http://localhost:3000/concerten | grep -i "titel_van_concert"

# Test admin tickets pagina (requires login)
curl -s http://localhost:3000/admin/tickets -H "Cookie: auth_token=JOUW_TOKEN"
```

---

## ⚠️ Belangrijke Notes

1. **BEIDE tabellen nodig**: Een concert heeft ALTIJD een rij nodig in zowel `events` als `concerts` tabel
2. **is_publiek flag**: Moet `1` zijn voor publieke zichtbaarheid
3. **Toekomstige datum**: `start_at` moet in de toekomst liggen
4. **JSON validatie**: Prijsstructuur moet valide JSON zijn
5. **Slug uniek**: De `slug` moet uniek zijn voor de URL
6. **Capaciteit**: Mag 0 zijn voor onbeperkt, of > 0 voor beperkte capaciteit

---

## 🆘 Hulp Nodig?

Check de logs:
```bash
pm2 logs animato-koor
```

Database console:
```bash
npx wrangler d1 execute animato-production --local
```

Test queries:
- Zie "Debug Queries" sectie hierboven
- Alle queries testen met `--local` flag voor lokale database
- Verwijder `--local` voor productie database

---

**💡 Pro Tip**: Gebruik altijd de admin UI om concerten aan te maken. Die zorgt automatisch voor beide database rijen en correcte flags!
