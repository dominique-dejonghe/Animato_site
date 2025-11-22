# 🎫 Ticketing Systeem - Animato Koor

Complete handleiding voor het online ticketverkoop systeem met Mollie betalingen.

## ✨ Functionaliteit

### Voor Bezoekers
- **Tickets bestellen** via moderne online interface
- **Meerdere prijscategorieën** (Volwassenen, Studenten, VIP, etc.)
- **Veilige online betaling** via Mollie (iDEAL, creditcard, etc.)
- **Automatische emails**:
  - Bestelbevestiging met betaallink
  - Tickets met QR-code na succesvolle betaling
- **QR-codes** op tickets voor toegangscontrole
- **Real-time capaciteit** check (uitverkocht status)

### Voor Admin
- **Dashboard** met overzicht van alle concerten
- **Statistieken**: totale omzet, verkochte tickets, uitverkocht status
- **Bestellingen beheer**: overzicht per concert
- **Handmatige betaling**: markeer contante/bankoverschrijving als betaald
- **QR-code scanner**: bekijk QR-codes van bestellingen

## 🏗️ Technische Architectuur

### Database Schema

**events tabel** (bestaand):
- `id`, `titel`, `start_at`, `locatie`, `type` ('concert'), etc.

**concerts tabel**:
```sql
CREATE TABLE concerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  programma TEXT,
  prijsstructuur TEXT,  -- JSON: [{"categorie":"Volwassenen","prijs":18}, ...]
  capaciteit INTEGER DEFAULT 0,
  verkocht INTEGER DEFAULT 0,
  uitverkocht INTEGER DEFAULT 0,
  ticketing_enabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
)
```

**tickets tabel**:
```sql
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,
  order_ref TEXT NOT NULL UNIQUE,  -- TIX-ABC123DEF
  koper_email TEXT NOT NULL,
  koper_naam TEXT NOT NULL,
  koper_telefoon TEXT,
  aantal INTEGER NOT NULL,
  categorie TEXT NOT NULL,  -- "2x Volwassenen, 1x Student"
  prijs_totaal REAL NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, paid, cancelled
  qr_code TEXT UNIQUE,
  betaling_id TEXT,  -- Mollie payment ID
  besteld_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  betaald_at DATETIME,
  FOREIGN KEY (concert_id) REFERENCES concerts(id)
)
```

### Prijsstructuur Format (JSON)

```json
[
  {
    "categorie": "Volwassenen",
    "prijs": 18,
    "beschrijving": "Standaard toegang"
  },
  {
    "categorie": "Studenten",
    "prijs": 12,
    "beschrijving": "Met geldige studentenkaart"
  },
  {
    "categorie": "VIP",
    "prijs": 45,
    "beschrijving": "Inclusief drankje in pauze"
  }
]
```

## 🔄 Bestelflow

### 1. Klant bezoekt ticketpagina
**URL**: `/concerten/{eventId}/tickets`

**Checks**:
- ✅ Ticketing enabled?
- ✅ Niet uitverkocht?
- ✅ Toekomstig event?

**Features**:
- Overzicht van prijscategorieën
- Ticket selector (+/- knoppen)
- Real-time totaalberekening
- Klantgegevens formulier (auto-fill voor ingelogde leden)

### 2. Bestelling plaatsen
**API**: `POST /api/tickets/order`

**Flow**:
```
1. Valideer ticket selectie
2. Check capaciteit
3. Genereer order referentie (TIX-ABC123DEF)
4. Genereer unieke QR-code (UUID)
5. Maak Mollie betaling aan
6. Sla ticket order op (status: 'pending')
7. Update concert.verkocht count
8. Stuur bestelbevestiging email
9. Redirect naar Mollie checkout
```

**Email: Bestelbevestiging**
- Order referentie
- Concert details
- Ticket overzicht
- Totaalbedrag
- **Betaallink** (Mollie checkout)

### 3. Betaling via Mollie
**Betalingsmethoden**:
- iDEAL (meest populair in NL)
- Credit/Debit Card
- PayPal
- Bancontact (België)
- Apple Pay / Google Pay

**Mollie Payment Object**:
```javascript
{
  amount: { currency: 'EUR', value: '36.00' },
  description: 'Tickets Kerstconcert 2025 - TIX-ABC123',
  redirectUrl: 'https://animato.be/tickets/bevestiging/TIX-ABC123',
  webhookUrl: 'https://animato.be/api/webhooks/mollie',
  metadata: {
    order_ref: 'TIX-ABC123',
    concert_id: 222
  }
}
```

### 4. Webhook van Mollie
**API**: `POST /api/webhooks/mollie`

**Wanneer?**
- Betaling succesvol
- Betaling mislukt
- Betaling verlopen
- Betaling geannuleerd

**Flow bij succesvolle betaling**:
```
1. Ontvang payment ID van Mollie
2. Haal payment status op via Mollie API
3. Zoek ticket order op basis van payment ID
4. Map Mollie status naar ticket status
5. Update ticket.status = 'paid'
6. Stel ticket.betaald_at in
7. Stuur ticket email met QR-code
```

