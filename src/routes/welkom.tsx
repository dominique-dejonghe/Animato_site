// =====================================================
// WELKOM SPLASH \u2014 voor nieuwe koorleden bij eerste login
// =====================================================
//
// Trigger: in auth.tsx, na succesvolle login, checken we of de user
// role='lid' heeft \u00e9n welcome_splash_seen=0. Zo ja \u2192 redirect naar
// /leden/welkom. Zo nee \u2192 normale redirect naar /leden.
//
// Deze route:
//   1. Verifieert dat user lid is en splash nog niet zag (anders 302)
//   2. Markeert welcome_splash_seen=1 + timestamp \u2192 splash maar 1x
//   3. Toont fullscreen scherm met canvas-confetti animatie
//   4. Personaliseerde begroeting + uitleg + CTA naar /leden

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireLid } from '../middleware/auth'
import { execute, queryOne } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/leden/welkom', requireLid)

app.get('/leden/welkom', async (c) => {
  const user = c.get('user') as SessionUser

  // Veiligheid: alleen voor leden
  if (user.role !== 'lid' && user.role !== 'admin' && user.role !== 'moderator') {
    return c.redirect('/leden')
  }

  // Check huidige flag-state. Als al gezien \u2192 normaal naar /leden
  // (uitzondering: query param ?preview=1 voor admins om scherm te bekijken)
  const isPreview = c.req.query('preview') === '1'
  const row = await queryOne<{ welcome_splash_seen: number }>(
    c.env.DB,
    `SELECT welcome_splash_seen FROM users WHERE id = ?`,
    [user.id]
  )

  if (!isPreview && row?.welcome_splash_seen === 1) {
    return c.redirect('/leden')
  }

  // Markeer als gezien (alleen wanneer geen preview)
  if (!isPreview) {
    await execute(
      c.env.DB,
      `UPDATE users SET welcome_splash_seen = 1, welcome_splash_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [user.id]
    )
  }

  // Haal voornaam voor persoonlijke begroeting
  const profile = await queryOne<{ voornaam: string }>(
    c.env.DB,
    `SELECT voornaam FROM profiles WHERE user_id = ?`,
    [user.id]
  )
  const voornaam = profile?.voornaam || 'koorlid'

  return c.html(
    <Layout title="Welkom in het koor!" user={user} currentPath="/leden/welkom">
      {/* Canvas-confetti CDN \u2014 lichtgewicht (~12kB), smooth particles */}
      <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>

      <div class="min-h-[calc(100vh-80px)] bg-gradient-to-br from-animato-secondary via-animato-secondary to-animato-primary relative overflow-hidden">
        {/* Decoratieve muziek-noten op de achtergrond */}
        <div class="absolute inset-0 opacity-10 pointer-events-none select-none">
          <div class="absolute top-10 left-10 text-white text-9xl">&#9835;</div>
          <div class="absolute top-32 right-20 text-white text-7xl">&#9833;</div>
          <div class="absolute bottom-20 left-1/4 text-white text-8xl">&#9839;</div>
          <div class="absolute bottom-40 right-1/3 text-white text-6xl">&#9837;</div>
          <div class="absolute top-1/2 left-1/2 text-white text-9xl">&#9835;</div>
        </div>

        <div class="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 text-center">

          {/* Logo / icoon */}
          <div class="mb-8 animate-bounce-slow">
            <div class="inline-flex items-center justify-center w-24 h-24 bg-white rounded-full shadow-2xl">
              <i class="fas fa-music text-5xl text-animato-primary"></i>
            </div>
          </div>

          {/* Hoofdtekst */}
          <h1
            class="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 drop-shadow-lg"
            style="font-family: 'Playfair Display', serif;"
          >
            Welkom in het koor, {voornaam}! 🎵
          </h1>

          <p class="text-xl sm:text-2xl text-white/90 mb-12 font-light">
            Je aanvraag is goedgekeurd. Je bent nu officieel lid van<br />
            <strong class="font-semibold">Gemengd Koor Animato</strong>.
          </p>

          {/* Wat-kan-je-nu kaartjes */}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12 text-left">
            <div class="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5 hover:bg-white/15 transition">
              <div class="flex items-start gap-3">
                <i class="fas fa-calendar-alt text-animato-accent text-2xl mt-1"></i>
                <div>
                  <h3 class="text-white font-semibold mb-1">Repetities & concerten</h3>
                  <p class="text-white/70 text-sm">Bekijk de volledige koor-agenda en geef je aanwezigheid door.</p>
                </div>
              </div>
            </div>
            <div class="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5 hover:bg-white/15 transition">
              <div class="flex items-start gap-3">
                <i class="fas fa-users text-animato-accent text-2xl mt-1"></i>
                <div>
                  <h3 class="text-white font-semibold mb-1">Smoelenboek</h3>
                  <p class="text-white/70 text-sm">Maak kennis met je nieuwe koorgenoten.</p>
                </div>
              </div>
            </div>
            <div class="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5 hover:bg-white/15 transition">
              <div class="flex items-start gap-3">
                <i class="fas fa-user-circle text-animato-accent text-2xl mt-1"></i>
                <div>
                  <h3 class="text-white font-semibold mb-1">Jouw profiel</h3>
                  <p class="text-white/70 text-sm">Vul je gegevens aan zodat we je beter leren kennen.</p>
                </div>
              </div>
            </div>
            <div class="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5 hover:bg-white/15 transition">
              <div class="flex items-start gap-3">
                <i class="fas fa-music text-animato-accent text-2xl mt-1"></i>
                <div>
                  <h3 class="text-white font-semibold mb-1">Partituren & opnames</h3>
                  <p class="text-white/70 text-sm">Toegang tot al het muzikale materiaal voor je stem.</p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <a
            href="/leden"
            class="inline-flex items-center gap-3 bg-animato-accent hover:bg-yellow-500 text-white text-lg font-semibold px-8 py-4 rounded-xl shadow-2xl hover:shadow-yellow-500/30 hover:scale-105 transition-all"
          >
            Aan de slag
            <i class="fas fa-arrow-right"></i>
          </a>

          <p class="text-white/60 text-sm mt-8 italic">
            Welkom thuis. Wij kijken er naar uit om samen muziek te maken.
          </p>
        </div>
      </div>

      {/* Custom animatie voor het bouncen */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-15px); }
          }
          .animate-bounce-slow {
            animation: bounce-slow 2.5s ease-in-out infinite;
          }
        `
      }} />

      {/* Confetti script \u2014 meerdere bursts voor een echt feestelijke opening */}
      <script dangerouslySetInnerHTML={{
        __html: `
          (function() {
            if (typeof confetti === 'undefined') return;

            // Burst 1 \u2014 vanuit links, meteen bij paginalaad
            const fireFromSide = (angle, originX) => {
              confetti({
                particleCount: 80,
                angle: angle,
                spread: 65,
                origin: { x: originX, y: 0.6 },
                colors: ['#00A9CE', '#1B4D5C', '#F59E0B', '#FFFFFF', '#FFD700'],
                startVelocity: 55,
                ticks: 200,
              });
            };

            // Centrale burst, groot
            const centerBurst = () => {
              confetti({
                particleCount: 150,
                spread: 100,
                origin: { y: 0.5 },
                colors: ['#00A9CE', '#1B4D5C', '#F59E0B', '#FFFFFF', '#FFD700'],
                startVelocity: 50,
              });
            };

            // Fire in sequence voor een echt fancy gevoel
            setTimeout(() => fireFromSide(60, 0.1), 100);
            setTimeout(() => fireFromSide(120, 0.9), 250);
            setTimeout(centerBurst, 600);
            setTimeout(() => fireFromSide(60, 0.1), 1200);
            setTimeout(() => fireFromSide(120, 0.9), 1400);

            // Subtiele continuous fall \u2014 14 seconden lang
            const duration = 14 * 1000;
            const animationEnd = Date.now() + duration;
            const interval = setInterval(() => {
              const timeLeft = animationEnd - Date.now();
              if (timeLeft <= 0) return clearInterval(interval);
              const particleCount = 3;
              confetti({
                particleCount,
                startVelocity: 0,
                ticks: 250,
                origin: { x: Math.random(), y: 0 },
                colors: ['#00A9CE', '#F59E0B', '#FFD700', '#FFFFFF'],
                gravity: 0.4,
                scalar: 0.9,
              });
            }, 200);
          })();
        `
      }} />
    </Layout>
  )
})

export default app
