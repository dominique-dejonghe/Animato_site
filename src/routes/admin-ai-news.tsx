// =====================================================
// AI-schrijfassistent voor nieuwsberichten — v2
// =====================================================
// Doel: laat het bestuur snel mooie nieuwsberichten genereren
// op basis van enkele feiten/steekwoorden. Geen websearch,
// geen externe scraping — gewoon: jij geeft de input,
// AI maakt er proza van, jij reviewt, één klik publiceren.
//
// Templates:
//   1. Aankondiging      → upcoming concert/event
//   2. Terugblik         → past concert/event
//   3. Lid-in-de-kijker  → nieuws over een individueel lid
//   4. Vrije vorm        → eigen instructie + steekwoorden
//
// Beeld: optioneel AI-gegenereerd via Cloudflare AI (Stable Diffusion)
//
// Publicatie: schrijft direct in de posts-tabel (type='nieuws')

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireAdmin } from '../middleware/auth'
import { execute } from '../utils/db'
import { uploadDataUrlToR2 } from '../utils/r2-storage'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/admin/ai-nieuws', requireAdmin)
app.use('/admin/ai-nieuws/*', requireAdmin)
app.use('/api/admin/ai-news/*', requireAdmin)

// =====================================================
// HELPERS
// =====================================================

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80) || 'nieuws-' + Date.now()
}

/**
 * Roep de LLM aan. Probeert eerst Cloudflare Workers AI (gratis tier),
 * valt terug op OpenAI als CF AI niet beschikbaar/faalt.
 */
async function callLLM(env: any, systemPrompt: string, userPrompt: string): Promise<string> {
  // Probeer Cloudflare Workers AI eerst (geen extra kosten)
  if (env.AI) {
    try {
      const result: any = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
      const text = result?.response || result?.result?.response || ''
      if (text && text.length > 50) return text
    } catch (e: any) {
      console.warn('Cloudflare AI failed, falling back to OpenAI:', e?.message)
    }
  }

  // Fallback: OpenAI
  if (env.OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
    })
    if (!r.ok) {
      const err = await r.text()
      throw new Error(`OpenAI fout (${r.status}): ${err.substring(0, 200)}`)
    }
    const data: any = await r.json()
    return data?.choices?.[0]?.message?.content || ''
  }

  throw new Error('Geen AI-provider beschikbaar (noch Cloudflare AI, noch OpenAI_API_KEY)')
}

/**
 * Convert ArrayBuffer to base64 string, chunked to avoid stack overflow
 * on large buffers (String.fromCharCode(...arr) blows up around ~100KB).
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000 // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk as any)
  }
  return btoa(binary)
}

/**
 * Genereer een afbeelding via Cloudflare Workers AI.
 * Returns een data-URL, of throwt met een duidelijke foutmelding.
 */
async function generateImage(env: any, prompt: string): Promise<string> {
  if (!env.AI) {
    throw new Error('Cloudflare AI binding (env.AI) niet beschikbaar — check wrangler.json')
  }

  // Try multiple models in order of preference.
  // SDXL Lightning is the fastest and most reliable on Cloudflare Workers AI.
  const models = [
    '@cf/bytedance/stable-diffusion-xl-lightning',
    '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    '@cf/lykon/dreamshaper-8-lcm',
  ]

  const enrichedPrompt = prompt + ', high quality, professional photography, warm lighting, choir performance, vibrant colors'

  const errors: string[] = []
  for (const model of models) {
    try {
      const result: any = await env.AI.run(model, {
        prompt: enrichedPrompt,
        num_steps: model.includes('lightning') ? 4 : 20,
      })

      // Cloudflare AI returns either:
      //   - a ReadableStream of raw PNG bytes (older models)
      //   - an object { image: "<base64>" } (newer models)
      //   - an ArrayBuffer / Uint8Array
      let dataUrl: string | null = null

      if (result && typeof result === 'object' && typeof result.image === 'string') {
        // Already base64-encoded
        dataUrl = `data:image/png;base64,${result.image}`
      } else if (result instanceof ReadableStream || (result && typeof (result as any).getReader === 'function')) {
        const buf = await new Response(result as any).arrayBuffer()
        dataUrl = `data:image/png;base64,${bufferToBase64(buf)}`
      } else if (result instanceof ArrayBuffer) {
        dataUrl = `data:image/png;base64,${bufferToBase64(result)}`
      } else if (result && (result as any).buffer instanceof ArrayBuffer) {
        dataUrl = `data:image/png;base64,${bufferToBase64((result as any).buffer)}`
      }

      if (dataUrl) return dataUrl
      errors.push(`${model}: onbekend response-formaat (${typeof result})`)
    } catch (e: any) {
      errors.push(`${model}: ${e?.message || e}`)
      console.warn(`Image gen failed on ${model}:`, e?.message || e)
    }
  }

  throw new Error('Alle beeldmodellen faalden. Details: ' + errors.join(' | '))
}

