// Public routes - Home, Over ons, Nieuws, etc.
// Toegankelijk voor iedereen (geen auth vereist)

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { Layout } from '../components/Layout'
import { optionalAuth } from '../middleware/auth'
import { queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply optional auth to all public routes
app.use('*', optionalAuth)

// =====================================================
// HOMEPAGE
// =====================================================

app.get('/', async (c) => {
  const user = c.get('user')

  // Fetch laatste nieuws (top 3)
  const nieuws = await queryAll(
    c.env.DB,
    `SELECT id, titel, slug, excerpt, published_at 
     FROM posts 
     WHERE type = 'nieuws' AND is_published = 1 AND zichtbaarheid = 'publiek'
     ORDER BY published_at DESC 
     LIMIT 3`
  )

  // Fetch aankomende concerten
  const concerten = await queryAll(
    c.env.DB,
    `SELECT e.id, e.titel, e.slug, e.start_at, e.locatie, c.poster_url
     FROM events e
     LEFT JOIN concerts c ON c.event_id = e.id
     WHERE e.type = 'concert' AND e.is_publiek = 1 AND e.start_at > datetime('now')
     ORDER BY e.start_at ASC
     LIMIT 3`
  )

  return c.html(
    <Layout title="Home" user={user} currentPath="/">
      {/* Hero Section with Full-Width Video Background */}
      <section class="relative overflow-hidden text-white" style="height: 600px;">
        {/* YouTube Video Background - Full Width */}
        <div class="absolute inset-0 w-full h-full">
          <iframe
            src="https://www.youtube.com/embed/oXLw5RC0lNo?autoplay=1&mute=1&loop=1&playlist=oXLw5RC0lNo&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1"
            title="Gemengd Koor Animato"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            class="absolute top-1/2 left-1/2 w-full h-full object-cover"
            style="transform: translate(-50%, -50%); min-width: 100%; min-height: 100%; pointer-events: none;"
          ></iframe>
        </div>
        
        {/* Dark overlay for better text readability */}
        <div class="absolute inset-0 bg-black opacity-50"></div>
        
        {/* Content overlay */}
        <div class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-center">
          <div class="text-center">
            <h1 class="text-5xl md:text-6xl font-bold mb-6 drop-shadow-lg" style="font-family: 'Playfair Display', serif;">
              Gemengd Koor Animato
            </h1>
            <p class="text-xl md:text-2xl mb-8 text-gray-100 drop-shadow-lg">
              Koor met passie • Samen musiceren sinds 1985
            </p>
            <div class="flex flex-col sm:flex-row justify-center gap-4">
              <a 
                href="/word-lid" 
                class="bg-animato-accent hover:bg-yellow-600 text-white px-8 py-4 rounded-lg font-semibold text-lg transition shadow-lg"
              >
                <i class="fas fa-user-plus mr-2"></i>
                Word Lid
              </a>
              <a 
                href="/concerten" 
                class="bg-white text-animato-primary hover:bg-gray-100 px-8 py-4 rounded-lg font-semibold text-lg transition shadow-lg"
              >
                <i class="fas fa-ticket-alt mr-2"></i>
                Bekijk Concerten
              </a>
            </div>
          </div>
        </div>
        
        {/* Decorative wave */}
        <div class="absolute bottom-0 left-0 right-0 z-10">
          <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,50 Q360,0 720,50 T1440,50 L1440,100 L0,100 Z" fill="#F9FAFB"/>
          </svg>
        </div>
      </section>

      {/* Over Ons - Kort */}
      <section class="py-16 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 class="text-4xl font-bold text-animato-secondary mb-6" style="font-family: 'Playfair Display', serif;">
                Over Ons
              </h2>
              <p class="text-gray-700 text-lg mb-4">
                Gemengd Koor Animato is een dynamisch koor dat al sinds 1985 het Vlaamse muzieklandschap verrijkt met passie en vakmanschap.
              </p>
              <p class="text-gray-700 text-lg mb-6">
                Ons repertoire varieert van klassieke meesterwerken tot moderne composities, altijd met respect voor de muziek en plezier in het samen musiceren.
              </p>
              <a 
                href="/koor" 
                class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold transition"
              >
                Lees meer over ons koor
                <i class="fas fa-arrow-right ml-2"></i>
              </a>
            </div>
            <div class="relative">
              <div class="aspect-video bg-gray-200 rounded-lg shadow-xl overflow-hidden">
                {/* Placeholder voor koor foto */}
                <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary">
                  <i class="fas fa-users text-white text-6xl opacity-50"></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Aankomende Concerten */}
      <section class="py-16 bg-white">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="text-center mb-12">
            <h2 class="text-4xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Aankomende Concerten
            </h2>
            <p class="text-gray-600 text-lg">
              Ontdek onze volgende optredens en bestel uw tickets
            </p>
          </div>

          {concerten.length > 0 ? (
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
              {concerten.map((concert: any) => (
                <a 
                  href={`/concerten/${concert.slug}`} 
                  class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden"
                >
                  <div class="aspect-video bg-gray-200 overflow-hidden">
                    {concert.poster_url ? (
                      <img src={concert.poster_url} alt={concert.titel} class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-animato-primary to-animato-secondary">
                        <i class="fas fa-music text-white text-4xl"></i>
                      </div>
                    )}
                  </div>
                  <div class="p-6">
                    <h3 class="text-xl font-bold text-gray-900 mb-2 group-hover:text-animato-primary transition">
                      {concert.titel}
                    </h3>
                    <div class="text-gray-600 text-sm space-y-1">
                      <div>
                        <i class="fas fa-calendar mr-2 text-animato-primary"></i>
                        {new Date(concert.start_at).toLocaleDateString('nl-BE', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </div>
                      <div>
                        <i class="fas fa-map-marker-alt mr-2 text-animato-primary"></i>
                        {concert.locatie}
                      </div>
                    </div>
                    <div class="mt-4">
                      <span class="inline-flex items-center text-animato-primary font-semibold group-hover:underline">
                        Tickets & Info
                        <i class="fas fa-arrow-right ml-2"></i>
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div class="text-center py-12 text-gray-500">
              <i class="fas fa-calendar-times text-5xl mb-4 text-gray-300"></i>
              <p class="text-lg">Momenteel geen aankomende concerten gepland.</p>
              <p class="text-sm mt-2">Check binnenkort opnieuw voor updates!</p>
            </div>
          )}

          {concerten.length > 0 && (
            <div class="text-center mt-12">
              <a 
                href="/concerten" 
                class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold text-lg transition"
              >
                Bekijk alle concerten
                <i class="fas fa-arrow-right ml-2"></i>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Laatste Nieuws */}
      <section class="py-16 bg-gray-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="text-center mb-12">
            <h2 class="text-4xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Laatste Nieuws
            </h2>
            <p class="text-gray-600 text-lg">
              Blijf op de hoogte van onze activiteiten
            </p>
          </div>

          {nieuws.length > 0 ? (
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
              {nieuws.map((item: any) => (
                <a 
                  href={`/nieuws/${item.slug}`} 
                  class="group bg-white rounded-lg shadow-md hover:shadow-xl transition p-6"
                >
                  <div class="text-animato-primary text-sm font-semibold mb-2">
                    {new Date(item.published_at).toLocaleDateString('nl-BE')}
                  </div>
                  <h3 class="text-xl font-bold text-gray-900 mb-3 group-hover:text-animato-primary transition">
                    {item.titel}
                  </h3>
                  <p class="text-gray-600 mb-4 line-clamp-3">
                    {item.excerpt || 'Lees meer...'}
                  </p>
                  <span class="inline-flex items-center text-animato-primary font-semibold group-hover:underline">
                    Lees meer
                    <i class="fas fa-arrow-right ml-2"></i>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div class="text-center py-12 text-gray-500">
              <i class="fas fa-newspaper text-5xl mb-4 text-gray-300"></i>
              <p class="text-lg">Nog geen nieuwsberichten beschikbaar.</p>
            </div>
          )}

          {nieuws.length > 0 && (
            <div class="text-center mt-12">
              <a 
                href="/nieuws" 
                class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold text-lg transition"
              >
                Bekijk al het nieuws
                <i class="fas fa-arrow-right ml-2"></i>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Call to Action - Word Lid */}
      <section class="py-16 bg-gradient-to-r from-animato-primary to-animato-secondary text-white">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 class="text-4xl font-bold mb-6" style="font-family: 'Playfair Display', serif;">
            Hou je van zingen?
          </h2>
          <p class="text-xl mb-8 text-gray-100 max-w-2xl mx-auto">
            Word lid van Gemengd Koor Animato en ontdek de vreugde van samen musiceren. Alle stemgroepen (SATB) zijn welkom!
          </p>
          <a 
            href="/word-lid" 
            class="inline-block bg-animato-accent hover:bg-yellow-600 text-white px-10 py-4 rounded-lg font-bold text-lg transition shadow-lg"
          >
            <i class="fas fa-user-plus mr-2"></i>
            Word Lid
          </a>
        </div>
      </section>
    </Layout>
  )
})

// =====================================================
// OVER ONS / KOOR
// =====================================================

app.get('/koor', async (c) => {
  const user = c.get('user')

  return c.html(
    <Layout title="Over Ons" user={user} currentPath="/koor">
      <div class="py-16">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-5xl font-bold text-animato-secondary mb-8" style="font-family: 'Playfair Display', serif;">
            Over Gemengd Koor Animato
          </h1>
          
          <div class="prose prose-lg max-w-none">
            <p class="text-xl text-gray-700 mb-6 leading-relaxed">
              Sinds 1985 brengt Gemengd Koor Animato muziek tot leven met passie, vakmanschap en toewijding. Ons koor bestaat uit ongeveer 40 enthousiaste zangers en zangeressen die wekelijks samenkomen om te repeteren en te groeien als muzikaal ensemble.
            </p>

            <h2 class="text-3xl font-bold text-animato-secondary mt-12 mb-6">Onze Missie</h2>
            <p class="text-gray-700 mb-4">
              Bij Animato geloven we in de kracht van samen musiceren. Onze missie is om hoogwaardige koormuziek te brengen, van klassieke meesterwerken tot moderne composities, en om tegelijkertijd een warme, inclusieve gemeenschap te creëren waar iedereen welkom is.
            </p>

            <h2 class="text-3xl font-bold text-animato-secondary mt-12 mb-6">Repertoire</h2>
            <p class="text-gray-700 mb-4">
              Ons repertoire is veelzijdig en uitdagend. We brengen werken van componisten zoals Mozart, Fauré, Rutter, Poulenc en vele anderen. Van renaissance-polyfonie tot hedendaagse muziek, van geestelijke muziek tot wereldlijke liederen - onze programmering is altijd verrassend en boeiend.
            </p>

            <h2 class="text-3xl font-bold text-animato-secondary mt-12 mb-6">Dirigent & Begeleiding</h2>
            <p class="text-gray-700 mb-4">
              Onder de bezielende leiding van onze dirigent en met ondersteuning van professionele muzikanten, werken we aan een verfijnde koorklank en muzikale expressie. Regelmatige stemgroeprepeties en workshops zorgen voor continue groei en ontwikkeling.
            </p>

            <h2 class="text-3xl font-bold text-animato-secondary mt-12 mb-6">Concerten & Optredens</h2>
            <p class="text-gray-700 mb-4">
              Jaarlijks verzorgen we meerdere concerten in prachtige locaties. Van intieme kerkConcerten tot grootse uitvoeringen in concertzalen, elk optreden is een feest voor koor en publiek.
            </p>
          </div>

          <div class="mt-12 bg-animato-primary bg-opacity-10 p-8 rounded-lg">
            <h3 class="text-2xl font-bold text-animato-secondary mb-4">
              Interesse om mee te zingen?
            </h3>
            <p class="text-gray-700 mb-6">
              We zijn altijd op zoek naar nieuwe leden in alle stemgroepen (Sopraan, Alt, Tenor, Bas). Geen audities vereist, gewoon passie voor zingen!
            </p>
            <a 
              href="/word-lid" 
              class="inline-block bg-animato-accent hover:bg-yellow-600 text-white px-8 py-3 rounded-lg font-semibold transition"
            >
              Word Lid
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// CONTACT
// =====================================================

app.get('/contact', async (c) => {
  const user = c.get('user')

  return c.html(
    <Layout title="Contact" user={user} currentPath="/contact">
      <div class="py-16">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-5xl font-bold text-animato-secondary mb-8" style="font-family: 'Playfair Display', serif;">
            Contact
          </h1>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div>
              <h2 class="text-2xl font-bold text-gray-900 mb-6">Contactgegevens</h2>
              
              <div class="space-y-6">
                <div class="flex items-start">
                  <div class="flex-shrink-0">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center">
                      <i class="fas fa-envelope text-animato-primary text-xl"></i>
                    </div>
                  </div>
                  <div class="ml-4">
                    <h3 class="font-semibold text-gray-900">Email</h3>
                    <a href="mailto:info@animato.be" class="text-animato-primary hover:underline">
                      info@animato.be
                    </a>
                  </div>
                </div>

                <div class="flex items-start">
                  <div class="flex-shrink-0">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center">
                      <i class="fas fa-phone text-animato-primary text-xl"></i>
                    </div>
                  </div>
                  <div class="ml-4">
                    <h3 class="font-semibold text-gray-900">Telefoon</h3>
                    <a href="tel:+32470123456" class="text-animato-primary hover:underline">
                      +32 470 12 34 56
                    </a>
                  </div>
                </div>

                <div class="flex items-start">
                  <div class="flex-shrink-0">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center">
                      <i class="fas fa-map-marker-alt text-animato-primary text-xl"></i>
                    </div>
                  </div>
                  <div class="ml-4">
                    <h3 class="font-semibold text-gray-900">Adres</h3>
                    <p class="text-gray-600">
                      Koorstraat 1<br />
                      1000 Brussel<br />
                      België
                    </p>
                  </div>
                </div>
              </div>

              <div class="mt-8">
                <h3 class="font-semibold text-gray-900 mb-4">Volg ons op social media</h3>
                <div class="flex space-x-4">
                  <a href="#" class="w-12 h-12 bg-animato-primary text-white rounded-lg flex items-center justify-center hover:bg-animato-secondary transition">
                    <i class="fab fa-facebook text-xl"></i>
                  </a>
                  <a href="#" class="w-12 h-12 bg-animato-primary text-white rounded-lg flex items-center justify-center hover:bg-animato-secondary transition">
                    <i class="fab fa-instagram text-xl"></i>
                  </a>
                  <a href="#" class="w-12 h-12 bg-animato-primary text-white rounded-lg flex items-center justify-center hover:bg-animato-secondary transition">
                    <i class="fab fa-youtube text-xl"></i>
                  </a>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <h2 class="text-2xl font-bold text-gray-900 mb-6">Stuur ons een bericht</h2>
              <form action="/api/contact" method="POST" class="space-y-4">
                <div>
                  <label for="naam" class="block text-sm font-medium text-gray-700 mb-1">
                    Naam *
                  </label>
                  <input 
                    type="text" 
                    id="naam" 
                    name="naam" 
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input 
                    type="email" 
                    id="email" 
                    name="email" 
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="onderwerp" class="block text-sm font-medium text-gray-700 mb-1">
                    Onderwerp *
                  </label>
                  <input 
                    type="text" 
                    id="onderwerp" 
                    name="onderwerp" 
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="bericht" class="block text-sm font-medium text-gray-700 mb-1">
                    Bericht *
                  </label>
                  <textarea 
                    id="bericht" 
                    name="bericht" 
                    rows={6}
                    required
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  ></textarea>
                </div>

                <div class="flex items-start">
                  <input 
                    type="checkbox" 
                    id="consent" 
                    name="consent" 
                    required
                    class="mt-1 h-4 w-4 text-animato-primary focus:ring-animato-primary border-gray-300 rounded"
                  />
                  <label for="consent" class="ml-2 text-sm text-gray-600">
                    Ik ga akkoord met de verwerking van mijn gegevens volgens de <a href="/privacy" class="text-animato-primary hover:underline">privacyverklaring</a>.
                  </label>
                </div>

                <button 
                  type="submit"
                  class="w-full bg-animato-primary hover:bg-animato-secondary text-white px-6 py-3 rounded-lg font-semibold transition"
                >
                  <i class="fas fa-paper-plane mr-2"></i>
                  Verstuur Bericht
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
