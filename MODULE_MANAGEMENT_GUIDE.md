# 🎛️ Module Management Systeem

## Overzicht

Het Module Management Systeem stelt admins in staat om features eenvoudig aan/uit te zetten zonder code aan te passen. Dit zorgt voor flexibiliteit bij het beheren van je koorwebsite.

---

## 📍 Toegang

**Admin Console → Module Beheer**
- URL: `/admin/modules`
- Vereist: Admin rechten
- Live: https://animato-koor.pages.dev/admin/modules

---

## 🎯 Functionaliteit

### Toggle Switches
- **Aan/Uit schakelen** met één klik
- **Real-time feedback** via success messages
- **Direct actief** na opslaan (geen rebuild vereist)

### Module Categorieën

#### 📰 Content Modules
1. **Nieuws & Berichten** (`nieuws`)
   - Nieuwsartikelen publiceren
   - Messageboard voor leden
   - Filters per stemgroep

2. **Agenda & Events** (`agenda`)
   - Repetities & concerten
   - ICS export
   - Kalenderweergave

3. **Concerten & Ticketing** (`concerten`)
   - Concert publicatie
   - Kaartverkoop via Stripe
   - E-tickets met QR codes

4. **Fotoboek** (`fotoboek`)
   - Albums beheren
   - Foto upload (max 5MB)
   - Publiek/intern albums

#### 👥 Leden Modules
1. **Materiaal** (`materiaal`)
   - SATB partituren
   - Oefentracks per stem
   - Download controle

2. **Polls & Voting** (`polls`)
   - Dirigent polls
   - Multiple choice stemming
   - Resultaat weergave opties

3. **Voorstellen** (`voorstellen`)
   - Leden kunnen voorstellen indienen
   - Upvote/downvote systeem
   - Admin review workflow

4. **Activiteiten & Feest** (`activiteiten`)
   - Sociale activiteiten
   - Aanmeldingen bijhouden
   - Foto upload per activiteit

5. **Karaoke** 🎤 (`karaoke`)
   - Song library (20+ Nederlandse hits)
   - Event management
   - Member song selection (max 3)
   - Duet matching dashboard

#### ⚙️ Admin Modules
1. **Projectbeheer** (`projecten`)
   - Concert projecten
   - Task management
   - Budget tracking

2. **Vergaderingen** (`vergaderingen`)
   - Agenda's opstellen
   - Notulen met goedkeuringsflow
   - Actiepunten bijhouden

3. **Lidgelden** (`finance`)
   - Betalingsinstructies
   - Statussen per lid
   - Rapporten

4. **Printservice** (`printservice`)
   - Partituur print requests
   - Status tracking
   - PDF generatie

5. **Stem Analyzer** (`voice_analyzer`)
   - Audio upload voor stemgroep analyse
   - ML-based classificatie (SATB)
   - Confidence scores
   - ⚠️ **Standaard uitgeschakeld** (experimental feature)

---

## 💡 Hoe te Gebruiken

### Module Uitschakelen
1. Log in als admin
2. Ga naar **Admin Console → Module Beheer**
3. Scroll naar de module die je wilt uitschakelen
4. Klik op de **toggle switch** (van groen naar grijs)
5. Module is direct uitgeschakeld

### Effect van Uitschakelen
- ❌ Menu items verdwijnen uit navigatie
- ❌ Routes zijn niet meer toegankelijk (404)
- ✅ **Data blijft bewaard** in database
- ✅ Veilig om later weer in te schakelen

### Module Inschakelen
1. Toggle switch naar **Actief** (groen)
2. Module is direct beschikbaar
3. Alle bestaande data is direct toegankelijk

---

## 🔒 Veiligheid

### Data Behoud
- **Uitschakelen verwijdert GEEN data**
- Alle database records blijven intact
- Veilig om modules tijdelijk uit te zetten
- Data is direct beschikbaar bij herinschakelen

### Toegangscontrole
- Alleen **admins** kunnen modules beheren
- Changes worden gelogd met timestamp
- Updated_by bijgehouden per wijziging

---

## ⚠️ Aanbevelingen

### Core Modules (Voorzichtig)
Wees voorzichtig met het uitschakelen van:
- **Agenda** - Kan gebruikerservaring beïnvloeden
- **Nieuws** - Primaire contentbron
- **Materiaal** - Belangrijk voor leden tijdens repetities

### Test Modules (Veilig)
Veilig om te experimenteren met:
- **Karaoke** - Optionele feature voor feesten
- **Voice Analyzer** - Experimental tool
- **Printservice** - Wordt niet door iedereen gebruikt

### Best Practices
1. **Test eerst** in sandbox omgeving
2. **Communiceer** met leden als je core modules uitschakelt
3. **Monitor** gebruik via audit logs
4. **Plan** wijzigingen buiten repetitietijden

---

## 🛠️ Technische Details

### Database Schema
```sql
CREATE TABLE module_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT UNIQUE NOT NULL,
  module_name TEXT NOT NULL,
  module_description TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  updated_by INTEGER,
  updated_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
```

### Categorieën
- `content` - Publieke content modules
- `members` - Ledenportaal features
- `admin` - Admin console tools

### Status Values
- `is_enabled = 1` - Module actief
- `is_enabled = 0` - Module uitgeschakeld

---

## 📊 Module Overzicht

| Categorie | Module | Standaard | Beschrijving |
|-----------|--------|-----------|--------------|
| **Content** | Nieuws | ✅ Actief | Nieuwsartikelen & messageboard |
| | Agenda | ✅ Actief | Events & kalender |
| | Concerten | ✅ Actief | Ticketing & concertinfo |
| | Fotoboek | ✅ Actief | Fotogalerij beheer |
| **Members** | Materiaal | ✅ Actief | SATB partituren & tracks |
| | Polls | ✅ Actief | Stemrondes & enquêtes |
| | Voorstellen | ✅ Actief | Member proposals |
| | Activiteiten | ✅ Actief | Sociale events |
| | Karaoke | ✅ Actief | Song selection & matching |
| **Admin** | Projecten | ✅ Actief | Concert projectbeheer |
| | Vergaderingen | ✅ Actief | Meeting management |
| | Lidgelden | ✅ Actief | Finance tracking |
| | Printservice | ✅ Actief | Partituur printing |
| | Voice Analyzer | ❌ Inactief | Experimental ML tool |

---

## 🚀 Roadmap

### Geplande Features
- [ ] **Module dependencies** - Auto-disable afhankelijke modules
- [ ] **Bulk toggle** - Alle modules in categorie aan/uit
- [ ] **Scheduled toggles** - Modules automatisch activeren op datum
- [ ] **Usage analytics** - Welke modules worden het meest gebruikt
- [ ] **Permission levels** - Sommige modules alleen voor stemleiders

### Future Modules
- [ ] **Workshop Planning** - Externe workshops & masterclasses
- [ ] **Member Blog** - Leden kunnen eigen artikelen schrijven
- [ ] **Sheet Music Library** - Volledige partituurbibliotheek
- [ ] **Practice Room Booking** - Reserveringssysteem
- [ ] **Merchandise Shop** - T-shirts, CD's verkopen

---

## 📞 Support

Bij vragen of problemen:
1. Check deze guide eerst
2. Test in sandbox environment
3. Contacteer admin support

---

**Status**: ✅ Live op productie sinds 2026-02-11
**URL**: https://animato-koor.pages.dev/admin/modules
**Versie**: v1.0.31