// =====================================================
// PROMPT-BUILDERS PER TEMPLATE
// =====================================================

const SYSTEM_PROMPT = `Je bent de communicatieverantwoordelijke van Gemengd Koor Animato, een enthousiast amateurkoor uit Oppuurs (Klein-Brabant, België) onder leiding van dirigent Frank. Het koor zingt een breed repertoire van klassiek tot pop.

Je schrijft nieuwsberichten voor de Animato-website. Stijl:
- Vlaams Nederlands (geen Hollandse woorden zoals "leuk", "lekker", "snel even")
- Warm en persoonlijk, maar professioneel
- Korte alinea's (max 3-4 zinnen per alinea)
- Geen overdreven emoji's of uitroeptekens
- Spreek de lezer aan als "u" (in nieuwsberichten over het koor zelf)

Output formaat:
- Geef ALLEEN het artikel terug, geen meta-commentaar
- Begin met een pakkende inleidende zin (geen titel — die geven we apart)
- Gebruik HTML voor structuur: <p> voor alinea's, eventueel <h3> voor tussenkoppen, <strong> voor nadruk
- Geen <html>, <body> of <h1> tags — alleen content
- Geen markdown (geen ##, geen **)`

function buildAankondigingPrompt(data: any): string {
  return `Schrijf een aankondiging voor:

Wat: ${data.wat || '(niet opgegeven)'}
Wanneer: ${data.wanneer || '(niet opgegeven)'}
Waar: ${data.waar || '(niet opgegeven)'}
Programma/inhoud: ${data.programma || '(niet opgegeven)'}
Tickets/inschrijving: ${data.tickets || '(niet opgegeven)'}
Bijzonderheden: ${data.bijzonderheden || '(geen)'}

Schrijf een wervend maar professioneel bericht van 3-4 alinea's. Eindig met een duidelijke call-to-action (kom kijken, schrijf in, ...). Lengte: 200-350 woorden.`
}

function buildTerugblikPrompt(data: any): string {
  return `Schrijf een warme terugblik op:

Wat was het: ${data.wat || '(niet opgegeven)'}
Wanneer: ${data.wanneer || '(niet opgegeven)'}
Waar: ${data.waar || '(niet opgegeven)'}
Hoeveel mensen kwamen: ${data.publiek || '(niet opgegeven)'}
Hoogtepunten/sfeer: ${data.hoogtepunten || '(niet opgegeven)'}
Quotes of reacties: ${data.quotes || '(geen)'}
Bedankjes: ${data.bedankjes || '(geen)'}

Schrijf een nostalgische, dankbare terugblik van 3-4 alinea's. Maak de lezer trots op het koor. Lengte: 250-400 woorden.`
}

function buildLidInDeKijkerPrompt(data: any): string {
  return `Schrijf een persoonlijk nieuwsbericht over een lid van het koor:

Naam: ${data.naam || '(niet opgegeven)'}
Stemgroep: ${data.stemgroep || '(niet opgegeven)'}
Aanleiding: ${data.aanleiding || '(niet opgegeven)'}
Details: ${data.details || '(niet opgegeven)'}
Wat wil het koor uitspreken: ${data.boodschap || '(niet opgegeven)'}

Schrijf een warm, persoonlijk bericht van 2-3 alinea's waarmee het koor zijn betrokkenheid toont bij het lid. Vermijd kleffe taal. Lengte: 150-250 woorden.`
}

