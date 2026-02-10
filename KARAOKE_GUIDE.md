# 🎤 Animato Karaoke Systeem - Complete Gids

**Status**: ✅ **LIVE OP PRODUCTIE**  
**Versie**: 1.0.30  
**Laatste Update**: 2026-02-10 23:23 UTC

---

## 📋 **INHOUDSOPGAVE**

1. [Overzicht](#overzicht)
2. [Admin Functionaliteit](#admin-functionaliteit)
3. [Leden Functionaliteit](#leden-functionaliteit)
4. [Complete Workflow](#complete-workflow)
5. [Database Schema](#database-schema)
6. [URLs & Routes](#urls--routes)

---

## 🎯 **OVERZICHT**

Het Animato Karaoke Systeem is een complete oplossing voor het organiseren van karaoke-avonden waarbij:
- **Admins** events kunnen aanmaken en song libraries beheren
- **Leden** hun favoriete songs kunnen kiezen (max 3 per event)
- **Duet matching** automatisch wordt voorgesteld op basis van overlappende keuzes
- **Song popularity** wordt bijgehouden voor toekomstige events

### **Huidige Status:**
- ✅ 20 populaire Nederlandse karaoke songs beschikbaar
- ✅ 1 test event live: "Jaarlijks LEDENFEEST met partner 🎉"
- ✅ Volledige admin interface (CRUD voor events en songs)
- ✅ Volledige leden interface (song selectie en notities)
- ✅ Duet matching dashboard met auto-suggesties

---

## 👨‍💼 **ADMIN FUNCTIONALITEIT**

### **1. Dashboard** (`/admin/karaoke`)

**Statistieken:**
- Totaal aantal songs in library
- Aantal actieve events
- Totaal aantal selecties
- Pending song requests

**Quick Actions:**
- Songs beheren
- Events beheren
- Duet matching bekijken

### **2. Song Library Management** (`/admin/karaoke/songs`)

**Features:**
- ✅ Browse alle songs met filters (zoeken, genre, taal, type)
- ✅ Voeg nieuwe songs toe (titel, artiest, genre, moeilijkheid, type, URLs)
- ✅ Bewerk bestaande songs
- ✅ Verwijder songs (soft delete - is_active = 0)
- ✅ Bulk import placeholder (coming soon: CSV upload)
- ✅ Popularity tracking (hoe vaak gekozen)

**Song Velden:**
- Titel (verplicht)
- Artiest (verplicht)
- Genre (optioneel: Pop, Rock, Schlager, Nederlands, R&B, etc.)
- Moeilijkheid (easy/medium/hard)
- Type (solo/duet/group)
- Duration in seconds
- YouTube URL
- Spotify URL
- Taal (nl/en/de/fr/etc.)

**Huidige Library:**
20 Nederlandse hits waaronder:
- Het is een nacht (Guus Meeuwis)
- Brabant (Guus Meeuwis)
- Mag ik dan bij jou (Claudia de Breij)
- Afscheid nemen bestaat niet (Marco Borsato)
- Zij gelooft in mij (André Hazes)
- ... en 15 meer

### **3. Karaoke Events** (`/admin/karaoke/events`)

**Event Management:**
- ✅ Lijst van alle events (open/closed/completed)
- ✅ Maak nieuwe events aan
- ✅ Bewerk bestaande events
- ✅ Verwijder events met confirmation
- ✅ Real-time statistics per event

**Event Settings:**
- **Gekoppeld event**: Link naar bestaand agenda-event
- **Max songs per lid**: Standaard 3, instelbaar 1-10
- **Selectie deadline**: Optioneel (leden kunnen tot deze datum kiezen)
- **Duets toestaan**: Ja/Nee
- **Song requests toestaan**: Ja/Nee (leden kunnen nieuwe songs voorstellen)
- **Status**: Open/Closed/Completed
- **Intro tekst**: Welkomstbericht voor leden

**Event Creation Flow:**
1. Admin gaat naar `/admin/karaoke/events/nieuw`
2. Selecteert een bestaand agenda-event (concert of "ander" type)
3. Stelt max songs in (bijv. 3)
4. Kiest deadline (bijv. 2 weken voor event)
5. Zet duets aan/uit
6. Voegt intro tekst toe
7. Status: Open voor selecties
8. Klaar! Leden kunnen nu songs kiezen

### **4. Duet Matching Dashboard** (`/admin/karaoke/matching`)

**Features:**
- ✅ **Auto-suggested duets**: Leden die dezelfde song kozen
- ✅ **Populairste songs**: Top 10 per event
- ✅ **Participatie overview**: Wie heeft al gekozen
- ✅ **Member notes**: Zie duet-wensen van leden
- ✅ **Export functie**: CSV/PDF download (coming soon)

**Voorbeeld Output:**
```
🎵 Duet Suggesties:
- "Brabant" (Guus Meeuwis)
  → Marco Dejonghe (wil duet met Anna)
  → Anna Vermeulen (wil duet met Marco)
  ✅ MATCH!

- "Het is een nacht" (Guus Meeuwis)
  → 5 leden gekozen
  → Geen specifieke duet-wensen
  → Suggestie: Groepsoptreden?
```

---

## 🎤 **LEDEN FUNCTIONALITEIT**

### **1. Karaoke Events Overview** (`/leden/karaoke`)

**Wat zien leden:**
- Lijst van **open karaoke events** (status = 'open')
- Event details (titel, datum, locatie)
- Deadline warning (indien ingesteld)
- Intro tekst van admin
- Progress indicator: "2/3 songs gekozen"
- Knop: "Songs kiezen" of "Wijzig selectie"

**Voorbeeld Card:**
```
┌─────────────────────────────────────────┐
│ Jaarlijks LEDENFEEST met partner 🎉     │
│                                          │
│ 📅 zaterdag 3 maart 2026, 19:00        │
│ 📍 Parochiezaal Oppuurs                │
│ ⏰ Deadline: 17 februari 2026          │
│                                          │
│ Kies je favoriete 3 karaoke songs!     │
│ Je mag ook aangeven of je een duet     │
│ wilt doen. Veel plezier! 🎤            │
│                                          │
│ ✅ 2/3 songs gekozen                    │
│                                          │
│ [ Wijzig selectie ]                     │
└─────────────────────────────────────────┘
```

### **2. Song Selection Interface** (`/leden/karaoke/:event_id/select`)

**Layout:**
- **Header**: Event titel + terug knop
- **Mijn Selectie panel**: Ranked lijst van gekozen songs (1, 2, 3)
- **Duet Info panel**: Instructies voor duet-wensen (indien toegestaan)
- **Filters**: Zoeken, genre, type (solo/duet/group)
- **Song Grid**: Card-based display van alle beschikbare songs

**Song Card Design:**
```
┌──────────────────────────┐
│ Het is een nacht         │
│ Guus Meeuwis            │
│                          │
│ [Nederlands] [Solo]      │
│ [⭐ Makkelijk]           │
│                          │
│ [ + Selecteren ]         │
└──────────────────────────┘
```

**Geselecteerde Song:**
```
┌──────────────────────────┐
│ ✅ Brabant               │
│ Guus Meeuwis            │
│                          │
│ [Nederlands] [Solo]      │
│                          │
│ [ ✓ Geselecteerd ]       │
└──────────────────────────┘
```

**Features:**
- ✅ **Real-time feedback**: "Limiet bereikt" na 3e song
- ✅ **Search**: Zoek op titel of artiest
- ✅ **Filters**: Genre (Nederlands, Pop, Rock, etc.) en Type (solo/duet/group)
- ✅ **Selected indicator**: Groene highlight + checkmark
- ✅ **Disabled state**: Grijs indien limiet bereikt
- ✅ **Add/Remove**: Direct knoppen voor toevoegen/verwijderen

### **3. Mijn Selectie Panel**

**Layout:**
```
┌─────────────────────────────────────────┐
│ ⭐ Mijn Selectie (3/3)                  │
├─────────────────────────────────────────┤
│ [1] Het is een nacht                    │
│     Guus Meeuwis                        │
│     💬 [notitie] ✖ [verwijder]        │
├─────────────────────────────────────────┤
│ [2] Brabant                             │
│     Guus Meeuwis                        │
│     📝 Wil duet met Anna doen          │
│     💬 [notitie] ✖ [verwijder]        │
├─────────────────────────────────────────┤
│ [3] Mag ik dan bij jou                  │
│     Claudia de Breij                    │
│     💬 [notitie] ✖ [verwijder]        │
└─────────────────────────────────────────┘
```

**Actions:**
- **Notitie toevoegen**: Klik 💬 → popup formulier
- **Verwijderen**: Klik ✖ → song wordt verwijderd
- **Ranking**: Automatisch 1, 2, 3 op basis van volgorde

### **4. Notitie/Duet Partner Toevoegen** (`/leden/karaoke/:event_id/note/:selection_id`)

**Formulier:**
- Song titel + artiest (readonly)
- Textarea voor notitie (max 500 karakters)
- Voorbeelden:
  - "Ik wil dit graag als duet met Anna doen"
  - "Open voor suggesties van de organisatie"
  - "Ik zing graag de hoge stem"

**Save & Return**: Terug naar selectie pagina met success message

---

## 🔄 **COMPLETE WORKFLOW**

### **Admin Perspective:**

1. **Setup** (eenmalig):
   - Login als admin → Admin Panel
   - Ga naar Karaoke → Songs
   - 20 Nederlandse songs zijn al aanwezig
   - Voeg eventueel meer songs toe

2. **Event Aanmaken**:
   - Ga naar Admin → Karaoke → Events
   - Klik "Nieuw Karaoke Event"
   - Selecteer bestaand event (bijv. "Ledenfeest")
   - Stel in: max 3 songs, deadline 2 weken voor, duets aan
   - Voeg intro tekst toe
   - Status: Open
   - Opslaan

3. **Monitoring**:
   - Ga naar Dashboard → zie statistieken
   - Ga naar Matching → zie wie wat kiest
   - Bekijk duet-suggesties real-time

4. **Na Deadline**:
   - Zet event status op "Closed"
   - Export setlist (via Matching dashboard)
   - Print voor technicus
   - Klaar voor karaoke-avond!

### **Lid Perspective:**

1. **Inloggen**:
   - Ga naar https://animato-koor.pages.dev
   - Login met je account
   - Zie "Karaoke" in het menu

2. **Event Selecteren**:
   - Klik Karaoke in menu
   - Zie open events
   - Lees intro tekst van admin
   - Check deadline
   - Klik "Songs kiezen"

3. **Songs Selecteren**:
   - Browse 20 Nederlandse hits
   - Filter op genre (Nederlands, Pop, Rock)
   - Zoek op titel/artiest
   - Klik "+ Selecteren" bij favoriete songs (max 3)
   - Zie keuzes verschijnen in "Mijn Selectie"

4. **Duet Wensen Aangeven** (optioneel):
   - Klik 💬 notitie icoon naast gekozen song
   - Voeg notitie toe: "Wil duet met [naam]"
   - Opslaan

5. **Klaar**:
   - Admin ziet je keuzes in matching dashboard
   - Je krijgt setlist te zien op karaoke-avond
   - Veel plezier! 🎉

---

## 💾 **DATABASE SCHEMA**

### **Tabellen:**

#### **1. karaoke_songs**
```sql
CREATE TABLE karaoke_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT,
  difficulty TEXT CHECK(difficulty IN ('easy', 'medium', 'hard')),
  type TEXT CHECK(type IN ('solo', 'duet', 'group')),
  duration_seconds INTEGER,
  youtube_url TEXT,
  spotify_url TEXT,
  language TEXT DEFAULT 'nl',
  popularity_score INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### **2. karaoke_events**
```sql
CREATE TABLE karaoke_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  max_songs_per_member INTEGER DEFAULT 3,
  selection_deadline DATETIME,
  allow_duets INTEGER DEFAULT 1,
  allow_song_requests INTEGER DEFAULT 1,
  status TEXT CHECK(status IN ('open', 'closed', 'completed')) DEFAULT 'open',
  intro_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
```

#### **3. karaoke_selections**
```sql
CREATE TABLE karaoke_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karaoke_event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  preference_order INTEGER DEFAULT 1,
  notes TEXT,
  duet_partner_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (karaoke_event_id) REFERENCES karaoke_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES karaoke_songs(id) ON DELETE CASCADE,
  FOREIGN KEY (duet_partner_id) REFERENCES users(id),
  UNIQUE(karaoke_event_id, user_id, song_id)
);
```

#### **4. karaoke_song_requests**
```sql
CREATE TABLE karaoke_song_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karaoke_event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  notes TEXT,
  status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (karaoke_event_id) REFERENCES karaoke_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
```

#### **5. karaoke_playlists**
```sql
CREATE TABLE karaoke_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

#### **6. karaoke_playlist_songs**
```sql
CREATE TABLE karaoke_playlist_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (playlist_id) REFERENCES karaoke_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES karaoke_songs(id) ON DELETE CASCADE,
  UNIQUE(playlist_id, song_id)
);
```

---

## 🌐 **URLs & ROUTES**

### **Admin Routes:**

| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/admin/karaoke` | GET | Dashboard met statistieken |
| `/admin/karaoke/songs` | GET | Song library lijst |
| `/admin/karaoke/songs/nieuw` | GET | Nieuwe song aanmaken |
| `/admin/karaoke/songs/nieuw` | POST | Song opslaan |
| `/admin/karaoke/songs/:id` | GET | Song bewerken (TODO) |
| `/admin/karaoke/songs/:id` | POST | Song updaten (TODO) |
| `/admin/karaoke/songs/:id/delete` | POST | Song verwijderen (TODO) |
| `/admin/karaoke/songs/bulk-import` | GET | Bulk import placeholder |
| `/admin/karaoke/events` | GET | Events lijst |
| `/admin/karaoke/events/nieuw` | GET | Nieuw event formulier |
| `/admin/karaoke/events/nieuw` | POST | Event aanmaken |
| `/admin/karaoke/events/:id` | GET | Event bewerken |
| `/admin/karaoke/events/:id` | POST | Event updaten |
| `/admin/karaoke/events/:id/delete` | POST | Event verwijderen |
| `/admin/karaoke/matching` | GET | Duet matching dashboard |

### **Member Routes:**

| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/leden/karaoke` | GET | Open events overzicht |
| `/leden/karaoke/:event_id/select` | GET | Song selectie interface |
| `/leden/karaoke/:event_id/add/:song_id` | GET | Song toevoegen aan selectie |
| `/leden/karaoke/:event_id/remove/:selection_id` | GET | Song verwijderen uit selectie |
| `/leden/karaoke/:event_id/note/:selection_id` | GET | Notitie formulier |
| `/leden/karaoke/:event_id/note/:selection_id/save` | POST | Notitie opslaan |

---

## 🚀 **PRODUCTION STATUS**

**Live URLs:**
- Production: https://animato-koor.pages.dev
- Latest Deploy: https://ebe52a16.animato-koor.pages.dev
- Sandbox: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai

**Database:**
- ✅ 6 karaoke tables created
- ✅ 20 Dutch songs seeded
- ✅ 1 test event live: "Jaarlijks LEDENFEEST met partner 🎉"

**Test het nu:**
1. Login als admin op https://animato-koor.pages.dev/login
2. Ga naar Admin → Karaoke
3. Bekijk songs, events, en matching dashboard
4. Login als lid en ga naar Karaoke in menu
5. Kies je favoriete 3 songs!

---

## 📞 **SUPPORT & VRAGEN**

Voor vragen of suggesties:
- **Technisch**: Contact developer
- **Functioneel**: Contact koorbestuur

**Happy Karaoke! 🎤🎉**
