# Email & Payment Integration Setup Guide

Deze guide helpt je om email notificaties en Mollie payments in te stellen voor het ticketing systeem.

## 📧 Email Setup (Resend)

### Stap 1: Account aanmaken
1. Ga naar [Resend.com](https://resend.com)
2. Maak een gratis account aan
3. Verifieer je email adres

### Stap 2: Domain toevoegen
1. Ga naar "Domains" in je dashboard
2. Klik "Add Domain"
3. Voeg `animato.be` toe
4. Volg de DNS instructies om SPF/DKIM records toe te voegen
5. Wacht op domain verificatie (kan 24 uur duren)

### Stap 3: API Key ophalen
1. Ga naar "API Keys" in je dashboard
2. Klik "Create API Key"
3. Geef een naam (bijv. "Animato Production")
4. Kopieer de key (begint met `re_`)

### Stap 4: Configureren
```bash
# In .dev.vars (lokaal)
RESEND_API_KEY=re_jouw_api_key_hier

# Voor productie (Cloudflare)
wrangler secret put RESEND_API_KEY --project-name animato-koor
# Plak je API key wanneer gevraagd
```

## 💳 Mollie Setup

### Stap 1: Account aanmaken
1. Ga naar [Mollie.com](https://www.mollie.com)
2. Maak een bedrijfsaccount aan
3. Volg het verificatieproces (KYC)

### Stap 2: Test Mode
1. Log in op het Mollie Dashboard
2. Schakel "Test mode" aan (toggle rechtsboven)
3. Ga naar "Developers" → "API keys"
4. Kopieer de **Test API key** (begint met `test_`)

### Stap 3: Configureren
```bash
# In .dev.vars (lokaal - TEST key)
MOLLIE_API_KEY=test_jouw_test_key_hier

# Voor productie (Cloudflare - LIVE key)
wrangler secret put MOLLIE_API_KEY --project-name animato-koor
# Gebruik je LIVE key (begint met live_)
```

### Stap 4: Webhook URL instellen
1. Ga naar "Developers" → "Webhooks" in Mollie dashboard
2. Klik "Add webhook"
3. URL: `https://animato-koor.pages.dev/api/webhooks/mollie`
4. Events selecteren: "payment.paid", "payment.failed", "payment.expired"
5. Opslaan

### Stap 5: Test betalingen
Gebruik deze test cards in test mode:
- **Succesvol**: 5555 5555 5555 4444
- **Mislukt**: 5555 5555 5555 5557
- CVC: 123
- Vervaldatum: elke toekomstige datum

## 🔒 Productie Deployment

### Cloudflare Secrets instellen
```bash
# Site URL (je echte domain)
wrangler secret put SITE_URL --project-name animato-koor
# Voer in: https://www.animato.be

# Resend API Key
wrangler secret put RESEND_API_KEY --project-name animato-koor
# Plak je live Resend key

# Mollie API Key (LIVE key!)
wrangler secret put MOLLIE_API_KEY --project-name animato-koor
# Plak je live Mollie key (begint met live_)

# Admin email
wrangler secret put ADMIN_EMAIL --project-name animato-koor
# Voer in: info@animato.be
```

### Deployment
```bash
# Build en deploy
npm run build
wrangler pages deploy dist --project-name animato-koor
```

## ✅ Test Checklist

### Email Tests
- [ ] Bestelbevestiging email ontvangen
- [ ] Email bevat correcte concert info
- [ ] Betaallink werkt
- [ ] Ticket email ontvangen na betaling
- [ ] QR code zichtbaar in email
- [ ] Emails komen van correct afzender adres

### Payment Tests
- [ ] Mollie checkout pagina opent
- [ ] Test betaling met success card werkt
- [ ] Webhook update ticket status naar "paid"
- [ ] Ticket email wordt verstuurd na betaling
- [ ] Confirmation pagina toont betaald status
- [ ] Admin dashboard toont omzet en betaalde tickets

### Webhook Test
- [ ] Ga naar Mollie dashboard → Webhooks
- [ ] Bekijk webhook calls log
- [ ] Check of alle calls status 200 hebben
- [ ] Test met verschillende payment statussen

## 🐛 Troubleshooting

### Emails worden niet verzonden
1. Check of Resend API key correct is
2. Verifieer of domain verified is in Resend
3. Check Cloudflare logs: `wrangler tail`
4. Bekijk Resend dashboard → Logs voor errors

### Payments werken niet
1. Check of Mollie API key correct is (test vs live)
2. Verifieer webhook URL in Mollie dashboard
3. Test webhook met Mollie dashboard test tool
4. Check Cloudflare logs voor errors

### Webhooks falen
1. Check of SITE_URL correct is ingesteld
2. Verifieer dat route `/api/webhooks/mollie` bereikbaar is
3. Test handmatig: `curl https://your-site.com/api/webhooks/mollie -X POST -d "id=tr_test123"`
4. Check Mollie webhook logs voor HTTP status codes

## 💰 Kosten

### Resend
- **Gratis tier**: 100 emails/dag, 3.000/maand
- **Pro**: €20/maand voor 50.000 emails
- Perfect voor meeste koren

### Mollie
- **Geen maandelijkse kosten**
- **Transactiekosten**: €0,29 + 1,1% per transactie
- Voorbeeld: €18 ticket = €0,29 + €0,20 = €0,49 kosten
- Automatic payout naar je bankrekening

## 📝 Best Practices

1. **Gebruik altijd test mode eerst** voordat je live gaat
2. **Monitor webhook logs** in Mollie dashboard
3. **Check email deliverability** in Resend dashboard
4. **Backup API keys** veilig (password manager)
5. **Test betalingsflow** maandelijks
6. **Keep secrets out of git** (gebruik .dev.vars lokaal)

## 🆘 Support

- **Resend**: support@resend.com
- **Mollie**: support@mollie.com
- **Docs**: 
  - https://resend.com/docs
  - https://docs.mollie.com

## 🎉 Ready to Go!

Als alle stappen voltooid zijn, is je ticketing systeem klaar voor gebruik!

Test grondig in test mode voordat je live gaat.
