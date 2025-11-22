# Mollie Payment Integratie - Complete Setup Guide

## 📋 Overzicht

Deze guide helpt je stap-voor-stap om Mollie betalingen te integreren in je concert ticketing systeem.

---

## STAP 1: Mollie Account Setup

### 1.1 Account Aanmaken

1. **Ga naar**: https://www.mollie.com/dashboard/signup
2. **Klik op** "Aan de slag" (gratis, geen setup kosten)
3. **Vul in**:
   - Email adres
   - Wachtwoord
   - Bedrijfsnaam: "Gemengd Koor Animato"
   - Land: België
4. **Verifieer** je email adres
5. **Voltooi** de onboarding vragenlijst

### 1.2 Bedrijfsgegevens Invullen

1. **Ga naar** Settings → Organization
2. **Vul in**:
   - Bedrijfsnaam: Gemengd Koor Animato
   - KVK nummer (indien van toepassing)
   - BTW nummer (indien van toepassing)
   - Adres
   - Bank account (IBAN)

**Let op**: Voor LIVE betalingen moet je bedrijf geverifieerd worden (1-2 werkdagen).

### 1.3 API Keys Ophalen

1. **Ga naar** Developers → API keys
2. **Kopieer**:
   - ✅ **Test API key** (begint met `test_...`)
   - ⏳ **Live API key** (komt na verificatie, begint met `live_...`)

**Voorbeeld test key**: `test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM`

### 1.4 Test Payment Methods Activeren

1. **Ga naar** Settings → Payment methods
2. **Activeer GRATIS test methods**:
   - ✅ iDEAL
   - ✅ Credit Card
   - ✅ Bancontact (voor België)
   - ✅ PayPal
   - ✅ Apple Pay / Google Pay

**Deze zijn gratis voor test mode!**

---

## STAP 2: Lokale Development Setup

### 2.1 Update .dev.vars File

Open `/home/user/webapp/.dev.vars` en update:

```bash
# Mollie Payment API (test mode)
MOLLIE_API_KEY=test_JOUW_ECHTE_TEST_KEY_HIER

# Resend API key (email provider)
RESEND_API_KEY=re_JOUW_RESEND_KEY_HIER

# Site URL (belangrijk voor redirects!)
SITE_URL=http://localhost:3000

# JWT en Session secrets
JWT_SECRET=dev-secret-change-in-production-please
SESSION_SECRET=dev-session-secret-change-me
```

**Belangrijke notes**:
- ⚠️ `.dev.vars` staat in `.gitignore` - wordt NIET gecommit
- ✅ Test keys zijn veilig voor local development
- ⚠️ Live keys NOOIT in git zetten

### 2.2 Rebuild en Restart Service

```bash
cd /home/user/webapp

# Build met nieuwe config
npm run build

# Restart service
fuser -k 3000/tcp 2>/dev/null || true
pm2 restart animato-koor
```

---

## STAP 3: Productie Setup (Cloudflare)

### 3.1 Cloudflare Secrets Instellen

**Voor productie gebruik je Cloudflare secrets (NIET .dev.vars!)**

```bash
# Test environment secrets
npx wrangler pages secret put MOLLIE_API_KEY
# Vul in: test_JOUW_KEY

npx wrangler pages secret put RESEND_API_KEY  
# Vul in: re_JOUW_KEY

npx wrangler pages secret put JWT_SECRET
# Vul in: een random 32+ karakter string

npx wrangler pages secret put SESSION_SECRET
# Vul in: een random 32+ karakter string

npx wrangler pages secret put SITE_URL
# Vul in: https://animato-koor.pages.dev (of je eigen domein)
```

### 3.2 Lijst Secrets Controleren

```bash
npx wrangler pages secret list --project-name animato-koor
```

Je zou moeten zien:
- MOLLIE_API_KEY
- RESEND_API_KEY  
- JWT_SECRET
- SESSION_SECRET
- SITE_URL

---

## STAP 4: Testing Payment Flow

### 4.1 Test Scenario: Complete Ticket Purchase

**1. Start lokale server**:
```bash
cd /home/user/webapp
pm2 list  # Check if running
```

**2. Open browser**:
```
http://localhost:3000/concerten
```

**3. Klik op een concert** → "Tickets Bestellen"

**4. Selecteer tickets**:
- Kies aantal tickets
- Vul naam en email in
- Accepteer voorwaarden
- Klik "Bestelling Plaatsen"

**5. Je wordt doorgestuurd naar Mollie**:
- Kies "iDEAL" 
- Kies test bank: "ABN AMRO - Test"
- Status kiezen:
  - ✅ **Betaling geslaagd** → test succesvolle betaling
  - ❌ **Betaling mislukt** → test failed payment
  - ⏸️ **Betaling in behandeling** → test pending status

**6. Check de flow**:
- Je wordt teruggestuurd naar bevestigingspagina
- Email wordt verstuurd met order confirmatie
- Na betaling: email met tickets + QR code
- Check database: `status` update naar 'paid'

