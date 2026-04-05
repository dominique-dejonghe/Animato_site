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

  // JSON-LD structured data for GEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    "name": "Gemengd Koor Animato",
    "url": "https://animato.be",
    "logo": "https://animato.be/static/logo.png",
    "image": "https://animato.be/static/cover.jpg",
    "description": "Een dynamisch gemengd koor uit Brussel dat klassieke meesterwerken en moderne composities brengt.",
    "foundingDate": "1985",
    "location": {
      "@type": "Place",
      "name": "Koorstraat 1",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Koorstraat 1",
        "addressLocality": "Brussel",
        "postalCode": "1000",
        "addressCountry": "BE"
      }
    },
    "genre": ["Classical", "Contemporary", "Choral"],
    "knowsAbout": "Choral Music",
    "sameAs": [
      "https://www.facebook.com/GemengdkoorAnimato",
      "https://www.youtube.com/@GemengdkoorAnimato"
    ],
    "event": concerten.map((concert: any) => ({
      "@type": "MusicEvent",
      "name": concert.titel,
      "startDate": new Date(concert.start_at).toISOString(),
      "location": {
        "@type": "Place",
        "name": concert.locatie,
        "address": concert.locatie
      },
      "image": concert.poster_url || "https://animato.be/static/default-concert.jpg",
      "description": `Concert van Gemengd Koor Animato: ${concert.titel}`,
      "performer": {
        "@type": "MusicGroup",
        "name": "Gemengd Koor Animato"
      },
      "offers": {
        "@type": "Offer",
        "url": `https://animato.be/concerten/${concert.slug}`,
        "availability": "https://schema.org/InStock"
      }
    }))
  }

  return c.html(
    <Layout title="Home" user={user} currentPath="/">
      {/* Inject JSON-LD */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero Section with Full-Width Video Background */}
      <section class="relative overflow-hidden text-white" style="height: 600px;">
        {/* YouTube Video Background - Full Width - Starts at 20 seconds */}
        <div class="absolute inset-0 w-full h-full overflow-hidden">
          <iframe
            src="https://www.youtube.com/embed/oXLw5RC0lNo?autoplay=1&mute=1&loop=1&playlist=oXLw5RC0lNo&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&start=20"
            title="Gemengd Koor Animato"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            style="position: absolute; top: 50%; left: 50%; width: 100vw; height: 56.25vw; min-height: 100%; min-width: 177.77vh; transform: translate(-50%, -50%); pointer-events: none;"
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
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
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
            <div class={`grid gap-8 justify-items-center ${
              concerten.length === 1
                ? 'grid-cols-1 max-w-sm mx-auto'
                : concerten.length === 2
                  ? 'grid-cols-1 md:grid-cols-2 max-w-2xl mx-auto'
                  : 'grid-cols-1 md:grid-cols-3'
            }`}>
              {concerten.map((concert: any) => (
                <a 
                  href={`/concerten/${concert.slug}`} 
                  class="group bg-white rounded-lg shadow-md hover:shadow-xl transition overflow-hidden w-full"
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
                        {concert.uitverkocht ? 'Meer info' : 'Meer info & Tickets'}
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
                  {item.excerpt && (
                    <p class="text-gray-600 mb-4 line-clamp-3">
                      {item.excerpt}
                    </p>
                  )}
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

      {/* FAQ Section - GEO Optimized for LLMs */}
      <section class="py-16 bg-white">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="text-center mb-12">
            <h2 class="text-3xl font-bold text-animato-secondary mb-4" style="font-family: 'Playfair Display', serif;">
              Veelgestelde Vragen
            </h2>
            <p class="text-gray-600">
              Antwoorden op vragen die vaak gesteld worden over ons koor
            </p>
          </div>
          
          <div class="space-y-6">
            <details class="group bg-gray-50 rounded-lg p-6 [&_summary::-webkit-details-marker]:hidden">
              <summary class="flex cursor-pointer items-center justify-between gap-1.5 text-gray-900">
                <h3 class="font-medium text-lg font-bold">Wanneer repeteert Gemengd Koor Animato?</h3>
                <span class="shrink-0 rounded-full bg-white p-1.5 text-gray-900 sm:p-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-5 shrink-0 transition duration-300 group-open:-rotate-180" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </span>
              </summary>
              <p class="mt-4 leading-relaxed text-gray-700">
                Wij repeteren elke woensdagavond van 19:30 tot 21:30 uur. Onze repetities vinden plaats in Zaal De Sopper, Oppuursdorp 15, 2890 Oppuurs. We verwachten een regelmatig engagement, maar begrijpen dat werk of privé soms voorrang heeft.
              </p>
            </details>

            <details class="group bg-gray-50 rounded-lg p-6 [&_summary::-webkit-details-marker]:hidden">
              <summary class="flex cursor-pointer items-center justify-between gap-1.5 text-gray-900">
                <h3 class="font-medium text-lg font-bold">Moet ik auditie doen om lid te worden?</h3>
                <span class="shrink-0 rounded-full bg-white p-1.5 text-gray-900 sm:p-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-5 shrink-0 transition duration-300 group-open:-rotate-180" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </span>
              </summary>
              <p class="mt-4 leading-relaxed text-gray-700">
                Nee, bij Animato doen we geen strenge audities. Iedereen met een passie voor zingen en een basisgevoel voor muziek is welkom. Je mag 3 keer vrijblijvend meerepeteren als proeflid om te zien of het klikt. Wel doen we graag een kleine stemtest om te bepalen welke stemgroep (Sopraan, Alt, Tenor, Bas) het beste bij je past.
              </p>
            </details>

            <details class="group bg-gray-50 rounded-lg p-6 [&_summary::-webkit-details-marker]:hidden">
              <summary class="flex cursor-pointer items-center justify-between gap-1.5 text-gray-900">
                <h3 class="font-medium text-lg font-bold">Wat voor muziek zingt Animato?</h3>
                <span class="shrink-0 rounded-full bg-white p-1.5 text-gray-900 sm:p-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-5 shrink-0 transition duration-300 group-open:-rotate-180" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </span>
              </summary>
              <p class="mt-4 leading-relaxed text-gray-700">
                Ons repertoire is zeer gevarieerd ("gemengd"). We zingen zowel klassieke koorwerken (Mozart, Fauré, Bach) als hedendaagse composities, musical-nummers en wereldmuziek. We proberen elk seizoen een nieuw thema of project uit te werken.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* Steun Ons Banner */}
      <section class="py-14 bg-red-600">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex flex-col md:flex-row items-center justify-between gap-8">
            <div class="flex items-center gap-6 text-white">
              <div class="bg-white bg-opacity-20 p-4 rounded-full shrink-0">
                <i class="fas fa-heart text-3xl"></i>
              </div>
              <div>
                <h2 class="text-3xl font-bold mb-1" style="font-family: 'Playfair Display', serif;">
                  Steun Animato
                </h2>
                <p class="text-red-100 text-lg max-w-xl">
                  Jouw vrije gift maakt prachtige concerten, educatieve projecten en muzikale groei mogelijk. Elk bedrag telt.
                </p>
              </div>
            </div>
            <a
              href="/steun-ons"
              class="shrink-0 bg-white text-red-600 px-10 py-4 rounded-lg font-bold text-lg hover:bg-red-50 transition shadow-lg hover:shadow-xl whitespace-nowrap"
            >
              <i class="fas fa-hand-holding-heart mr-2"></i>
              Doe een gift
            </a>
          </div>
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
          
          {/* CTA Buttons */}
          <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a 
              href="/stem-test" 
              class="inline-block bg-white hover:bg-gray-100 text-animato-primary px-10 py-4 rounded-lg font-bold text-lg transition shadow-lg hover:shadow-2xl group"
            >
              <i class="fas fa-microphone mr-2 animate-mic-vibrate group-hover:animate-mic-pulse"></i>
              Test Je Stem
            </a>
            <a 
              href="/word-lid" 
              class="inline-block bg-animato-accent hover:bg-yellow-600 text-white px-10 py-4 rounded-lg font-bold text-lg transition shadow-lg hover:shadow-2xl"
            >
              <i class="fas fa-user-plus mr-2"></i>
              Word Lid
            </a>
          </div>
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
// WORD LID
// =====================================================

app.get('/word-lid', async (c) => {
  const user = c.get('user')
  const success = c.req.query('success')
  const error = c.req.query('error')

  return c.html(
    <Layout title="Word Lid" user={user} currentPath="/word-lid">
      <div class="py-16">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-5xl font-bold text-animato-secondary mb-8" style="font-family: 'Playfair Display', serif;">
            Word Lid van Gemengd Koor Animato
          </h1>

          {/* Success/Error Messages */}
          {success && (
            <div class="mb-8 bg-green-50 border border-green-200 rounded-lg p-6 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 text-2xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-bold text-green-800">Bedankt voor je interesse!</h3>
                  <p class="text-green-700">Je aanvraag is goed ontvangen. We nemen zo snel mogelijk contact met je op.</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-8 bg-red-50 border border-red-200 rounded-lg p-6 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 text-2xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-bold text-red-800">Er ging iets mis</h3>
                  <p class="text-red-700">
                    {error === 'duplicate' ? 'Je hebt al een aanvraag ingediend.' : 
                     error === 'email_exists' ? 'Dit email adres is al bekend.' :
                     'Controleer of alle velden correct zijn ingevuld.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Hero Text */}
          <div class="bg-gradient-to-br from-animato-primary to-animato-secondary text-white p-8 rounded-lg mb-12">
            <h2 class="text-3xl font-bold mb-4">Zing jij graag?</h2>
            <p class="text-xl text-gray-100">
              Dan ben je van harte welkom bij Gemengd Koor Animato! We zijn altijd op zoek naar enthousiaste zangers en zangeressen die graag samen muziek maken.
            </p>
          </div>

          {/* Wat We Zoeken */}
          <div class="mb-12">
            <h2 class="text-3xl font-bold text-animato-secondary mb-6">Wat we zoeken</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-animato-primary">
                <div class="flex items-center mb-3">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-3">
                    <i class="fas fa-music text-animato-primary"></i>
                  </div>
                  <h3 class="text-xl font-semibold">🎵 Sopraan</h3>
                </div>
                <p class="text-gray-700">Hoge vrouwenstem - we zoeken enthousiaste sopranen!</p>
              </div>

              <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-animato-primary">
                <div class="flex items-center mb-3">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-3">
                    <i class="fas fa-music text-animato-primary"></i>
                  </div>
                  <h3 class="text-xl font-semibold">🎵 Alt</h3>
                </div>
                <p class="text-gray-700">Lage vrouwenstem - altijd welkom in ons koor!</p>
              </div>

              <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-animato-primary">
                <div class="flex items-center mb-3">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-3">
                    <i class="fas fa-music text-animato-primary"></i>
                  </div>
                  <h3 class="text-xl font-semibold">🎵 Tenor</h3>
                </div>
                <p class="text-gray-700">Hoge mannenstem - kom ons team versterken!</p>
              </div>

              <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-animato-primary">
                <div class="flex items-center mb-3">
                  <div class="w-10 h-10 bg-animato-primary bg-opacity-10 rounded-full flex items-center justify-center mr-3">
                    <i class="fas fa-music text-animato-primary"></i>
                  </div>
                  <h3 class="text-xl font-semibold">🎵 Bas</h3>
                </div>
                <p class="text-gray-700">Lage mannenstem - de fundering van ons koor!</p>
              </div>
            </div>
          </div>

          {/* Wat Je Moet Weten */}
          <div class="mb-12">
            <h2 class="text-3xl font-bold text-animato-secondary mb-6">Wat je moet weten</h2>
            <div class="bg-gray-50 p-8 rounded-lg">
              <ul class="space-y-4">
                <li class="flex items-start">
                  <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                  <span class="text-gray-700"><strong>Geen audities:</strong> We geloven dat iedereen die graag zingt welkom is!</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                  <span class="text-gray-700"><strong>Proeflid periode:</strong> Je kunt 3 repetities meedoen om te kijken of het bij je past</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                  <span class="text-gray-700"><strong>Wekelijkse repetities:</strong> Elke woensdag van 19:30 tot 21:30 uur</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                  <span class="text-gray-700"><strong>Geen muzieknotenlezen vereist:</strong> We leren je alles wat je moet weten</span>
                </li>
                <li class="flex items-start">
                  <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                  <span class="text-gray-700"><strong>Gezellige sfeer:</strong> Muziek maken én sociale contacten</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Contact Form */}
          <div class="bg-white p-8 rounded-lg shadow-lg">
            <h2 class="text-3xl font-bold text-animato-secondary mb-6">Interesse? Neem contact op!</h2>
            <p class="text-gray-700 mb-8">
              Vul onderstaand formulier in en we nemen zo snel mogelijk contact met je op om een kennismaking te plannen.
            </p>

            <form method="POST" action="/api/word-lid" class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label for="voornaam" class="block text-sm font-semibold text-gray-700 mb-2">
                    Voornaam *
                  </label>
                  <input
                    type="text"
                    id="voornaam"
                    name="voornaam"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label for="achternaam" class="block text-sm font-semibold text-gray-700 mb-2">
                    Achternaam *
                  </label>
                  <input
                    type="text"
                    id="achternaam"
                    name="achternaam"
                    required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label for="email" class="block text-sm font-semibold text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="telefoon" class="block text-sm font-semibold text-gray-700 mb-2">
                  Telefoon
                </label>
                <input
                  type="tel"
                  id="telefoon"
                  name="telefoon"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                />
              </div>

              <div>
                <label for="stemgroep" class="block text-sm font-semibold text-gray-700 mb-2">
                  Stemgroep *
                </label>
                <select
                  id="stemgroep"
                  name="stemgroep"
                  required
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                >
                  <option value="">Kies je stemgroep...</option>
                  <option value="S">Sopraan (hoge vrouwenstem)</option>
                  <option value="A">Alt (lage vrouwenstem)</option>
                  <option value="T">Tenor (hoge mannenstem)</option>
                  <option value="B">Bas (lage mannenstem)</option>
                  <option value="weet_niet">Weet ik niet zeker</option>
                </select>
              </div>

              <div>
                <label for="muzikale_ervaring" class="block text-sm font-semibold text-gray-700 mb-2">
                  Muzikale ervaring
                </label>
                <textarea
                  id="muzikale_ervaring"
                  name="muzikale_ervaring"
                  rows="4"
                  placeholder="Vertel ons over je muzikale achtergrond (bijvoorbeeld: eerder in een koor gezongen, instrumenten bespeeld, zanglessen gevolgd, etc.)"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                ></textarea>
              </div>

              <div>
                <label for="motivatie" class="block text-sm font-semibold text-gray-700 mb-2">
                  Bericht / Vragen
                </label>
                <textarea
                  id="motivatie"
                  name="motivatie"
                  rows="4"
                  placeholder="Heb je nog vragen? Laat het ons weten!"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
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
                  Ik ga akkoord met de verwerking van mijn gegevens volgens de <a href="/privacyverklaring" class="text-animato-primary hover:underline">privacyverklaring</a>.
                </label>
              </div>

              <button
                type="submit"
                class="w-full bg-animato-accent hover:bg-yellow-600 text-white px-8 py-4 rounded-lg font-bold text-lg transition shadow-lg"
              >
                <i class="fas fa-paper-plane mr-2"></i>
                Verstuur Aanmelding
              </button>
            </form>
          </div>

          {/* Alternative Contact */}
          <div class="mt-12 text-center">
            <p class="text-gray-700 mb-4">
              Of neem direct contact met ons op:
            </p>
            <div class="flex flex-col sm:flex-row justify-center gap-4">
              <a href="mailto:info@animato.be" class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold">
                <i class="fas fa-envelope mr-2"></i>
                info@animato.be
              </a>
              <a href="tel:+32470123456" class="inline-flex items-center text-animato-primary hover:text-animato-secondary font-semibold">
                <i class="fas fa-phone mr-2"></i>
                +32 470 12 34 56
              </a>
            </div>
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
  const success = c.req.query('success')
  const error = c.req.query('error')

  return c.html(
    <Layout title="Contact" user={user} currentPath="/contact">
      <div class="py-16">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-5xl font-bold text-animato-secondary mb-8" style="font-family: 'Playfair Display', serif;">
            Contact
          </h1>

          {/* Success/Error Messages */}
          {success && (
            <div class="mb-8 bg-green-50 border border-green-200 rounded-lg p-6 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-check-circle text-green-500 text-2xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-bold text-green-800">Bericht verzonden!</h3>
                  <p class="text-green-700">Bedankt voor je bericht. We nemen zo snel mogelijk contact met je op.</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div class="mb-8 bg-red-50 border border-red-200 rounded-lg p-6 animate-fade-in">
              <div class="flex items-center">
                <i class="fas fa-exclamation-circle text-red-500 text-2xl mr-4"></i>
                <div>
                  <h3 class="text-lg font-bold text-red-800">Er ging iets mis</h3>
                  <p class="text-red-700">
                    Controleer of alle velden correct zijn ingevuld en probeer het opnieuw.
                  </p>
                </div>
              </div>
            </div>
          )}

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
                    <a href="mailto:gemengdkooranimato@gmail.com" class="text-animato-primary hover:underline">
                      gemengdkooranimato@gmail.com
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
                      Zaal De Sopper<br />
                      Oppuursdorp 15<br />
                      2890 Oppuurs<br />
                      België
                    </p>
                  </div>
                </div>

                <div class="flex items-start">
                  <div class="flex-shrink-0">
                    <div class="w-12 h-12 bg-animato-primary bg-opacity-10 rounded-lg flex items-center justify-center">
                      <i class="fas fa-clock text-animato-primary text-xl"></i>
                    </div>
                  </div>
                  <div class="ml-4">
                    <h3 class="font-semibold text-gray-900">Repetities</h3>
                    <p class="text-gray-600">Elke woensdag van 19:30 tot 21:30 uur</p>
                  </div>
                </div>
              </div>

              <div class="mt-8">
                <h3 class="font-semibold text-gray-900 mb-4">Volg ons op social media</h3>
                <div class="flex space-x-4">
                  <a href="https://www.facebook.com/GemengdkoorAnimato" target="_blank" rel="noopener" class="w-12 h-12 bg-animato-primary text-white rounded-lg flex items-center justify-center hover:bg-animato-secondary transition">
                    <i class="fab fa-facebook text-xl"></i>
                  </a>
                  <a href="https://www.youtube.com/@GemengdkoorAnimato" target="_blank" rel="noopener" class="w-12 h-12 bg-animato-primary text-white rounded-lg flex items-center justify-center hover:bg-animato-secondary transition">
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
                    Ik ga akkoord met de verwerking van mijn gegevens volgens de <a href="/privacyverklaring" class="text-animato-primary hover:underline">privacyverklaring</a>.
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

          {/* Kaart - OpenStreetMap */}
          <div class="mt-16">
            <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
              <i class="fas fa-map-marker-alt text-animato-primary mr-3"></i>
              Vind Ons
            </h2>
            <div class="w-full h-80 rounded-lg overflow-hidden shadow-lg">
              <iframe
                src="https://www.openstreetmap.org/export/embed.html?bbox=4.2829,51.0500,4.3229,51.0700&layer=mapnik&marker=51.0600,4.3029"
                width="100%"
                height="100%"
                style="border:0;"
                loading="lazy"
                title="Zaal De Sopper, Oppuursdorp 15, 2890 Oppuurs"
              ></iframe>
            </div>
            <p class="mt-3 text-sm text-gray-600 text-center">
              <i class="fas fa-map-marker-alt text-animato-primary mr-1"></i>
              Zaal De Sopper, Oppuursdorp 15, 2890 Oppuurs
              &nbsp;·&nbsp;
              <a href="https://www.openstreetmap.org/search?query=Oppuursdorp+15+Oppuurs" target="_blank" rel="noopener" class="text-animato-primary hover:underline">Bekijk op kaart</a>
            </p>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// FOTOBOEK
// =====================================================

app.get('/fotoboek', async (c) => {
  const user = c.get('user')
  const year = c.req.query('year') || 'all'
  const visibility = c.req.query('visibility') || 'all'

  // Build query with filters
  let query = `
    SELECT a.*, 
           COUNT(p.id) as photo_count,
           strftime('%Y', a.created_at) as year
    FROM albums a
    LEFT JOIN photos p ON p.album_id = a.id
    WHERE 1=1
  `
  const params: any[] = []

  // Visibility filter - if not logged in, only show public
  if (!user) {
    query += ` AND a.is_publiek = 1`
  } else if (visibility === 'public') {
    query += ` AND a.is_publiek = 1`
  } else if (visibility === 'private') {
    query += ` AND a.is_publiek = 0`
  }
  // 'all' shows both if logged in

  query += ` GROUP BY a.id`

  // Get all albums first
  const allAlbums = await queryAll(c.env.DB, query, params)

  // Filter by year in JavaScript (since year is computed)
  let albums = allAlbums
  if (year !== 'all') {
    albums = allAlbums.filter((a: any) => a.year === year)
  }

  // Sort by date descending
  albums.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Get unique years for filter
  const years = [...new Set(allAlbums.map((a: any) => a.year))].sort().reverse()

  return c.html(
    <Layout title="Fotoboek" user={user} currentPath="/fotoboek">
      {/* Header */}
      <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white py-16">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-4xl md:text-5xl font-bold mb-4" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-images mr-3"></i>
            Fotoboek
          </h1>
          <p class="text-xl text-white/90">
            Bekijk onze mooiste momenten en herinneringen
          </p>
        </div>
      </div>

      {/* Filters */}
      <div class="bg-white border-b border-gray-200 sticky top-16 z-40">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div class="flex flex-wrap gap-4 items-center">
            {/* Year Filter */}
            <div class="flex items-center gap-2">
              <label class="text-sm font-medium text-gray-700">Jaar:</label>
              <select
                onchange={`window.location.href='/fotoboek?year=' + this.value + '&visibility=${visibility}'`}
                class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
              >
                <option value="all" selected={year === 'all'}>Alle jaren</option>
                {years.map((y: string) => (
                  <option value={y} selected={year === y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Visibility Filter - Only show if logged in */}
            {user && (
              <div class="flex items-center gap-2">
                <label class="text-sm font-medium text-gray-700">Zichtbaarheid:</label>
                <select
                  onchange={`window.location.href='/fotoboek?year=${year}&visibility=' + this.value`}
                  class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary"
                >
                  <option value="all" selected={visibility === 'all'}>Alles</option>
                  <option value="public" selected={visibility === 'public'}>Publiek</option>
                  <option value="private" selected={visibility === 'private'}>Alleen leden</option>
                </select>
              </div>
            )}

            {/* Stats */}
            <div class="ml-auto text-sm text-gray-600">
              <i class="fas fa-folder mr-1"></i>
              {albums.length} album(s)
            </div>
          </div>
        </div>
      </div>

      {/* Albums Grid */}
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {albums.length === 0 ? (
          <div class="text-center py-16">
            <i class="fas fa-images text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-600 mb-2">Geen albums gevonden</h3>
            <p class="text-gray-500">
              {year !== 'all' ? `Geen albums gevonden voor ${year}` : 'Er zijn nog geen foto albums beschikbaar'}
            </p>
          </div>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {albums.map((album: any) => (
              <a
                href={`/fotoboek/${album.slug}`}
                class="group bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
              >
                {/* Cover Image */}
                <div class="relative h-64 bg-gradient-to-br from-gray-200 to-gray-300 overflow-hidden">
                  {album.cover_url ? (
                    <img
                      src={album.cover_url}
                      alt={album.titel}
                      class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                  ) : (
                    <div class="w-full h-full flex items-center justify-center">
                      <i class="fas fa-images text-6xl text-gray-400"></i>
                    </div>
                  )}
                  {/* Overlay with photo count */}
                  <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                    <div class="flex items-center justify-between text-white">
                      <span class="flex items-center text-sm">
                        <i class="fas fa-camera mr-2"></i>
                        {album.photo_count} foto's
                      </span>
                      {!album.is_publiek && (
                        <span class="px-2 py-1 bg-yellow-500 text-xs rounded">
                          <i class="fas fa-lock mr-1"></i>
                          Leden
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Album Info */}
                <div class="p-6">
                  <h3 class="text-xl font-bold text-gray-900 mb-2 group-hover:text-animato-primary transition">
                    {album.titel}
                  </h3>
                  {album.beschrijving && (
                    <p class="text-gray-600 text-sm line-clamp-2 mb-3">
                      {album.beschrijving}
                    </p>
                  )}
                  <div class="flex items-center text-sm text-gray-500">
                    <i class="fas fa-calendar mr-2"></i>
                    {new Date(album.created_at).toLocaleDateString('nl-NL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Call to Action for logged out users */}
      {!user && (
        <div class="bg-animato-primary/10 border-t border-animato-primary/20">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
            <i class="fas fa-user-circle text-5xl text-animato-primary mb-4"></i>
            <h3 class="text-2xl font-bold text-gray-900 mb-2">Wil je meer foto's zien?</h3>
            <p class="text-gray-600 mb-6">
              Log in als lid om toegang te krijgen tot exclusieve ledenalbums
            </p>
            <a
              href="/login"
              class="inline-block px-8 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition"
            >
              <i class="fas fa-sign-in-alt mr-2"></i>
              Inloggen
            </a>
          </div>
        </div>
      )}
    </Layout>
  )
})

// =====================================================
// ALBUM DETAIL WITH PHOTO GALLERY
// =====================================================

app.get('/fotoboek/:slug', async (c) => {
  const user = c.get('user')
  const slug = c.req.param('slug')

  // Get album
  const album = await queryAll(
    c.env.DB,
    `SELECT * FROM albums WHERE slug = ?`,
    [slug]
  )

  if (!album[0]) {
    return c.redirect('/fotoboek')
  }

  const albumData = album[0] as any

  // Check access - if private and not logged in, redirect
  if (!albumData.is_publiek && !user) {
    return c.redirect('/login?redirect=/fotoboek/' + slug)
  }

  // Get photos
  const photos = await queryAll(
    c.env.DB,
    `SELECT * FROM photos WHERE album_id = ? ORDER BY sorteer_volgorde ASC, id ASC`,
    [albumData.id]
  )

  return c.html(
    <Layout title={albumData.titel} user={user}>
      {/* Album Header */}
      <div class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white py-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav class="flex items-center text-white/80 text-sm mb-4">
            <a href="/fotoboek" class="hover:text-white">
              <i class="fas fa-images mr-2"></i>
              Fotoboek
            </a>
            <i class="fas fa-chevron-right mx-2 text-xs"></i>
            <span class="text-white">{albumData.titel}</span>
          </nav>
          <h1 class="text-3xl md:text-4xl font-bold mb-3" style="font-family: 'Playfair Display', serif;">
            {albumData.titel}
          </h1>
          {albumData.beschrijving && (
            <p class="text-xl text-white/90 max-w-3xl">
              {albumData.beschrijving}
            </p>
          )}
          <div class="flex items-center gap-6 mt-4 text-sm">
            <span>
              <i class="fas fa-calendar mr-2"></i>
              {new Date(albumData.created_at).toLocaleDateString('nl-NL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
            <span>
              <i class="fas fa-camera mr-2"></i>
              {photos.length} foto's
            </span>
            {!albumData.is_publiek && (
              <span class="px-3 py-1 bg-yellow-500 rounded-full">
                <i class="fas fa-lock mr-2"></i>
                Alleen leden
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Photo Gallery - Masonry Grid */}
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {photos.length === 0 ? (
          <div class="text-center py-16">
            <i class="fas fa-camera text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-600 mb-2">Geen foto's</h3>
            <p class="text-gray-500">Dit album bevat nog geen foto's</p>
          </div>
        ) : (
          <div class="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
            {photos.map((photo: any, index: number) => (
              <div class="break-inside-avoid">
                <button
                  onclick={`openLightbox(${index})`}
                  class="relative block w-full overflow-hidden rounded-lg shadow-md hover:shadow-xl transition-shadow cursor-pointer group"
                >
                  <img
                    src={photo.thumbnail_url || photo.url}
                    alt={photo.caption || `Foto ${index + 1}`}
                    class="w-full h-auto group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  {photo.caption && (
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p class="text-white text-sm">{photo.caption}</p>
                    </div>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <div id="lightbox" class="hidden fixed inset-0 z-50 bg-black/95">
        <button
          onclick="closeLightbox()"
          class="absolute top-4 right-4 text-white text-3xl hover:text-gray-300 transition z-10"
        >
          <i class="fas fa-times"></i>
        </button>

        <button
          onclick="previousPhoto()"
          class="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl hover:text-gray-300 transition z-10"
        >
          <i class="fas fa-chevron-left"></i>
        </button>

        <button
          onclick="nextPhoto()"
          class="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl hover:text-gray-300 transition z-10"
        >
          <i class="fas fa-chevron-right"></i>
        </button>

        <div class="absolute inset-0 flex items-center justify-center p-4">
          <div class="max-w-6xl w-full">
            <img
              id="lightboxImage"
              src=""
              alt=""
              class="max-w-full max-h-[85vh] mx-auto rounded-lg"
            />
            <div id="lightboxCaption" class="text-white text-center mt-4 text-lg"></div>
            <div id="lightboxCounter" class="text-white/70 text-center mt-2 text-sm"></div>
          </div>
        </div>
      </div>

      {/* Lightbox JavaScript */}
      <script dangerouslySetInnerHTML={{
        __html: `
          const photos = ${JSON.stringify(photos)};
          let currentPhotoIndex = 0;

          function openLightbox(index) {
            currentPhotoIndex = index;
            updateLightbox();
            document.getElementById('lightbox').classList.remove('hidden');
            document.body.style.overflow = 'hidden';
          }

          function closeLightbox() {
            document.getElementById('lightbox').classList.add('hidden');
            document.body.style.overflow = '';
          }

          function nextPhoto() {
            currentPhotoIndex = (currentPhotoIndex + 1) % photos.length;
            updateLightbox();
          }

          function previousPhoto() {
            currentPhotoIndex = (currentPhotoIndex - 1 + photos.length) % photos.length;
            updateLightbox();
          }

          function updateLightbox() {
            const photo = photos[currentPhotoIndex];
            document.getElementById('lightboxImage').src = photo.url;
            document.getElementById('lightboxImage').alt = photo.caption || '';
            document.getElementById('lightboxCaption').textContent = photo.caption || '';
            document.getElementById('lightboxCounter').textContent = 
              (currentPhotoIndex + 1) + ' / ' + photos.length;
          }

          // Keyboard navigation
          document.addEventListener('keydown', function(e) {
            if (!document.getElementById('lightbox').classList.contains('hidden')) {
              if (e.key === 'Escape') closeLightbox();
              if (e.key === 'ArrowRight') nextPhoto();
              if (e.key === 'ArrowLeft') previousPhoto();
            }
          });

          // Close on background click
          document.getElementById('lightbox').addEventListener('click', function(e) {
            if (e.target === this) closeLightbox();
          });
        `
      }} />
    </Layout>
  )
})

// =====================================================
// PRIVACYVERKLARING
// =====================================================

app.get('/privacyverklaring', async (c) => {
  const user = c.get('user')
  return c.html(
    <Layout title="Privacyverklaring" user={user} currentPath="/privacyverklaring">
      <div class="py-16 bg-white">
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 class="text-4xl font-bold text-animato-secondary mb-8" style="font-family: 'Playfair Display', serif;">
            Privacyverklaring
          </h1>
          <p class="text-sm text-gray-500 mb-8">Laatste update: april 2026</p>

          <div class="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">1. Wie zijn wij?</h2>
              <p>Gemengd Koor Animato, gevestigd te Zaal De Sopper, Oppuursdorp 15, 2890 Oppuurs, is verantwoordelijk voor de verwerking van persoonsgegevens zoals beschreven in deze privacyverklaring.</p>
              <p class="mt-2"><strong>Contactgegevens:</strong><br/>
                E-mail: <a href="mailto:gemengdkooranimato@gmail.com" class="text-animato-primary hover:underline">gemengdkooranimato@gmail.com</a><br/>
                Adres: Oppuursdorp 15, 2890 Oppuurs
              </p>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">2. Welke gegevens verwerken wij?</h2>
              <p>Wij verwerken de volgende categorieën persoonsgegevens:</p>
              <ul class="list-disc list-inside mt-2 space-y-1">
                <li>Naam en voornaam</li>
                <li>E-mailadres</li>
                <li>Telefoonnummer (optioneel)</li>
                <li>Stemgroep (sopraan, alt, tenor, bas)</li>
                <li>Adresgegevens (voor ledenadministratie)</li>
                <li>Inloggegevens voor het ledenportaal</li>
              </ul>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">3. Waarvoor gebruiken wij uw gegevens?</h2>
              <ul class="list-disc list-inside mt-2 space-y-1">
                <li>Ledenbeheer en communicatie met leden</li>
                <li>Organisatie van repetities, concerten en activiteiten</li>
                <li>Beantwoorden van contactvragen via het contactformulier</li>
                <li>Opvolging van inschrijvingen voor activiteiten</li>
                <li>Verzenden van nieuwsbrieven en uitnodigingen (met uw toestemming)</li>
              </ul>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">4. Rechtsgrond voor verwerking</h2>
              <p>Wij verwerken uw gegevens op basis van:</p>
              <ul class="list-disc list-inside mt-2 space-y-1">
                <li><strong>Uitvoering van overeenkomst</strong>: voor ledenadministratie en organisatorische communicatie</li>
                <li><strong>Toestemming</strong>: voor het versturen van nieuwsbrieven en uitnodigingen</li>
                <li><strong>Gerechtvaardigd belang</strong>: voor de werking van het koor</li>
              </ul>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">5. Bewaartermijn</h2>
              <p>Wij bewaren uw persoonsgegevens niet langer dan nodig voor de doeleinden waarvoor ze zijn verzameld. Gegevens van leden worden bewaard zolang het lidmaatschap actief is en maximaal 2 jaar daarna. Contactformuliergegevens worden maximaal 1 jaar bewaard.</p>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">6. Uw rechten</h2>
              <p>U heeft het recht om:</p>
              <ul class="list-disc list-inside mt-2 space-y-1">
                <li>Inzage te vragen in uw persoonsgegevens</li>
                <li>Onjuiste gegevens te laten corrigeren</li>
                <li>Uw gegevens te laten verwijderen</li>
                <li>Bezwaar te maken tegen de verwerking</li>
                <li>Uw toestemming in te trekken</li>
              </ul>
              <p class="mt-2">U kunt deze rechten uitoefenen door contact op te nemen via <a href="mailto:gemengdkooranimato@gmail.com" class="text-animato-primary hover:underline">gemengdkooranimato@gmail.com</a>.</p>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">7. Beveiliging</h2>
              <p>Wij nemen passende technische en organisatorische maatregelen om uw persoonsgegevens te beveiligen tegen ongeoorloofde toegang, verlies of misbruik. Wachtwoorden worden versleuteld opgeslagen.</p>
            </section>

            <section>
              <h2 class="text-2xl font-bold text-animato-secondary mb-3">8. Klachten</h2>
              <p>Heeft u een klacht over onze verwerking van persoonsgegevens? U kunt contact opnemen met de <a href="https://www.gegevensbeschermingsautoriteit.be" target="_blank" rel="noopener" class="text-animato-primary hover:underline">Gegevensbeschermingsautoriteit (GBA)</a>.</p>
            </section>

          </div>

          <div class="mt-12 pt-6 border-t border-gray-200">
            <a href="/" class="text-animato-primary hover:underline">
              <i class="fas fa-arrow-left mr-2"></i>Terug naar de startpagina
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// Redirect /privacy → /privacyverklaring voor backwards compatibiliteit
app.get('/privacy', (c) => c.redirect('/privacyverklaring', 301))

export default app
