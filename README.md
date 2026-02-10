# 🎵 Gemengd Koor Animato - Website

Moderne, veilige en beheersbare koorwebsite met publieke site, ledenportaal en admin console.

## 🌐 Live URLs

- **Production**: https://animato-koor.pages.dev
- **Latest Deploy**: https://8cef00a2.animato-koor.pages.dev (Deployed: 2025-11-23 14:40 UTC)
- **Development (Sandbox)**: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai
- **API Documentation**: /api endpoint
- **Current Version**: v1.0.28 (Karaoke Module Tested & Verified)
- **Last Updated**: 2026-02-10 23:00 UTC

## ✨ Features

### ✅ Voltooid (Sprint 1 - Foundation)

#### Publieke Site
- ✅ **Homepage** met hero, over ons, nieuws preview, concerten preview
- ✅ **Full-width YouTube video** als hero achtergrond (autoplay, muted, looped)
- ✅ **Over Ons** pagina met koorgeschiedenis en missie
- ✅ **Contact** pagina met formulier, contactgegevens en Google Maps integratie
- ✅ **Responsive design** (desktop, tablet, mobiel)
- ✅ **Animato branding** (#00A9CE primary, #1B4D5C secondary, #F59E0B accent)

#### Database & Backend
- ✅ **D1 Database** volledig schema (41 tabellen + indexes)
  - Users & Profiles (role-based: admin, moderator, stemleider, lid, bezoeker)
  - Posts (nieuws + messageboard met stemgroep categorieën)
  - Events & Concerts (agenda + ticketing)
  - Works, Pieces & Materials (SATB partituren + oefentracks)
  - Albums & Photos (fotogalerij publiek/intern)
  - Form submissions, Notifications, Audit logs, Settings
- ✅ **Auth systeem** (JWT, password hashing met Web Crypto API)
- ✅ **Role-based middleware** (requireAuth, requireRole, requireStemgroep, requireAdmin)
- ✅ **Database utilities** (query helpers, pagination, slug generation)

#### Test Data
- ✅ **9 test users**: 1 admin + 8 leden (2 per stemgroep: S/A/T/B)
- ✅ **3 nieuws posts** (publiek zichtbaar)
- ✅ **1 concert** (Lenteconcert 2025)
- ✅ **3 repetities** (alle stemmen, SA, TB)
- ✅ **2 muziekwerken** (Fauré Requiem + Mozart Ave Verum)
- ✅ **9 materialen** (partituren + oefentracks per stem)
- ✅ **2 albums** met foto's

### 🚧 In Progress (Sprint 2)

- 🔄 **Login/Register** routes
- 🔄 **Nieuws detailpagina's** + overzicht met filters
- 🔄 **Agenda** met kalenderweergave + ICS export
- 🔄 **Concerten** detailpagina's met ticketflow

### 📋 Planned (Sprint 3 & 4)

#### Ledenportaal
- ⏳ **Dashboard** (volgende repetitie, nieuwe materialen, pinned berichten)
- ⏳ **Materiaal per stem** (SATB partituren + oefentracks download)
- ⏳ **Messageboard** (threads, replies, mentions, zoekfunctie)
- ⏳ **Repetitie-kalender** met aanwezigheidsregistratie
- ⏳ **Profiel** bewerken
- ✅ **Polls & Voting** (dirigent polls met multiple choice voting)
  - Filter tabs: open, gesloten, all polls
  - Vote once or multiple options (based on max_stemmen)
  - Conditional results display (always, after_vote, after_close)
  - Doelgroep filtering (all, S/A/T/B, SATB, bestuur)
- ✅ **Member Proposals** (submit eigen voorstellen, upvote/downvote)
  - Submit voorstel met titel, categorie, beschrijving
  - Vote toggle: up/down/remove vote
  - Filter tabs: open, goedgekeurd, afgekeurd, all
  - Net vote score display

#### Admin Console
- ✅ **Admin Dashboard** met 8 statistieken cards (leden, posts, events, albums, materialen, locaties, polls, proposals)
- ✅ **Ledenbeheer** (volledige CRUD, rol toewijzen, stemgroep, status)
  - Error messages bij member creation (required fields, email exists, password mismatch)
  - Stemgroep dropdown gebruikt correcte waarden (S/A/T/B ipv full names)
- ✅ **Contentbeheer** (nieuws, posts, filters, publicatie status)
- ✅ **Eventbeheer** (repetities, concerten, terugkerende events, doelgroep filtering)
  - **Image upload met base64 encoding** - Upload afbeeldingen direct (JPG, PNG, max 2MB)
  - Toggle tussen URL input en file upload met elegant UI
  - Automatische conversie naar base64 data URLs
  - Preview functionaliteit voor beide modes
- ✅ **Locatiebeheer** (standalone management met Google Maps visual integration)
  - CRUD interface voor locaties (apart van events)
  - Google Maps embed in location cards (ipv rode gradient placeholder)
  - Smart URL parsing voor verschillende Google Maps formaten
  - Capaciteit, notities, actief/inactief status
- ✅ **Materiaal upload** (SATB bestanden + toegangscontrole)
- ✅ **Fotoboek** beheer (albums, foto's, publiek/intern)
  - **Foto upload** - Upload foto's direct (JPG, PNG, max 5MB) via file picker
  - Toggle tussen URL input en file upload voor zowel cover als individuele foto's
  - Automatische base64 encoding voor opslag in D1 database
  - Live preview met clear functionaliteit
- ✅ **Ticketing** dashboard (concerten, prijsstructuur, orders)
- ✅ **Production login fix** (PBKDF2 password hashing compatibility met Cloudflare Workers)
- ✅ **No-cache headers** (admin pagina's tonen altijd verse data)
- ✅ **Polls Management** (CRUD voor polls, status management, 5 opties per poll)
- ✅ **Proposals Review** (approve/reject voorstellen met review opmerking)
- ✅ **Karaoke Module** (TESTED & VERIFIED - 2026-02-10)
  - **Admin: Song Library Management** - CRUD voor karaoke songs (20 Nederlandse nummers seeded)
  - **Admin: Karaoke Events** - Event creation met max songs, deadline, duets, song requests
  - **Admin: Duet Matching Dashboard** - Auto-suggest duets, popularity stats, participation overview
  - **Members: Song Selection** - Browse songs, select top 3, filters (genre/type), notes for duets
  - **All Routes Tested**: 8/8 routes verified (/admin/karaoke, /admin/karaoke/songs, /admin/karaoke/songs/nieuw, /admin/karaoke/songs/bulk-import, /admin/karaoke/events, /admin/karaoke/events/nieuw, /admin/karaoke/matching, /leden/karaoke)
  - **Build Status**: 94 modules, 990.82 kB bundle, PM2 running without errors
  - **Database**: 6 tables (karaoke_songs, karaoke_events, karaoke_selections, karaoke_requests, karaoke_playlists, karaoke_playlist_songs)
- ✅ **User Activity Tracking** (login/logout monitoring, session duration, real-time online status)
  - Track alle login/logout sessies met timestamps
  - IP adres en user agent logging
  - Bereken sessieduur automatisch
  - Real-time "wie is online" dashboard
  - Filter op status (active/today/all) en per gebruiker
  - Statistieken: active users, today logins, avg duration
- ✅ **Concert Projects Management** (Projectmatig werken voor concerten)
  - Dashboard met status (in uitvoering, planning, afgerond), taken voortgang en budget balans
  - Taakbeheer per project (todo/doing/done, prioriteit, toewijzen aan leden)
  - Budgetbeheer (verwachte vs werkelijke inkomsten/uitgaven)
  - Integratie met Agenda (project gekoppeld aan concert event)
- ✅ **Meeting Management** (Vergaderingen, Notulen, Actiepunten)
  - Agenda beheer met tijdsduur en sprekers
  - Notulen editor met goedkeuringsflow (concept/definitief)
  - Actiepunten tracking (toewijzen, deadlines, status)
  - Aanwezigheidsregistratie (genodigd, aanwezig, afwezig, verontschuldigd)
  - Historiek en templates (bestuur, algemeen, werkgroep)
- ⏳ **Theming** (logo, kleuren, lettertypes)
- ⏳ **Moderatie** (board berichten, media goedkeuren)

#### Ticketing & Payments
- ⏳ **Stripe integratie** (checkout flow)
- ⏳ **E-ticket generatie** (PDF + QR code)
- ⏳ **Bevestigingsmails** (via Resend)

## 🛠️ Tech Stack

- **Framework**: [Hono](https://hono.dev/) (lightweight, fast, Cloudflare Workers optimized)
- **Hosting**: [Cloudflare Pages](https://pages.cloudflare.com/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite-based, globally distributed)
- **Frontend**: TailwindCSS, Font Awesome, Google Fonts (Playfair Display + Inter)
- **Auth**: JWT (Web Crypto API), role-based access control
- **Email**: [Resend](https://resend.com/) (geplanned)
- **Payments**: [Stripe](https://stripe.com/) (geplanned)

## 🚀 Development Setup

### Prerequisites

- Node.js 18+ en npm
- Cloudflare account (voor D1 database)
- PM2 (pre-installed in sandbox)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd webapp

# Install dependencies
npm install

# Setup environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys

# Apply database migrations
npm run db:migrate:local

# Seed database with test data
npm run db:seed

# Build project
npm run build

# Start development server
pm2 start ecosystem.config.cjs

# Check status
pm2 status
pm2 logs animato-koor --nostream
```

### Database Management

```bash
# Reset database (DROP all data + re-seed)
npm run db:reset

# Query database (local)
npm run db:console:local
# Then execute SQL:
# SELECT * FROM users;

# Query database (production)
npm run db:console:prod
```

### Development Commands

```bash
# Build for production
npm run build

# Deploy to Cloudflare Pages
npm run deploy

# Clean port 3000
npm run clean-port

# Test local server
npm run test
```

## 📊 Data Architecture

### Main Entities

- **Users** → Profiles (voornaam, achternaam, stemgroep, rol)
- **Posts** → Nieuws + Messageboard (categorie per stem)
- **Events** → Repetities + Concerten (doelgroep: SATB)
- **Concerts** → Ticketing (prijsstructuur, capaciteit)
- **Works** → Pieces → Materials (SATB partituren + audio)
- **Albums** → Photos (publiek/intern)

### Roles & Permissions

| Rol | Toegang |
|-----|---------|
| **Admin** | Volledige toegang (ledenbeheer, content, settings) |
| **Moderator** | Board moderatie, media goedkeuren |
| **Stemleider** | Materiaal posten voor eigen stem, berichten pinnen |
| **Lid** | Ledenportaal, eigen profiel, materiaal per stem |
| **Bezoeker** | Alleen publieke site |

### Stemgroepen (SATB)

- **S** = Sopraan
- **A** = Alt
- **T** = Tenor
- **B** = Bas

Materialen en repetities kunnen toegewezen worden aan specifieke stemgroepen of combinaties (SA, TB, SAT, SATB, etc.)

## 🔐 Authentication

### Login Credentials (Development & Production)

**Admin Account:**
- **Email**: `admin@animato.be`
- **Password**: `admin123`
- **Role**: Administrator (volledige toegang)

**Test Member Accounts** (all password: admin123):
- **Sopraan**: emma.janssen@example.com, sophie.dubois@example.com
- **Alt**: lisa.peeters@example.com (stemleider), marie.vermeulen@example.com
- **Tenor**: thomas.maes@example.com, lucas.claes@example.com (proeflid)
- **Bas**: jan.desmet@example.com (moderator), pieter.willems@example.com

**Login URLs:**
- **Production**: https://animato-koor.pages.dev/login
- **Development**: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai/login

**⚠️ BELANGRIJK**: 
- Database is volledig geseeded met test data
- Alle users gebruiken PBKDF2 password hashing (Web Crypto API)
- Wijzig admin wachtwoord in productie!
- Test accounts kunnen gebruikt worden om verschillende rollen te testen

## 🚀 Deployment Info

### Cloudflare Pages
- **Project Name**: animato-koor
- **Production URL**: https://animato-koor.pages.dev
- **Latest Deployment**: https://8cef00a2.animato-koor.pages.dev (2025-11-23 14:40 UTC)
- **Production Branch**: main
- **Status**: ✅ LIVE - All systems operational
- **Cache Control**: ✅ No-cache headers on all admin routes
- **Image Storage**: ✅ Base64 encoding (no R2 required)
- **Event Save**: ✅ All fields including doelgroep and dates now save correctly
- **Photo Upload**: ✅ File upload support in fotoboek admin (base64, max 5MB)
- **Auth UX**: ✅ Login form icons moved to labels (not inside inputs)
- **Mobile UX**: ✅ Uitloggen moved to hamburger menu (prevents accidental logout) (v1.0.20)

### Database (Cloudflare D1)
- **Database Name**: animato-production
- **Database ID**: 758eef10-f55b-428f-81ca-4d7f87862811
- **Region**: ENAM (Eastern North America)
- **Migrations**: ✅ All applied (11 migrations)
  - 0001-0009: Core schema (users, posts, events, concerts, albums, etc.)
  - 0010: Polls & Voting system (polls, poll_options, poll_votes, member_proposals, proposal_votes)
  - 0011: User Sessions Tracking (user_sessions table for login/logout activity monitoring)
- **Admin User**: ✅ Created (admin@animato.be)

### Environment Variables
- **JWT_SECRET**: ✅ Configured (production secret)

### Deployment Commands
```bash
# Build for production
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name animato-koor

# Apply database migrations
npx wrangler d1 migrations apply animato-production --remote

# Seed production database (first deployment only)
npx wrangler d1 execute animato-production --remote --file=./seed-prod-step1-users.sql
npx wrangler d1 execute animato-production --remote --file=./seed-prod-step2-posts.sql
npx wrangler d1 execute animato-production --remote --file=./seed-prod-step3-concerts.sql
```

### Production Data (✅ FULLY SEEDED)
- **Settings**: ✅ 13 site settings (naam, kleuren, contact info, features)
- **Users**: ✅ 9 users (1 admin + 8 test members across all voice sections)
  - Admin: admin@animato.be / admin123
  - 2 Sopraan: Emma Janssen, Sophie Dubois
  - 2 Alt: Lisa Peeters (stemleider), Marie Vermeulen
  - 2 Tenor: Thomas Maes, Lucas Claes (proeflid)
  - 2 Bas: Jan Desmet (moderator), Pieter Willems
- **News Posts**: ✅ 3 nieuws artikelen (welkom, lenteconcert, eerste repetitie)
- **Events**: ✅ 13 events total
  - 3 Concerten: Kerstconcert 2024, Voorjaarsconcert 2025, Zomerconcert 2025
  - 1 Recurring parent event (weekly rehearsals)
  - 9 Repetities: Nov-Dec 2024 + Jan 2025
- **Concerts**: ✅ 3 concert details met programma's, prijsstructuur, capaciteit

## 🎨 Design System

### Colors

- **Primary**: `#00A9CE` (Animato cyan/turquoise)
- **Secondary**: `#1B4D5C` (Donkere teal)
- **Accent**: `#F59E0B` (Amber/goud voor CTA's)

### Typography

- **Display Font**: Playfair Display (serif, elegant)
- **Body Font**: Inter (sans-serif, clean)

### Key UI Components

- **Hero**: Full-width gradient met decorative wave
- **Cards**: Shadow + hover effects
- **Buttons**: Primary (cyan), Accent (amber), Secondary (teal)
- **Forms**: Focus states met Animato primary color

## 📁 Project Structure

```
webapp/
├── src/
│   ├── index.tsx              # Main Hono app
│   ├── components/
│   │   └── Layout.tsx         # Base HTML layout
│   ├── routes/
│   │   └── public.tsx         # Public routes (home, koor, contact)
│   ├── middleware/
│   │   └── auth.ts            # Auth middleware (requireAuth, requireRole, etc.)
│   ├── utils/
│   │   ├── auth.ts            # Password hashing, JWT, permissions
│   │   └── db.ts              # Database utilities
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── public/
│   └── static/
│       ├── css/styles.css     # Custom CSS
│       ├── js/app.js          # Frontend JavaScript
│       └── images/            # Images, logos, photos
├── migrations/
│   └── 0001_initial_schema.sql
├── seed.sql                   # Test data
├── ecosystem.config.cjs       # PM2 configuration
├── wrangler.jsonc             # Cloudflare configuration
└── package.json
```

## 🌍 Deployment

### Cloudflare Pages Deployment

```bash
# 1. Setup Cloudflare API key
# Via Deploy tab in GenSpark interface

# 2. Create production D1 database
npx wrangler d1 create animato-production
# Copy database_id to wrangler.jsonc

# 3. Apply migrations to production
npm run db:migrate:prod

# 4. Build and deploy
npm run deploy:prod
```

### Environment Variables (Production)

Add via Cloudflare Dashboard → Pages → Settings → Environment Variables:

- `JWT_SECRET` = (strong random string)
- `SESSION_SECRET` = (strong random string)
- `RESEND_API_KEY` = (from resend.com)
- `STRIPE_SECRET_KEY` = (from stripe.com)
- `STRIPE_PUBLISHABLE_KEY` = (from stripe.com)
- `SITE_URL` = https://animato-koor.pages.dev
- `ADMIN_EMAIL` = info@animato.be

## 📈 Next Steps

### Sprint 2 (Week 3-4)
1. **Auth routes** (login, register, logout, password reset)
2. **Nieuws CRUD** (overzicht, detail, search, tags)
3. **Agenda module** (kalender, filters, ICS export)
4. **Concert detail** + ticketflow skeleton

### Sprint 3 (Week 5-6)
1. **Ledenportaal** dashboard
2. **SATB materiaal** download module
3. **Messageboard** (threads, replies, mentions)
4. **Aanwezigheidsregistratie**

### Sprint 4 (Week 7-8)
1. **Stripe integratie**
2. **Email workflows** (Resend)
3. **Admin console** (users, content, settings)
4. **Testing & deployment**

## 🔒 Security

- ✅ Password hashing (PBKDF2, 100k iterations)
- ✅ JWT tokens (HMAC-SHA256)
- ✅ Role-based access control
- ✅ SQL injection prevention (D1 prepared statements)
- ✅ CORS configured for API routes
- ⏳ 2FA support (geplanned)
- ⏳ Rate limiting (geplanned)

## 📝 License

© 2025 Gemengd Koor Animato. Alle rechten voorbehouden.

## 👤 Contact

- **Email**: info@animato.be
- **Telefoon**: +32 470 12 34 56
- **Adres**: Koorstraat 1, 1000 Brussel

---

**Built with ❤️ by GenSpark AI** | **Designed for Gemengd Koor Animato**
