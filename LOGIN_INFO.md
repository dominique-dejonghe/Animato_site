# 🔐 Test Login Credentials

## Gemengd Koor Animato - Development Environment

Alle test accounts gebruiken **hetzelfde wachtwoord**: `admin123`

---

## 👨‍💼 Administrator Account

| Field | Value |
|-------|-------|
| **Email** | `admin@animato.be` |
| **Password** | `admin123` |
| **Role** | Admin |
| **Stemgroep** | - |
| **Toegang** | Volledige admin rechten + ledenportaal |

---

## 👥 Test Leden Accounts

### Sopranen (S)

| Email | Naam | Rol | Status |
|-------|------|-----|--------|
| `emma.janssen@example.com` | Emma Janssen | Lid | Actief |
| `sophie.dubois@example.com` | Sophie Dubois | Lid | Actief |

### Alten (A)

| Email | Naam | Rol | Status |
|-------|------|-----|--------|
| `lisa.peeters@example.com` | Lisa Peeters | **Stemleider** | Actief |
| `marie.vermeulen@example.com` | Marie Vermeulen | Lid | Actief |

### Tenoren (T)

| Email | Naam | Rol | Status |
|-------|------|-----|--------|
| `thomas.maes@example.com` | Thomas Maes | Lid | Actief |
| `lucas.claes@example.com` | Lucas Claes | Lid | **Proeflid** |

### Bassen (B)

| Email | Naam | Rol | Status |
|-------|------|-----|--------|
| `jan.desmet@example.com` | Jan Desmet | **Moderator** | Actief |
| `pieter.willems@example.com` | Pieter Willems | Lid | Actief |

---

## 🎭 Rol Overzicht

| Rol | Rechten | Toegang |
|-----|---------|---------|
| **Admin** | Volledige controle | Alle admin functies + ledenportaal |
| **Moderator** | Berichten modereren | Messageboard beheer + ledenportaal |
| **Stemleider** | Stem-specifiek materiaal uploaden | Ledenportaal + stem materiaal |
| **Lid** | Basis toegang | Ledenportaal (materiaal, board, smoelenboek, agenda) |
| **Proeflid** | Beperkte toegang | Ledenportaal (alleen lezen) |
| **Bezoeker** | Geen toegang | Alleen publieke pagina's |

---

## 🌟 Nieuwe Features

### "Onze Zangers" (Smoelenboek)
- **Zichtbaar voor**: Alle ingelogde leden
- **Menu locatie**: Ledenportaal dashboard (roze icoon met `fa-users`)
- **Functies**:
  - Facebook-style member cards met profielfoto's
  - Muzikale voorkeuren (genre, componist, favoriet werk)
  - Bio en muzikale ervaring
  - Privacy controls (email, telefoon, zichtbaarheid)
  - Filter op stemgroep en rol

### Auto-aanmaak Profielen
- Als een gebruiker geen profiel heeft, wordt automatisch een leeg profiel aangemaakt
- Gebruikt `voornaam` en `achternaam` uit JWT of defaults naar "Nieuwe Gebruiker"
- Fix voor "redirect=profile_not_found" error

### Admin Fotoboek Beheer
- **Toegang**: `/admin/fotoboek` (alleen admins)
- **Functies**:
  - Albums aanmaken, bewerken, verwijderen
  - Foto's uploaden, sorteren, verwijderen
  - Zichtbaarheid controls (publiek/privé)
  - Metadata: datum, fotograaf, beschrijving

---

## 🚀 Quick Start

1. **Start de applicatie**:
   ```bash
   cd /home/user/webapp
   pm2 start ecosystem.config.cjs
   ```

2. **Open in browser**:
   - Development: `http://localhost:3000`
   - Login pagina: `http://localhost:3000/login`

3. **Test login** met een van de bovenstaande credentials

4. **Bekijk features**:
   - Dashboard: Quick actions menu met "Onze Zangers"
   - Profiel: Bewerk je profiel met muzikale voorkeuren
   - Smoelenboek: Zie alle koorleden
   - Admin: `/admin` (alleen met admin account)

---

## 🔧 Technical Details

- **Password Hashing**: PBKDF2 (Web Crypto API compatible)
- **JWT Tokens**: HMAC-SHA256 signing
- **Cookie Settings**: HttpOnly, Secure, SameSite=Lax
- **Database**: Cloudflare D1 (SQLite) met `--local` mode voor development
- **Session Duration**: 7 dagen (604800 seconden)

---

## 📝 Notes

⚠️ **BELANGRIJK**: De test data bevat PBKDF2 password hashes voor wachtwoord `admin123`. 
Verander deze bij productie deployment!

✅ **FIXED**: Login werkt nu met de correcte PBKDF2 password verification (was eerst bcrypt).