### 4.2 Test Mollie API Direct

Test of je API key werkt:

```bash
# Get available payment methods
curl -X GET "https://api.mollie.com/v2/methods" \
  -H "Authorization: Bearer test_JOUW_KEY_HIER"

# Should return list of payment methods (iDEAL, creditcard, etc)
```

**Expected output**: JSON met payment methods

### 4.3 Test Database

Check ticket status in database:

```bash
cd /home/user/webapp

# Lijst recent tickets
npx wrangler d1 execute animato-production --local --command="
SELECT 
  order_ref, 
  koper_email, 
  aantal, 
  prijs_totaal, 
  status, 
  betaald_at,
  created_at
FROM tickets 
ORDER BY created_at DESC 
LIMIT 5
"
```

**Expected statuses**:
- `pending` - Wacht op betaling
- `paid` - Betaling succesvol
- `cancelled` - Betaling mislukt/geannuleerd

---

## STAP 5: Webhook Setup (BELANGRIJK!)

### 5.1 Wat Zijn Webhooks?

Webhooks zijn **automatische notificaties** van Mollie naar jouw server wanneer:
- ✅ Betaling succesvol
- ❌ Betaling mislukt  
- ⏳ Betaling pending
- 🔄 Status changed

**Zonder webhooks**: Je weet pas van betaling als gebruiker terugkomt.
**Met webhooks**: Je krijgt direct notificatie, ook als browser gesloten is.

### 5.2 Local Development - ngrok Setup

Voor local testing heb je een public URL nodig:

```bash
# Installeer ngrok (eenmalig)
# Download van: https://ngrok.com/download

# Start ngrok tunnel
ngrok http 3000

# Output:
# Forwarding: https://abc123.ngrok.io -> http://localhost:3000
```

**Update .dev.vars**:
```bash
SITE_URL=https://abc123.ngrok.io
```

**Restart service**:
```bash
cd /home/user/webapp
npm run build
pm2 restart animato-koor
```

### 5.3 Productie Webhooks (Cloudflare)

**Webhook URL**: `https://animato-koor.pages.dev/api/webhooks/mollie`

**In Mollie Dashboard**:
1. Ga naar Settings → Webhooks
2. Click "Add webhook"
3. URL: `https://animato-koor.pages.dev/api/webhooks/mollie`
4. Events: Selecteer allemaal
5. Save

**Test webhook**:
- Doe een test betaling
- Check Mollie Dashboard → Payments → Details → Webhook calls
- Moet "200 OK" tonen

---

## STAP 6: Email Setup (Resend)

### 6.1 Resend Account Setup

1. **Ga naar**: https://resend.com/signup
2. **Maak account** aan (gratis: 100 emails/dag)
3. **Ga naar** API Keys
4. **Maak API key** aan
5. **Kopieer** key (begint met `re_...`)

### 6.2 Domain Verificatie (Optioneel maar aanbevolen)

**Voor productie emails vanaf eigen domein**:

1. **Ga naar** Domains → Add Domain
2. **Vul in**: animato.be
3. **Voeg DNS records** toe:
   - TXT record voor SPF
   - DKIM records
4. **Wacht** op verificatie (5-60 minuten)

**Na verificatie**: Emails komen van `noreply@animato.be` ipv `onboarding@resend.dev`

### 6.3 Test Email Sending

```bash
# Test via curl
curl -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer re_JOUW_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "test@resend.dev",
    "to": ["jouw@email.com"],
    "subject": "Test Email",
    "html": "<p>Dit is een test</p>"
  }'
```

**Expected**: Email ontvangen in inbox

---

## STAP 7: Production Deployment

### 7.1 Pre-Deployment Checklist

- [ ] Mollie LIVE API key verkregen (na bedrijfsverificatie)
- [ ] Domain geverifieerd in Resend
- [ ] Alle Cloudflare secrets ingesteld
- [ ] Webhook URL geconfigureerd in Mollie
- [ ] Test payments succesvol gedaan in TEST mode
- [ ] Emails worden correct verzonden

### 7.2 Deploy naar Cloudflare

```bash
cd /home/user/webapp

# Build productie versie
npm run build

# Deploy naar Cloudflare Pages
npm run deploy

# Of direct met wrangler
npx wrangler pages deploy dist --project-name animato-koor
```

### 7.3 Switch naar LIVE Mollie Key

**⚠️ BELANGRIJK**: Test eerst grondig in test mode!

```bash
# Update Cloudflare secret met LIVE key
npx wrangler pages secret put MOLLIE_API_KEY --project-name animato-koor
# Vul in: live_JOUW_LIVE_KEY

# Redeploy (secrets update niet automatisch)
npm run deploy
```

### 7.4 Verify Production

1. **Open**: https://animato-koor.pages.dev/concerten
2. **Test een echte betaling** (klein bedrag: €0.01)
3. **Check**:
   - [ ] Payment succesvol in Mollie dashboard
   - [ ] Ticket status = 'paid' in database
   - [ ] 2 Emails ontvangen (confirmatie + tickets)
   - [ ] Webhook call succesvol (200 OK)

