# Animato Koor Website - Project Status
**Laatste Update:** 2025-11-15

## 🎯 Project Overzicht
Cloudflare Pages website voor Gemengd Koor Animato met Hono backend en D1 database.

## ✅ Recent Voltooid (Deze Sessie)

### 1. Agenda Pagina - Complete Redesign
- **View Switcher**: Toggle tussen Lijstweergave en Maandweergave
- **Verbeterde Lijst View**: 
  - Maand-gegroepeerde events in witte cards
  - Nieuwe "Agenda" button met moderne modal
  - Admin edit/delete icons (blauw/rood)
- **Maandweergave (Calendar Grid)**:
  - 7-kolommen kalender (Ma-Zo)
  - Maand navigatie met pijltjes
  - Event badges met tijd en titel
  - Kleur-gecodeerd (blauw=repetitie, geel=concert)
  - Vandaag highlighted met blauwe border
  - Klikbare events openen modal
- **Calendar Modal**:
  - Event details (titel, datum, tijd, locatie)
  - 4 export opties: Google Calendar, Outlook, Office 365, ICS download
  - Admin buttons (bewerken/verwijderen) voor ingelogde users
  - Close functionaliteit (X, ESC, backdrop click)

### 2. Admin Functionaliteit in Agenda
- **Lijst View**: Edit/Delete icon buttons naast elk event
- **Maandweergave**: Edit/Delete buttons in modal
- **Delete met AJAX**: Confirmation dialog + auto-reload na verwijdering
- **Conditional rendering**: Alleen zichtbaar voor admins

### 3. Eerdere Fixes
- ✅ Agenda white bars verwijderd (cards toegevoegd)
- ✅ Admin login werkend (admin@iutum.be / admin123)
- ✅ Google Maps velden verwijderd uit locatie form
- ✅ Repetities visibility fix (is_publiek + zichtbaar_publiek)

## 🗂️ Belangrijke Files

### `/home/user/webapp/src/routes/agenda.tsx`
- Hoofd agenda route met beide views
- Calendar modal met admin controls
- JavaScript voor modal + delete functionaliteit

### `/home/user/webapp/src/routes/admin-events.tsx`
- Event creation/edit forms
- Recurrence logic voor repetities
- Fixed to set both is_publiek AND zichtbaar_publiek

### `/home/user/webapp/src/routes/admin-locations.tsx`
- Location management (gecleaned: geen Google Maps velden)

### `/home/user/webapp/src/utils/auth.ts`
- Custom PBKDF2 password hashing (100k iterations, SHA-256)
- Format: `saltHex:hashHex`

## 🔑 Admin Credentials
- Email: `admin@iutum.be`
- Password: `admin123`
- Role: `admin`

## 🗄️ Database
- **Type**: Cloudflare D1 (SQLite)
- **Name**: `animato-production`
- **Local Dev**: `--local` flag (auto-creates in `.wrangler/state/v3/d1`)
- **Migrations**: In `migrations/` directory

### Key Tables
- `users` - Admin/lid accounts
- `events` - Repetities, concerten, andere events
  - Important: Both `is_publiek` AND `zichtbaar_publiek` must be 1 for public visibility
- `locations` - Locaties zonder Google Maps fields
- `concerts` - Extra concert details

## 🚀 Development Commands

```bash
# Build
cd /home/user/webapp && npm run build

# Start (PM2)
cd /home/user/webapp && pm2 restart animato-koor

# Database
npx wrangler d1 execute animato-production --local --command="SELECT * FROM events LIMIT 10"
npx wrangler d1 migrations apply animato-production --local

# Port cleanup
fuser -k 3000/tcp 2>/dev/null || true
```

## 🌐 Service URLs
- **Local**: http://localhost:3000
- **Sandbox**: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai

## 📋 Volgende Stappen (Mogelijke Toekomstige Features)
- [ ] Event filters in maandweergave
- [ ] Week view toevoegen
- [ ] Bulk event operations voor admin
- [ ] Event duplication
- [ ] Export naar Excel/CSV

## 🎨 Tech Stack
- **Framework**: Hono (Cloudflare Workers)
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Server-side JSX + Tailwind CSS (CDN)
- **Deployment**: Cloudflare Pages
- **Process Manager**: PM2 (development)
- **Build Tool**: Vite

## 📝 Belangrijke Notes
- Always use `--local` flag for D1 in development
- Build before first PM2 start
- Set 300s+ timeout for npm commands
- Both `is_publiek` and `zichtbaar_publiek` must be 1 for events to show publicly