**Email: Tickets**
- ✅ Bevestiging van betaling
- 🎫 QR-code voor toegang
- 📅 Concert details
- 📍 Locatie informatie
- 📧 Contactinformatie

### 5. Bevestigingspagina
**URL**: `/tickets/bevestiging/{orderRef}`

**Toont**:
- ✅ Betalingsstatus (success/pending/failed)
- 🎫 Ticket details
- 📧 "Check je email voor tickets"
- 🔄 QR-code (indien betaald)

## 🔐 Mollie Integratie

### API Keys
**Test mode** (voor development):
```bash
MOLLIE_API_KEY=test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM
```

**Live mode** (voor productie):
```bash
MOLLIE_API_KEY=live_xxxxxxxxxxxxxx
```

### Helper Functions

**Create Payment**:
```typescript
import { createMolliePayment } from '../utils/mollie'

const payment = await createMolliePayment(apiKey, {
  amount: 36.00,
  description: 'Tickets Concert',
  redirectUrl: 'https://site.com/confirmation',
  webhookUrl: 'https://site.com/api/webhooks/mollie',
  metadata: { order_ref: 'TIX-123' }
})

// Redirect to: payment._links.checkout.href
```

**Get Payment Status**:
```typescript
import { getMolliePayment } from '../utils/mollie'

const payment = await getMolliePayment(apiKey, paymentId)
console.log(payment.status) // 'paid', 'pending', 'failed', etc.
```

**Status Mapping**:
```typescript
Mollie Status → Ticket Status
'paid'        → 'paid'
'open'        → 'pending'
'pending'     → 'pending'
'failed'      → 'cancelled'
'expired'     → 'cancelled'
'canceled'    → 'cancelled'
```

## 📧 Email Systeem

### Resend API
**Setup**:
```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxx
```

### Email Templates

**1. orderConfirmationEmail()**
- **Wanneer**: Direct na bestelling
- **Doel**: Bestelbevestiging + betaallink
- **Stijl**: Blauw/Paars gradient
- **CTA**: "Betaal Nu" knop

**2. ticketEmail()**
- **Wanneer**: Na succesvolle betaling
- **Doel**: Tickets + QR-code
- **Stijl**: Groen succes thema
- **Inhoud**: QR-code, concert details, instructies

**3. paymentReminderEmail()**
- **Wanneer**: 24u na pending order
- **Doel**: Herinnering betaling
- **Stijl**: Oranje waarschuwing
- **CTA**: Betaallink

### Email Helper
```typescript
import { sendEmail } from '../utils/email'

await sendEmail({
  to: 'klant@email.com',
  subject: 'Je Tickets',
  html: ticketEmail({ ... })
}, resendApiKey)
```

## 👨‍💼 Admin Functionaliteit

### Dashboard: `/admin/tickets`

**Statistieken**:
- 📊 Totaal aantal concerten met ticketing
- 🎫 Totaal verkochte tickets
- 💰 Totale omzet (€)
- ⭕ Aantal uitverkochte concerten

**Concert Lijst**:
- Concert titel + datum
- Capaciteit tracking (50/300)
- Omzet per concert
- Ticketing status (enabled/disabled)

**Per Concert Details**:
- Alle bestellingen
- Klantgegevens
- Betaalstatus
- QR-codes
- Acties: Bekijk QR, Markeer als betaald

### Handmatige Betaling Markeren

Voor contante betalingen of bankoverschrijvingen:

```
1. Ga naar concert in admin dashboard
2. Zoek bestelling op
3. Klik "Markeer als Betaald"
4. System update:
   - status = 'paid'
   - betaald_at = NOW()
5. Stuur ticket email automatisch
```

**API**: `POST /admin/tickets/{id}/mark-paid`

## 🧪 Testing Flow

### Test met Mollie Test Mode

**1. Activeer test mode**:
```bash
# .dev.vars
MOLLIE_API_KEY=test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM
```

**2. Test betaling**:
- Bestel tickets via frontend
- Mollie toont test checkout
- Kies "Betaling Gelukt" of "Betaling Mislukt"
- Webhook wordt getriggerd
- Check email (in Resend dashboard)

**3. Test credit cards** (Mollie test mode):
```
✅ Success: 5555 5555 5555 4444
❌ Failed:  5555 5555 5555 5557
```

### Lokale Webhook Testing

**Probleem**: Mollie kan geen localhost aanroepen

**Oplossing 1**: ngrok tunnel
```bash
ngrok http 3000
# Use ngrok URL voor webhookUrl
```

**Oplossing 2**: Handmatig webhook simuleren
```bash
curl -X POST http://localhost:3000/api/webhooks/mollie \
  -d "id=tr_xxxxx"
```

**Oplossing 3**: Check payment status endpoint
```
GET /api/payment-status/{orderId}
```

## 💰 Kosten Overzicht

### Mollie Transactiekosten
- **iDEAL**: €0,29 per transactie
- **Credit Card**: 1,8% + €0,25 per transactie
- **PayPal**: 2,49% per transactie