---

## 🐛 Troubleshooting

### Problem: "Missing authentication" error

**Oorzaak**: Ongeldige of verkeerde API key

**Oplossing**:
```bash
# Check of key correct is
echo $MOLLIE_API_KEY  # local
npx wrangler pages secret list  # productie

# Test key direct
curl -X GET "https://api.mollie.com/v2/methods" \
  -H "Authorization: Bearer JOUW_KEY"
```

### Problem: Webhook niet aangeroepen

**Oorzaak**: Webhook URL niet bereikbaar of niet ingesteld

**Oplossing**:
1. Check Mollie Dashboard → Settings → Webhooks
2. URL moet public zijn (geen localhost!)
3. Test webhook handmatig in Mollie dashboard
4. Check server logs: `pm2 logs animato-koor`

### Problem: Emails niet ontvangen

**Oorzaak**: Ongeldige Resend key of verkeerde email

**Oplossing**:
```bash
# Check Resend key
echo $RESEND_API_KEY

# Check server logs voor email errors
pm2 logs animato-koor --lines 50 | grep -i "email"

# Verify email in Resend dashboard
https://resend.com/emails
```

### Problem: Payment succesvol maar status niet updated

**Oorzaak**: Webhook niet verwerkt of database error

**Oplossing**:
```bash
# Check webhook logs in Mollie Dashboard
# Check server error logs
pm2 logs animato-koor --lines 100 | grep -i "webhook\|error"

# Manually check payment status
npx wrangler d1 execute animato-production --local --command="
SELECT * FROM tickets WHERE betaling_id = 'tr_PAYMENT_ID'
"

# Manually trigger status update (development only!)
curl -X POST "http://localhost:3000/api/webhooks/mollie" \
  -d "id=tr_PAYMENT_ID"
```

---

## 📊 Monitoring & Analytics

### Check Recent Orders

```bash
# Last 10 orders with status
npx wrangler d1 execute animato-production --local --command="
SELECT 
  order_ref,
  koper_naam,
  aantal,
  prijs_totaal,
  status,
  DATE(created_at) as datum
FROM tickets
ORDER BY created_at DESC
LIMIT 10
"
```

### Revenue Report

```bash
# Total paid tickets per concert
npx wrangler d1 execute animato-production --command="
SELECT 
  e.titel,
  COUNT(*) as aantal_tickets,
  SUM(t.aantal) as aantal_personen,
  SUM(t.prijs_totaal) as totaal_omzet
FROM tickets t
JOIN concerts c ON c.id = t.concert_id
JOIN events e ON e.id = c.event_id
WHERE t.status = 'paid'
GROUP BY e.titel
ORDER BY totaal_omzet DESC
"
```

### Payment Failure Rate

```bash
npx wrangler d1 execute animato-production --command="
SELECT 
  status,
  COUNT(*) as aantal,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM tickets), 2) as percentage
FROM tickets
GROUP BY status
"
```

---

## 🔐 Security Best Practices

### Environment Variables

- ✅ **NEVER** commit API keys to git
- ✅ Use `.dev.vars` for local, Cloudflare Secrets for production
- ✅ Use different keys for test and production
- ✅ Rotate keys regularly (elke 6 maanden)

### Webhook Verification

**TODO**: Implement Mollie signature verification

```typescript
// In webhooks.tsx - add signature check
const signature = c.req.header('Mollie-Signature')
// Verify signature matches
```

### Rate Limiting

**TODO**: Add rate limiting to prevent abuse

```typescript
// Prevent ticket scalping
// Max 10 tickets per order
// Max 3 orders per email per day
```

---

## 📚 Resources

- **Mollie Docs**: https://docs.mollie.com
- **Mollie API Reference**: https://docs.mollie.com/reference/v2
- **Resend Docs**: https://resend.com/docs
- **Cloudflare Pages**: https://developers.cloudflare.com/pages
- **Test Cards**: https://docs.mollie.com/overview/testing

---

## ✅ Success Checklist

Voordat je live gaat:

- [ ] Mollie account fully verified
- [ ] Test payments succesvol in TEST mode
- [ ] Webhooks werken correct
- [ ] Emails worden verzonden en ontvangen
- [ ] QR codes gegenereerd
- [ ] Database backup gemaakt
- [ ] Error handling getest
- [ ] Payment failure scenarios getest
- [ ] Refund flow getest (optional)
- [ ] Admin dashboard werkt
- [ ] Customer support email ingesteld

**Als alles ✅ is: GO LIVE! 🚀**

---

## 🆘 Support

**Problemen met:**
- Mollie: support@mollie.com
- Resend: support@resend.com  
- Cloudflare: https://community.cloudflare.com

**Internal support**:
- Email: admin@animato.be
- Check logs: `pm2 logs animato-koor`
