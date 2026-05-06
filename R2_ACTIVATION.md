# R2 Storage — Activatie-instructies

Site is **live**: https://animato-live.pages.dev (deploy `5168afa7`).
R2 storage code is **klaar** in de codebase, maar de bucket `animato-storage`
moet één keer manueel aangemaakt worden via het Cloudflare dashboard
(API-token mist `R2:Edit` permissie).

---

## Stap 1 — Bucket aanmaken (1 minuut)

1. Open https://dash.cloudflare.com/?to=/:account/r2/overview
2. Klik **"Create bucket"**
3. Naam: `animato-storage` (exact zo)
4. Locatie: **Automatic** of **EU** (niet US)
5. Klik **"Create bucket"** — klaar.

## Stap 2 — Binding toevoegen aan Pages project

1. Open https://dash.cloudflare.com/?to=/:account/pages/view/animato-live
2. Tab **Settings** → **Functions** → **R2 bucket bindings**
3. Klik **"Add binding"**
4. Variable name: `R2`
5. R2 bucket: `animato-storage`
6. Klik **Save**

## Stap 3 — Optioneel: API-token upgraden (voor wrangler-deploys)

Het token in de sandbox mist R2 permissies. Voor toekomstige deploys via
wrangler-CLI met R2 binding:

1. https://dash.cloudflare.com/profile/api-tokens
2. Edit het bestaande token (of maak nieuw)
3. Voeg permissions toe:
   - **Workers R2 Storage: Edit** (account-niveau)
   - **Workers R2 Storage: Read** (account-niveau)

Anders: deploys via `git push` + Cloudflare's auto-build werken sowieso.

## Stap 4 — Nieuwe deploy met R2 binding

Na stap 1 + 2:

```bash
cd /home/user/webapp
npx wrangler pages deploy dist --project-name animato-live --branch main
```

Bij succes: alle nieuwe foto/PDF/cover-uploads gaan automatisch naar R2.

## Stap 5 — Bestaande data migreren naar R2

Open `/admin/r2-migrate` als admin. Vier knoppen:

1. **Album-foto's** (39 stuks, ~9.5 MB) — duurt ~1 min
2. **Profielfoto's** (14 stuks, ~1 MB) — duurt ~10 sec
3. **Album-covers** (paar stuks) — duurt ~5 sec
4. **Oefenmateriaal-bestanden** (0 momenteel) — N/A

Idempotent: rijen die al een `/r2/<key>` URL hebben worden overgeslagen.
Veilig om opnieuw te draaien als batch faalt.

---

## Gevolg na migratie

- Database grootte zakt van ~18 MB naar **~7 MB** (10 MB foto's verhuist)
- Geen `SQLITE_TOOBIG` errors meer bij foto/PDF uploads
- Upload-limiet stijgt van 700 KB → **25 MB** per bestand
- Snellere page loads (R2 cached via CDN, immutable)

## Code-pointers

- `src/utils/r2-storage.ts` — upload/delete/key-helpers
- `src/routes/r2.tsx` — `/r2/<key>` public serve route met long-cache
- `src/routes/admin-r2-migrate.tsx` — migratie-dashboard
- `migrations/0063_r2_storage_metadata.sql` — `r2_key` kolommen (al toegepast)