**Voorbeeld**: Ticket €20
- iDEAL: €0,29 kosten → Je ontvangt €19,71
- Visa: 1,8% + €0,25 = €0,61 → Je ontvangt €19,39

### Resend Email Kosten
- **Gratis tier**: 3.000 emails/maand
- **Betaald**: $20/maand voor 50.000 emails

**Gebruik per bestelling**: 2 emails (bevestiging + tickets)

## 🚀 Productie Deployment

### Environment Variables
```bash
# Cloudflare Pages/Workers secrets
wrangler pages secret put MOLLIE_API_KEY
wrangler pages secret put RESEND_API_KEY
wrangler pages secret put SITE_URL

# Values:
MOLLIE_API_KEY=live_xxxxxxxxxxxxxx
RESEND_API_KEY=re_xxxxxxxxxxxxxx
SITE_URL=https://animato.be
```

### Webhook URL Setup
1. Login bij Mollie Dashboard
2. Ga naar Settings → Webhooks
3. Voeg toe: `https://animato.be/api/webhooks/mollie`
4. Test webhook via dashboard

### DNS & SSL
- ✅ Custom domain setup (animato.be)
- ✅ SSL certificaat (automatisch via Cloudflare)
- ✅ HTTPS enforced

## 🎯 Best Practices

### Security
- ✅ Webhook signature verificatie (TODO: implementeren)
- ✅ API keys in environment variables (nooit in code!)
- ✅ Rate limiting op order endpoint
- ✅ CSRF protection op forms

### UX
- ✅ Real-time capaciteit check
- ✅ Duidelijke foutmeldingen
- ✅ Mobile-friendly design
- ✅ Progress indicator tijdens bestelling
- ✅ Email bevestigingen binnen 1 minuut

### Performance
- ✅ Database indexen op order_ref, betaling_id
- ✅ Cached concert data
- ✅ Async email sending
- ✅ Webhook retry logic (Mollie automatisch)

## 📱 Frontend Flow Diagram

```
┌─────────────────┐
│ Concert Pagina  │
│  /concerten/X   │
└────────┬────────┘
         │
         │ [Tickets Bestellen]
         ▼
┌─────────────────┐
│  Ticket Form    │
│  Select tickets │
│  + Klantgegevens│
└────────┬────────┘
         │
         │ [Bestelling Plaatsen]
         ▼
┌─────────────────┐
│  Order API      │
│  - Validatie    │
│  - Create order │
│  - Mollie pay   │
│  - Send email   │
└────────┬────────┘
         │
         │ [Redirect]
         ▼
┌─────────────────┐
│ Mollie Checkout │
│  - iDEAL        │
│  - Card         │
│  - PayPal       │
└────────┬────────┘
         │
         │ [Betaling]
         ▼
┌─────────────────┐     ┌──────────────┐
│ Confirmation    │ ◄───┤  Webhook     │
│ Page (redirect) │     │  (async)     │
└─────────────────┘     └──────┬───────┘
         │                     │
         │                     │ [Update status]
         ▼                     ▼
    ┌─────────────────────────────┐
    │  Email met Tickets + QR     │
    └─────────────────────────────┘
```

## 🛠️ Troubleshooting

### Webhook niet ontvangen
**Check**:
1. Webhook URL correct in Mollie dashboard?
2. Server bereikbaar vanaf internet?
3. HTTPS enabled? (verplicht voor webhooks)
4. Check Mollie webhook logs in dashboard

### Email niet verzonden
**Check**:
1. Resend API key correct?
2. Sender domain geverifieerd?
3. Rate limits niet bereikt?
4. Check Resend dashboard voor logs

### Betaling werkt niet
**Check**:
1. Juiste API key (test vs live)?
2. Amount in correct format (decimaal)?
3. Valid redirect/webhook URLs?
4. Check Mollie dashboard voor errors

### QR-code niet uniek
**Check**:
1. Database constraint op qr_code?
2. crypto.randomUUID() beschikbaar?
3. Duplicate insert errors in logs?

## 📞 Support & Contact

**Mollie**: support@mollie.com
**Resend**: support@resend.com
**System Admin**: beheer@animato.be

## ✅ Feature Checklist

- [x] Concert/event management in admin
- [x] Ticket ordering form met prijscategorieën
- [x] Mollie payment integratie
- [x] Webhook processing voor status updates
- [x] Email bevestigingen (Resend)
- [x] QR-code generatie per ticket
- [x] Admin dashboard met statistieken
- [x] Admin bestellingen overzicht
- [x] Handmatige betaling markeren
- [x] Capaciteit tracking
- [x] Uitverkocht status
- [ ] QR-code scanner app (toekomst)
- [ ] Ticket annulering/refund (toekomst)
- [ ] Kortingscodes (toekomst)
- [ ] Groepskortingen (toekomst)

---

**Versie**: 1.0
**Laatste update**: November 2024
**Auteur**: Animato Koor Development Team