function buildVrijeVormPrompt(data: any): string {
  return `Schrijf een nieuwsbericht over:

Onderwerp: ${data.onderwerp || '(niet opgegeven)'}
Steekwoorden/feiten:
${data.feiten || '(niet opgegeven)'}

Toon: ${data.toon || 'informatief'}
Doelgroep: ${data.doelgroep || 'leden en publiek'}

Schrijf een afgewerkt nieuwsbericht. Lengte: passend bij het onderwerp (150-400 woorden).`
}

// =====================================================
// API: GENERATE ARTICLE
// =====================================================

app.post('/api/admin/ai-news/generate', async (c) => {
  try {
    const body = await c.req.json() as any
    const { template, data, titel_idee } = body

    if (!template || !data) {
      return c.json({ error: 'Template en data zijn verplicht' }, 400)
    }

    let userPrompt: string
    switch (template) {
      case 'aankondiging': userPrompt = buildAankondigingPrompt(data); break
      case 'terugblik':    userPrompt = buildTerugblikPrompt(data); break
      case 'lid':          userPrompt = buildLidInDeKijkerPrompt(data); break
      case 'vrij':         userPrompt = buildVrijeVormPrompt(data); break
      default: return c.json({ error: 'Onbekend template: ' + template }, 400)
    }

    const articleBody = await callLLM(c.env, SYSTEM_PROMPT, userPrompt)

    if (!articleBody || articleBody.length < 80) {
      return c.json({ error: 'AI gaf een te kort antwoord — probeer opnieuw met meer details.' }, 500)
    }

    // Maak een titel-suggestie (apart, korte LLM-call)
    let titelSuggestie = titel_idee || ''
    if (!titelSuggestie) {
      try {
        const titelText = await callLLM(c.env,
          'Je bent een redactionele kop-schrijver. Geef ÉÉN pakkende, korte titel (max 8 woorden, geen punt op het einde, geen aanhalingstekens) voor dit nieuwsbericht. Geef ALLEEN de titel terug, niets anders.',
          articleBody.substring(0, 1000)
        )
        titelSuggestie = titelText.replace(/^["']|["']$/g, '').replace(/[.]$/, '').trim().split('\n')[0]
      } catch {
        titelSuggestie = 'Nieuw bericht van Animato'
      }
    }

    // Maak een excerpt-suggestie (eerste zin uit body, max 200 chars)
    const plainBody = articleBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const excerpt = plainBody.length > 200
      ? plainBody.substring(0, 197) + '...'
      : plainBody

    return c.json({
      ok: true,
      titel: titelSuggestie,
      body: articleBody,
      excerpt
    })
  } catch (e: any) {
    console.error('Generate error:', e)
    return c.json({ error: e?.message || 'Onbekende fout bij genereren' }, 500)
  }
})

// =====================================================
// API: GENERATE IMAGE
// =====================================================

app.post('/api/admin/ai-news/image', async (c) => {
  try {
    const { prompt } = await c.req.json() as any
    if (!prompt) return c.json({ error: 'Prompt is verplicht' }, 400)

    const imageUrl = await generateImage(c.env, prompt)
    return c.json({ ok: true, image: imageUrl })
  } catch (e: any) {
    const msg = e?.message || String(e) || 'Onbekende fout bij beeldgeneratie'
    console.error('Image generation error:', msg)
    return c.json({ error: msg }, 500)
  }
})

// =====================================================
// API: PUBLISH
// =====================================================

app.post('/api/admin/ai-news/publish', async (c) => {
  const user = c.get('user') as SessionUser
  try {
    const { titel, body, excerpt, cover_data, zichtbaarheid, is_published } = await c.req.json() as any

    if (!titel || !body) {
      return c.json({ error: 'Titel en inhoud zijn verplicht' }, 400)
    }

    // Upload cover image naar R2 als data-URL meegegeven
    let coverUrl: string | null = null
    if (cover_data && String(cover_data).startsWith('data:image/') && c.env.R2) {
      try {
        const up = await uploadDataUrlToR2(c.env.R2, 'nieuws-covers', String(cover_data))
        if (up?.url) coverUrl = up.url
      } catch (e: any) {
        console.warn('Cover upload failed:', e?.message)
      }
    }

    // Genereer unieke slug
    let baseSlug = slugify(titel)
    let slug = baseSlug
    let suffix = 1
    while (true) {
      const existing: any = await c.env.DB.prepare(
        `SELECT id FROM posts WHERE slug = ? LIMIT 1`
      ).bind(slug).first()
      if (!existing) break
      suffix++
      slug = `${baseSlug}-${suffix}`
      if (suffix > 20) { slug = baseSlug + '-' + Date.now(); break }
    }

    const publishNow = is_published ? 1 : 0
    const vis = (zichtbaarheid === 'leden' || zichtbaarheid === 'bestuur') ? zichtbaarheid : 'publiek'

    const result = await c.env.DB.prepare(
      `INSERT INTO posts (titel, slug, body, excerpt, auteur_id, type, zichtbaarheid, is_published, cover_image, published_at)
       VALUES (?, ?, ?, ?, ?, 'nieuws', ?, ?, ?, ${publishNow ? 'CURRENT_TIMESTAMP' : 'NULL'})`
    ).bind(titel, slug, body, excerpt || null, user.id, vis, publishNow, coverUrl).run()

    return c.json({
      ok: true,
      id: result.meta.last_row_id,
      slug,
      url: publishNow ? `/nieuws/${slug}` : `/admin/nieuws/${result.meta.last_row_id}`
    })
  } catch (e: any) {
    console.error('Publish error:', e)
    return c.json({ error: e?.message || 'Publiceren mislukt' }, 500)
  }
})

// =====================================================
// UI: /admin/ai-nieuws
// =====================================================

app.get('/admin/ai-nieuws', async (c) => {
  const user = c.get('user') as SessionUser

  return c.html(
    <Layout title="AI-schrijfassistent" user={user} currentPath="/admin/ai-nieuws">
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="nieuws" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <div class="flex-1 min-w-0">

          <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="mb-8">
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-wand-magic-sparkles text-purple-500 mr-3"></i>
                AI-schrijfassistent
              </h1>
              <p class="text-gray-600 mt-2">Geef de feiten, AI maakt er een afgewerkt nieuwsbericht van — in drie stappen.</p>
            </div>

            {/* STAP 1: KIES TEMPLATE */}
            <div id="step-1" class="mb-8">
              <h2 class="text-lg font-semibold text-gray-800 mb-3">
                <span class="inline-flex items-center justify-center w-7 h-7 bg-purple-100 text-purple-700 rounded-full text-sm font-bold mr-2">1</span>
                Wat wil je schrijven?
              </h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button type="button" data-tpl="aankondiging" class="tpl-btn bg-white border-2 border-gray-200 hover:border-purple-400 rounded-xl p-5 text-left transition shadow-sm hover:shadow">
                  <i class="fas fa-bullhorn text-3xl text-blue-500 mb-3"></i>
                  <h3 class="font-bold text-gray-900 mb-1">Aankondiging</h3>
                  <p class="text-xs text-gray-500">Komend concert, repetitie, optreden</p>
                </button>
                <button type="button" data-tpl="terugblik" class="tpl-btn bg-white border-2 border-gray-200 hover:border-purple-400 rounded-xl p-5 text-left transition shadow-sm hover:shadow">
                  <i class="fas fa-camera-retro text-3xl text-amber-500 mb-3"></i>
                  <h3 class="font-bold text-gray-900 mb-1">Terugblik</h3>
                  <p class="text-xs text-gray-500">Verslag van een voorbij event</p>
                </button>
                <button type="button" data-tpl="lid" class="tpl-btn bg-white border-2 border-gray-200 hover:border-purple-400 rounded-xl p-5 text-left transition shadow-sm hover:shadow">
                  <i class="fas fa-user-music text-3xl text-pink-500 mb-3"></i>
                  <h3 class="font-bold text-gray-900 mb-1">Lid-in-de-kijker</h3>
                  <p class="text-xs text-gray-500">Persoonlijk nieuws over een lid</p>
                </button>
                <button type="button" data-tpl="vrij" class="tpl-btn bg-white border-2 border-gray-200 hover:border-purple-400 rounded-xl p-5 text-left transition shadow-sm hover:shadow">
                  <i class="fas fa-feather-pointed text-3xl text-purple-500 mb-3"></i>
                  <h3 class="font-bold text-gray-900 mb-1">Vrije vorm</h3>
                  <p class="text-xs text-gray-500">Eigen onderwerp + steekwoorden</p>
                </button>
              </div>
            </div>

            {/* STAP 2: VUL DE FEITEN IN — wordt dynamisch ingevuld */}
            <div id="step-2" class="hidden mb-8">
              <h2 class="text-lg font-semibold text-gray-800 mb-3">
                <span class="inline-flex items-center justify-center w-7 h-7 bg-purple-100 text-purple-700 rounded-full text-sm font-bold mr-2">2</span>
                Geef de feiten
              </h2>
              <div id="form-container" class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                {/* JS vult dit dynamisch */}
              </div>
              <div class="mt-4 flex flex-wrap gap-3 items-center">
                <button id="generate-btn" type="button"
                        class="inline-flex items-center bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-lg shadow transition disabled:opacity-50">
                  <i class="fas fa-sparkles mr-2"></i>
                  <span id="generate-label">Schrijf het artikel</span>
                </button>
                <button id="back-btn" type="button"
                        class="text-gray-500 hover:text-gray-700 text-sm">
                  <i class="fas fa-arrow-left mr-1"></i> Ander template
                </button>
                <span id="generate-status" class="text-sm text-gray-500"></span>
              </div>
            </div>

            {/* STAP 3: REVIEW + PUBLICEER */}
            <div id="step-3" class="hidden mb-8">
              <h2 class="text-lg font-semibold text-gray-800 mb-3">
                <span class="inline-flex items-center justify-center w-7 h-7 bg-purple-100 text-purple-700 rounded-full text-sm font-bold mr-2">3</span>
                Review, polish en publiceer
              </h2>

              <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div class="mb-4">
                  <label class="block text-sm font-semibold text-gray-700 mb-1">Titel</label>
                  <input type="text" id="result-titel"
                         class="w-full border-gray-300 rounded-lg p-3 border focus:ring-purple-500 focus:border-purple-500 text-lg font-semibold" />
                </div>

                <div class="mb-4">
                  <label class="block text-sm font-semibold text-gray-700 mb-1">Korte intro (excerpt)</label>
                  <textarea id="result-excerpt" rows={2}
                            class="w-full border-gray-300 rounded-lg p-3 border focus:ring-purple-500 focus:border-purple-500 text-sm"></textarea>
                </div>

                <div class="mb-4">
                  <label class="block text-sm font-semibold text-gray-700 mb-1">
                    Inhoud (HTML toegestaan)
                    <span class="text-xs font-normal text-gray-400 ml-1">— je kan hier vrij bewerken</span>
                  </label>
                  <textarea id="result-body" rows={16}
                            class="w-full border-gray-300 rounded-lg p-3 border focus:ring-purple-500 focus:border-purple-500 text-sm font-mono"></textarea>
                </div>

                {/* Beeldgeneratie */}
                <div class="mb-4 bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 class="font-semibold text-gray-800 mb-2">
                    <i class="fas fa-image text-purple-500 mr-2"></i> Cover-afbeelding
                  </h3>
                  <p class="text-xs text-gray-600 mb-3">Laat AI een passend beeld genereren (Stable Diffusion), of laat leeg en upload later via de gewone nieuws-editor.</p>
                  <div class="flex flex-wrap gap-2 mb-3">
                    <input type="text" id="image-prompt" placeholder="bv. choir singing on stage, warm lights, audience"
                           class="flex-1 min-w-[200px] border-gray-300 rounded-lg p-2 border text-sm" />
                    <button id="image-btn" type="button"
                            class="inline-flex items-center bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                      <i class="fas fa-paintbrush mr-2"></i> Genereer beeld
                    </button>
                  </div>
                  <div id="image-status" class="text-sm text-gray-500"></div>
                  <div id="image-preview" class="mt-3"></div>
                </div>

                <div class="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Zichtbaarheid</label>
                    <select id="result-zichtbaarheid" class="w-full border-gray-300 rounded-lg p-2 border">
                      <option value="publiek">Publiek (iedereen)</option>
                      <option value="leden">Alleen leden</option>
                      <option value="bestuur">Alleen bestuur</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                    <select id="result-published" class="w-full border-gray-300 rounded-lg p-2 border">
                      <option value="1">Direct publiceren</option>
                      <option value="0">Bewaren als concept</option>
                    </select>
                  </div>
                </div>

                <div class="flex flex-wrap gap-3 items-center">
                  <button id="publish-btn" type="button"
                          class="inline-flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg shadow transition">
                    <i class="fas fa-paper-plane mr-2"></i>
                    <span id="publish-label">Publiceren</span>
                  </button>
                  <button id="regenerate-btn" type="button"
                          class="inline-flex items-center bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-4 py-3 rounded-lg text-sm">
                    <i class="fas fa-rotate mr-2"></i> Opnieuw genereren
                  </button>
                  <button id="restart-btn" type="button"
                          class="text-gray-500 hover:text-gray-700 text-sm">
                    <i class="fas fa-trash mr-1"></i> Begin opnieuw
                  </button>
                  <span id="publish-status" class="text-sm"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================== */}
      {/* CLIENT-SIDE LOGIC                                     */}
      {/* ===================================================== */}
      <script dangerouslySetInnerHTML={{__html: `
        (function() {
          // Veld-definities per template
          const TEMPLATES = {
            aankondiging: {
              label: 'Aankondiging',
              fields: [
                { name: 'wat', label: 'Wat is het?', placeholder: 'bv. Lenteconcert, repetitiedag, optreden in WZC', required: true },
                { name: 'wanneer', label: 'Wanneer?', placeholder: 'bv. zaterdag 21 maart 2026, 20u', required: true },
                { name: 'waar', label: 'Waar?', placeholder: 'bv. Sint-Pieterskerk Oppuurs', required: true },
                { name: 'programma', label: 'Programma / inhoud', type: 'textarea', placeholder: 'bv. We brengen werken van Mozart, Brahms en eigentijdse pop-arrangementen.' },
                { name: 'tickets', label: 'Tickets / inschrijving', placeholder: 'bv. €15 aan de kassa, vvk €12 via animato.be/tickets' },
                { name: 'bijzonderheden', label: 'Bijzonderheden', type: 'textarea', placeholder: 'Speciale gasten, samenwerking, eerste keer iets, ...' }
              ]
            },
            terugblik: {
              label: 'Terugblik',
              fields: [
                { name: 'wat', label: 'Wat was het?', placeholder: 'bv. Lenteconcert 2026', required: true },
                { name: 'wanneer', label: 'Wanneer?', placeholder: 'bv. zaterdag 21 maart 2026' },
                { name: 'waar', label: 'Waar?', placeholder: 'bv. Sint-Pieterskerk Oppuurs' },
                { name: 'publiek', label: 'Aantal toeschouwers / sfeer publiek', placeholder: 'bv. 250 enthousiaste mensen, volle zaal' },
                { name: 'hoogtepunten', label: 'Hoogtepunten en sfeer', type: 'textarea', placeholder: 'bv. Bisnummer Halleluja, staande ovatie bij Pavane, samenzingen met publiek' },
                { name: 'quotes', label: 'Quotes of reacties', type: 'textarea', placeholder: 'bv. "Het mooiste concert dat ik ooit hoorde" — Jan uit Oppuurs' },
                { name: 'bedankjes', label: 'Bedankjes', placeholder: 'bv. dank aan vrijwilligers, technici, sponsors...' }
              ]
            },
            lid: {
              label: 'Lid-in-de-kijker',
              fields: [
                { name: 'naam', label: 'Naam van het lid', placeholder: 'bv. Emma Janssens', required: true },
                { name: 'stemgroep', label: 'Stemgroep', placeholder: 'bv. sopraan, alt, tenor, bas' },
                { name: 'aanleiding', label: 'Wat is de aanleiding?', placeholder: 'bv. Emma is mama geworden, 25 jaar in het koor, prijs gewonnen', required: true },
                { name: 'details', label: 'Details', type: 'textarea', placeholder: 'bv. Dochter Lina, geboren op 5 maart. Mama en kindje stellen het goed.' },
                { name: 'boodschap', label: 'Wat wil het koor uitspreken?', type: 'textarea', placeholder: 'bv. Onze hartelijke gelukwensen, we kijken uit naar haar terugkeer' }
              ]
            },
            vrij: {
              label: 'Vrije vorm',
              fields: [
                { name: 'onderwerp', label: 'Wat is het onderwerp?', placeholder: 'bv. We zoeken nieuwe leden', required: true },
                { name: 'feiten', label: 'Steekwoorden / feiten', type: 'textarea', rows: 6, placeholder: 'Lijst alles op wat in het bericht moet komen:\\n- Open repetitie elke maandag 20u\\n- Iedereen welkom, geen voorkennis nodig\\n- Contact via info@animato.be', required: true },
                { name: 'toon', label: 'Toon', type: 'select', options: ['informatief', 'enthousiast', 'formeel', 'persoonlijk'] },
                { name: 'doelgroep', label: 'Doelgroep', placeholder: 'bv. potentiële nieuwe leden, ouders, publiek' }
              ]
            }
          };

          let currentTpl = null;
          let lastInput = null;

          // STAP 1 → STAP 2
          document.querySelectorAll('.tpl-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              currentTpl = btn.dataset.tpl;
              renderForm(currentTpl);
              document.getElementById('step-2').classList.remove('hidden');
              document.getElementById('step-3').classList.add('hidden');
              document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('border-purple-500', 'bg-purple-50'));
              btn.classList.add('border-purple-500', 'bg-purple-50');
              document.getElementById('step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          });

          // RENDER DYNAMIC FORM
          function renderForm(tpl) {
            const def = TEMPLATES[tpl];
            const container = document.getElementById('form-container');
            const parts = [];
            for (const f of def.fields) {
              const reqMark = f.required ? '<span class="text-red-500">*</span>' : '';
              const placeholder = (f.placeholder || '').replace(/"/g, '&quot;');
              if (f.type === 'textarea') {
                parts.push(\`
                  <div class="mb-4">
                    <label class="block text-sm font-semibold text-gray-700 mb-1">\${f.label} \${reqMark}</label>
                    <textarea name="\${f.name}" rows="\${f.rows || 3}" placeholder="\${placeholder}"
                              class="w-full border-gray-300 rounded-lg p-2 border focus:ring-purple-500 focus:border-purple-500 text-sm"></textarea>
                  </div>\`);
              } else if (f.type === 'select') {
                const opts = (f.options || []).map(o => \`<option value="\${o}">\${o}</option>\`).join('');
                parts.push(\`
                  <div class="mb-4">
                    <label class="block text-sm font-semibold text-gray-700 mb-1">\${f.label}</label>
                    <select name="\${f.name}" class="w-full border-gray-300 rounded-lg p-2 border">\${opts}</select>
                  </div>\`);
              } else {
                parts.push(\`
                  <div class="mb-4">
                    <label class="block text-sm font-semibold text-gray-700 mb-1">\${f.label} \${reqMark}</label>
                    <input type="text" name="\${f.name}" placeholder="\${placeholder}"
                           class="w-full border-gray-300 rounded-lg p-2 border focus:ring-purple-500 focus:border-purple-500 text-sm" />
                  </div>\`);
              }
            }
            container.innerHTML = parts.join('');
          }

          // BACK BUTTON
          document.getElementById('back-btn').addEventListener('click', () => {
            document.getElementById('step-2').classList.add('hidden');
            document.getElementById('step-3').classList.add('hidden');
            document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('border-purple-500', 'bg-purple-50'));
          });

          // GENERATE
          async function doGenerate() {
            if (!currentTpl) return;
            const def = TEMPLATES[currentTpl];
            const data = {};
            for (const f of def.fields) {
              const el = document.querySelector('[name="' + f.name + '"]');
              if (el) data[f.name] = el.value.trim();
              if (f.required && !data[f.name]) {
                alert('Vul minstens "' + f.label + '" in.');
                el && el.focus();
                return;
              }
            }
            lastInput = { template: currentTpl, data };

            const btn = document.getElementById('generate-btn');
            const label = document.getElementById('generate-label');
            const status = document.getElementById('generate-status');
            btn.disabled = true;
            label.textContent = 'AI denkt na...';
            status.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Dit duurt 5-15 seconden';

            try {
              const r = await fetch('/api/admin/ai-news/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lastInput)
              });
              const result = await r.json();
              if (!r.ok || !result.ok) {
                throw new Error(result.error || 'Onbekende fout');
              }

              document.getElementById('result-titel').value = result.titel || '';
              document.getElementById('result-excerpt').value = result.excerpt || '';
              document.getElementById('result-body').value = result.body || '';
              // Suggestie voor image prompt op basis van titel
              document.getElementById('image-prompt').value = result.titel ? ('Animato choir — ' + result.titel) : '';

              document.getElementById('step-3').classList.remove('hidden');
              document.getElementById('step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
              status.innerHTML = '<span class="text-green-600"><i class="fas fa-check mr-1"></i> Klaar! Review hieronder.</span>';
            } catch (e) {
              status.innerHTML = '<span class="text-red-600"><i class="fas fa-exclamation-triangle mr-1"></i> ' + (e.message || 'Fout') + '</span>';
            } finally {
              btn.disabled = false;
              label.textContent = 'Schrijf het artikel';
            }
          }
          document.getElementById('generate-btn').addEventListener('click', doGenerate);
          document.getElementById('regenerate-btn').addEventListener('click', doGenerate);

          // RESTART
          document.getElementById('restart-btn').addEventListener('click', () => {
            if (!confirm('Alles wegdoen en opnieuw beginnen?')) return;
            document.getElementById('step-2').classList.add('hidden');
            document.getElementById('step-3').classList.add('hidden');
            document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('border-purple-500', 'bg-purple-50'));
            currentTpl = null; lastInput = null;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });

          // IMAGE GENERATION
          let generatedImageData = null;
          document.getElementById('image-btn').addEventListener('click', async () => {
            const prompt = document.getElementById('image-prompt').value.trim();
            if (!prompt) { alert('Geef eerst een omschrijving van het beeld.'); return; }
            const status = document.getElementById('image-status');
            const preview = document.getElementById('image-preview');
            const btn = document.getElementById('image-btn');
            btn.disabled = true;
            status.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Beeld wordt gemaakt (10-30 sec)...';
            preview.innerHTML = '';
            try {
              const r = await fetch('/api/admin/ai-news/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
              });
              const result = await r.json();
              if (!r.ok || !result.ok) throw new Error(result.error || 'Beeld mislukt');
              generatedImageData = result.image;
              preview.innerHTML = '<img src="' + result.image + '" class="rounded-lg max-w-full max-h-96 border" />' +
                '<p class="text-xs text-gray-500 mt-2"><i class="fas fa-check text-green-500 mr-1"></i> Beeld wordt mee gepubliceerd als cover.</p>';
              status.innerHTML = '<span class="text-green-600"><i class="fas fa-check mr-1"></i> Klaar.</span>';
            } catch (e) {
              status.innerHTML = '<span class="text-red-600"><i class="fas fa-exclamation-triangle mr-1"></i> ' + (e.message || 'Fout') + '</span>';
            } finally {
              btn.disabled = false;
            }
          });

          // PUBLISH
          document.getElementById('publish-btn').addEventListener('click', async () => {
            const titel = document.getElementById('result-titel').value.trim();
            const body = document.getElementById('result-body').value.trim();
            const excerpt = document.getElementById('result-excerpt').value.trim();
            const zichtbaarheid = document.getElementById('result-zichtbaarheid').value;
            const is_published = document.getElementById('result-published').value === '1';
            if (!titel || !body) { alert('Titel en inhoud zijn verplicht.'); return; }

            const btn = document.getElementById('publish-btn');
            const label = document.getElementById('publish-label');
            const status = document.getElementById('publish-status');
            btn.disabled = true;
            label.textContent = 'Bezig...';
            status.innerHTML = '<i class="fas fa-spinner fa-spin mr-1 text-gray-400"></i>';

            try {
              const r = await fetch('/api/admin/ai-news/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titel, body, excerpt, cover_data: generatedImageData, zichtbaarheid, is_published })
              });
              const result = await r.json();
              if (!r.ok || !result.ok) throw new Error(result.error || 'Publiceren mislukt');
              status.innerHTML = '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i> Gepubliceerd! <a href="' + result.url + '" class="underline">Open</a></span>';
              label.textContent = 'Gepubliceerd ✓';
            } catch (e) {
              status.innerHTML = '<span class="text-red-600"><i class="fas fa-exclamation-triangle mr-1"></i> ' + (e.message || 'Fout') + '</span>';
              btn.disabled = false;
              label.textContent = 'Publiceren';
            }
          });
        })();
      `}} />
    </Layout>
  )
})

export default app
