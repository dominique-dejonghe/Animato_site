# 🚀 Mollie Ticketing - Quick Start Guide

## Wat heb je nodig? (5 minuten setup)

### 1️⃣ Mollie Test API Key

**Ga naar**: https://www.mollie.com/dashboard/developers/api-keys

Als je nog geen account hebt:
1. Signup op https://www.mollie.com/signup (gratis!)
2. Verifieer email
3. Ga naar Developers → API keys
4. Kopieer de **TEST** key (begint met `test_...`)

### 2️⃣ Resend API Key (voor emails)

**Ga naar**: https://resend.com/api-keys

Als je nog geen account hebt:
1. Signup op https://resend.com/signup (gratis: 100 emails/dag!)
2. Create API key
3. Kopieer de key (begint met `re_...`)

### 3️⃣ Update .dev.vars

Open `.dev.vars` en vervang de keys:

```bash
# VERVANG DEZE:
MOLLIE_API_KEY=test_JOUW_ECHTE_KEY_HIER
RESEND_API_KEY=re_JOUW_ECHTE_KEY_HIER

# Deze kunnen zo blijven voor local testing:
SITE_URL=http://localhost:3000
JWT_SECRET=dev-secret-change-in-production-please
SESSION_SECRET=dev-session-secret-change-me
```

### 4️⃣ Rebuild & Restart

```bash
cd /home/user/webapp
npm run build
pm2 restart animato-koor
```

### 5️⃣ Test de Integratie

```bash
cd /home/user/webapp
./test-mollie.sh
```

✅ Als alles groen is: **KLAAR!**

---

## 🎫 Je Eerste Test Bestelling

### Stap 1: Maak een Concert aan

```bash
# Browser
http://localhost:3000/admin/events/nieuw?type=concert
```

Vul in:
- Titel: "Test Concert"
- Datum: Morgen
- Locatie: "Test Locatie"
- **Ticketing enabled**: ✅ AAN
- Capaciteit: 100
- Prijzen: `[{"categorie":"Volwassenen","prijs":15},{"categorie":"Kinderen","prijs":8}]`

### Stap 2: Test de Bestelpagina

```bash
# Browser
http://localhost:3000/concerten
```

1. Klik op je test concert
2. Klik "Tickets Bestellen"
3. Selecteer aantal tickets
4. Vul je gegevens in
5. Klik "Bestelling Plaatsen"

### Stap 3: Test Betaling (Mollie)

Je wordt doorgestuurd naar Mollie test environment:

1. Kies betaalmethode: **iDEAL**
2. Kies bank: **ABN AMRO - Test**  
3. Kies status:
   - ✅ **Betaling geslaagd** → test success
   - ❌ **Betaling mislukt** → test failure
   - ⏸️ **In behandeling** → test pending

### Stap 4: Controleer Resultaat

**Check bevestigingspagina**:
- Je ziet je order referentie (bijv. `TIX-ABC123`)
- Status indicator (pending of paid)

**Check email**:
- 1e email: Order confirmatie met betaallink
- 2e email (na betaling): Tickets met QR code

**Check database**:
```bash
cd /home/user/webapp
npx wrangler d1 execute animato-production --local --command="
SELECT order_ref, koper_email, status, prijs_totaal, created_at 
FROM tickets 
ORDER BY created_at DESC 
LIMIT 5
"
```

**Check logs**:
```bash
pm2 logs animato-koor --lines 20
```

---

## 🐛 Snel Troubleshooten

### ❌ "Missing authentication" error

**Probleem**: Ongeldige Mollie API key

**Fix**:
1. Check `.dev.vars` → key correct?
2. Key echt van Mollie dashboard?
3. Test met: `./test-mollie.sh`

### ❌ Geen emails ontvangen

**Probleem**: Ongeldige Resend key of email

**Fix**:
1. Check `.dev.vars` → Resend key correct?
2. Check Resend dashboard → Daily quota bereikt? (gratis: 100/dag)
3. Check spam folder
4. Test direct: https://resend.com/docs/send-with-curl

### ❌ Webhook niet aangeroepen

**Probleem**: Localhost niet bereikbaar voor Mollie

**Voor local development**:
Gebruik **ngrok** voor public webhook URL:

```bash
# Install ngrok (one time)
# https://ngrok.com/download

# Start ngrok
ngrok http 3000

# Copy the URL (bijv: https://abc123.ngrok.io)
# Update .dev.vars:
SITE_URL=https://abc123.ngrok.io

# Rebuild & restart
npm run build && pm2 restart animato-koor
```

**Voor productie**: Geen probleem, Cloudflare Pages URL is al public!

### ❌ Payment succesvol maar status blijft "pending"

**Probleem**: Webhook error of database update mislukt

**Check**:
```bash
# Check logs voor webhook calls
pm2 logs animato-koor --lines 50 | grep -i "webhook\|payment"

# Check Mollie dashboard
https://www.mollie.com/dashboard/payments
# → Click payment → Webhooks tab → Should show "200 OK"
```

**Manual fix** (development only):
```bash
# Trigger webhook manually
curl -X POST "http://localhost:3000/api/webhooks/mollie" \
  -d "id=tr_PAYMENT_ID_FROM_MOLLIE"
```

---

## 📚 Volledige Documentatie

Voor gedetailleerde setup en productie deployment:

```bash
cat MOLLIE_SETUP.md
```

Topics:
- Complete Mollie account setup
- Productie deployment naar Cloudflare
- Webhook verificatie
- Email domain setup
- Monitoring & analytics
- Security best practices

---

## ✅ Success Checklist

Voordat je LIVE gaat, test deze scenarios:

- [ ] Test payment: Succesvolle betaling
- [ ] Test payment: Mislukte betaling
- [ ] Test payment: Geannuleerde betaling
- [ ] Email: Order confirmatie ontvangen
- [ ] Email: Ticket email met QR code ontvangen
- [ ] Database: Ticket status correct updated
- [ ] Webhook: Mollie roept webhook aan (200 OK)
- [ ] Bevestigingspagina: Toont correcte status
- [ ] Admin dashboard: Tickets zichtbaar
- [ ] QR code: Uniek per ticket

**Alles ✅? JE BENT KLAAR! 🎉**

---

## 🆘 Hulp Nodig?

**Documentatie**:
- `MOLLIE_SETUP.md` - Complete setup guide
- `test-mollie.sh` - Test script
- https://docs.mollie.com - Mollie docs
- https://resend.com/docs - Resend docs

**Test Tools**:
```bash
./test-mollie.sh           # Test API connectivity
pm2 logs animato-koor      # View server logs
pm2 list                   # Check service status
npm run build              # Rebuild after changes
```

**Support**:
- Mollie: support@mollie.com
- Resend: support@resend.com

---

## 🎯 Next Steps

Na succesvolle test mode:

1. **Bedrijf Verificatie** (Mollie)
   - Upload documenten in Mollie dashboard
   - Wacht 1-2 werkdagen
   - Ontvang LIVE API key

2. **Domain Verificatie** (Resend)
   - Add DNS records
   - Emails vanaf eigen domein: noreply@animato.be

3. **Productie Deployment**
   - Deploy naar Cloudflare Pages
   - Configure production secrets
   - Switch van TEST naar LIVE keys

4. **Go Live!** 🚀
   - Monitor eerste betalingen
   - Check error logs
   - Customer feedback verzamelen

**Veel succes! 🎵**
