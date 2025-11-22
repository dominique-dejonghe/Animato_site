# 🎵 Gemengd Koor Animato - Website

Moderne, veilige en beheersbare koorwebsite met publieke site, ledenportaal en admin console.

## 🌐 Live URLs

- **Production**: https://animato-koor.pages.dev (Latest: https://f5383d85.animato-koor.pages.dev)
- **Development (Sandbox)**: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai
- **API Documentation**: /api endpoint

## ✨ Features

### ✅ Voltooid (Sprint 1 - Foundation)

#### Publieke Site
- ✅ **Homepage** met hero, over ons, nieuws preview, concerten preview
- ✅ **Full-width YouTube video** als hero achtergrond (autoplay, muted, looped)
- ✅ **Over Ons** pagina met koorgeschiedenis en missie
- ✅ **Contact** pagina met formulier en contactgegevens
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

#### Admin Console
- ⏳ **Ledenbeheer** (CRUD, rol toewijzen, export CSV)
- ⏳ **Contentbeheer** (nieuws, agenda, concerten)
- ⏳ **Materiaal upload** (SATB bestanden + toegangscontrole)
- ⏳ **Theming** (logo, kleuren, lettertypes)
- ⏳ **Ticketing** dashboard
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

### Login Credentials (Development)

**Admin Account:**
- **Email**: `admin@animato.be`
- **Password**: `admin123`
- **Role**: Administrator (volledige toegang)

**Login URLs:**
- **Production**: https://animato-koor.pages.dev/login
- **Development**: https://3000-if8m2q02i4w90snul94e6-5185f4aa.sandbox.novita.ai/login

**⚠️ BELANGRIJK**: 
- Database is gereset (oude test users zijn verwijderd)
- Alleen admin@animato.be werkt momenteel
- Wijzig admin wachtwoord in productie!
- Voeg nieuwe test users toe via admin panel indien nodig

## 🚀 Deployment Info

### Cloudflare Pages
- **Project Name**: animato-koor
- **Production URL**: https://animato-koor.pages.dev
- **Latest Deployment**: https://f5383d85.animato-koor.pages.dev
- **Production Branch**: main

### Database (Cloudflare D1)
- **Database Name**: animato-production
- **Database ID**: 758eef10-f55b-428f-81ca-4d7f87862811
- **Region**: ENAM (Eastern North America)
- **Migrations**: ✅ All applied (10 migrations)
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
npx wrangler d1 execute animato-production --remote --file=./seed-production.sql
```

### Production Data
- **Settings**: ✅ Site naam, kleuren, contact info
- **News Post**: ✅ Welcome post (publiek zichtbaar)
- **Test Users**: ❌ Not seeded (alleen admin)
- **Events/Concerts**: ❌ Not seeded (voeg toe via admin panel)

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
