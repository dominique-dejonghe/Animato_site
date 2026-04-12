// Admin AI News Generator
// Zoek naar koor-gerelateerd nieuws via AI web search en genereer artikels met AI + afbeeldingen

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { execute, queryOne, queryAll } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// HELPERS
// =====================================================

/** Call AI - uses Cloudflare Workers AI (free, no API key needed) with fallback to external LLM */
async function callAI(
  env: any,
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; max_tokens?: number } = {}
): Promise<string> {
  // Strategy 1: Cloudflare Workers AI (free, no key needed)
  if (env.AI) {
    try {
      const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens || 4000
      })
      if (result?.response) return result.response
    } catch (e: any) {
      console.error('Workers AI error, trying fallback:', e.message)
    }
  }

  // Strategy 2: External OpenAI-compatible API (if configured)
  const apiKey = env.OPENAI_API_KEY
  const baseUrl = env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1'
  
  if (apiKey) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens || 4000
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`LLM API error ${response.status}: ${errText}`)
    }

    const data = await response.json() as any
    return data.choices?.[0]?.message?.content || ''
  }

  throw new Error('Geen AI beschikbaar. Controleer de Workers AI binding in wrangler.json.')
}

/** Parse JSON from LLM response, handling markdown code blocks */
function parseLLMJson<T = any>(content: string): T {
  let cleaned = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim()
  // Sometimes LLM adds text before/after JSON - try to extract it
  const jsonStart = cleaned.indexOf('[') !== -1 ? cleaned.indexOf('[') : cleaned.indexOf('{')
  const jsonEndBracket = cleaned.lastIndexOf(']') !== -1 ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEndBracket !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEndBracket + 1)
  }
  return JSON.parse(cleaned)
}

/** Perform a real web search using Google search scraping */
async function webSearch(query: string, numResults: number = 8): Promise<Array<{title: string; snippet: string; url: string; source: string}>> {
  const results: Array<{title: string; snippet: string; url: string; source: string}> = []
  
  // Use Google search via HTML parsing
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${numResults}&hl=nl&gl=be`
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'nl-BE,nl;q=0.9'
      }
    })
    
    const html = await response.text()
    
    // Extract search results from Google HTML
    // Google wraps results in <div class="g"> blocks
    const resultRegex = /<a href="\/url\?q=([^&"]+).*?<h3[^>]*>(.*?)<\/h3>.*?<span[^>]*>(.*?)<\/span>/gs
    const altRegex = /<a href="(https?:\/\/[^"]+)"[^>]*>.*?<h3[^>]*>(.*?)<\/h3>/gs
    
    // Try to parse structured results
    const blocks = html.split('<div class="g"')
    for (const block of blocks.slice(1)) { // skip first empty split
      // Extract URL
      const urlMatch = block.match(/href="\/url\?q=(https?:\/\/[^&"]+)/) || block.match(/href="(https?:\/\/(?!google\.com)[^"]+)"/)
      // Extract title from h3
      const titleMatch = block.match(/<h3[^>]*>(.*?)<\/h3>/)
      // Extract snippet text
      const snippetMatch = block.match(/<span[^>]*class="[^"]*st[^"]*"[^>]*>(.*?)<\/span>/) || 
                          block.match(/<div[^>]*data-sncf[^>]*>(.*?)<\/div>/) ||
                          block.match(/<div class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)<\/div>/)
      
      if (urlMatch && titleMatch) {
        const url = decodeURIComponent(urlMatch[1]).split('&')[0]
        const title = titleMatch[1].replace(/<[^>]+>/g, '').trim()
        const snippet = snippetMatch 
          ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
          : ''
        
        // Extract source domain
        const sourceMatch = url.match(/https?:\/\/(?:www\.)?([^\/]+)/)
        const source = sourceMatch ? sourceMatch[1] : 'Onbekend'
        
        if (title && url && !url.includes('google.com')) {
          results.push({ title, snippet: snippet || 'Geen samenvatting beschikbaar.', url, source })
        }
      }
      
      if (results.length >= numResults) break
    }

    // If structured parsing fails, try simple regex on the whole HTML
    if (results.length === 0) {
      const simpleRegex = /href="\/url\?q=(https?:\/\/(?!google)[^&"]+)[^"]*"[^>]*>.*?<h3[^>]*>(.*?)<\/h3>/gs
      let match
      while ((match = simpleRegex.exec(html)) !== null && results.length < numResults) {
        const url = decodeURIComponent(match[1]).split('&')[0]
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        const sourceMatch = url.match(/https?:\/\/(?:www\.)?([^\/]+)/)
        results.push({
          title,
          snippet: 'Klik door voor meer informatie.',
          url,
          source: sourceMatch ? sourceMatch[1] : 'Onbekend'
        })
      }
    }
  } catch (e: any) {
    console.error('Web search error:', e.message)
  }
  
  return results
}

// =====================================================
// ADMIN PAGE: AI Nieuws Generator
// =====================================================
app.get('/admin/ai-nieuws', async (c) => {
  const user = c.get('user') as SessionUser

  // Get recent AI-generated posts for history
  const recentAiPosts = await queryAll(c.env.DB,
    `SELECT p.id, p.titel, p.is_published, p.created_at, p.excerpt
     FROM posts p 
     WHERE p.auteur_id = ? AND p.body LIKE '%Dit artikel werd gegenereerd met behulp van AI%'
     ORDER BY p.created_at DESC LIMIT 10`,
    [user.id]
  )

  return c.html(
    <Layout title="AI Nieuwsgenerator" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="ai-news" />
        <main class="flex-1 p-8">
          <div class="max-w-5xl mx-auto">

            {/* Header */}
            <div class="mb-8">
              <div class="flex items-center justify-between">
                <div>
                  <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-robot text-purple-600 mr-3"></i>
                    AI Nieuwsgenerator
                  </h1>
                  <p class="mt-2 text-gray-600">
                    Zoek op het internet naar nieuws over amateurkoren en genereer publiceerbare artikels met AI
                  </p>
                </div>
                <a href="/admin/content" class="text-sm text-animato-primary hover:underline flex items-center gap-1">
                  <i class="fas fa-arrow-left"></i> Terug naar Nieuws
                </a>
              </div>
            </div>

            {/* How it works info */}
            <div class="mb-6 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-5">
              <h3 class="font-bold text-purple-900 mb-2 flex items-center gap-2">
                <i class="fas fa-lightbulb text-purple-600"></i>
                Hoe werkt het?
              </h3>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-purple-800">
                <div class="flex items-start gap-2">
                  <span class="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                  <span>Voer een zoekterm in (bijv. "koorfestival België 2026")</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                  <span>AI doorzoekt het internet en toont relevante resultaten</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                  <span>Selecteer bronnen en laat AI een artikel schrijven met foto</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">4</span>
                  <span>Bewerk, review en publiceer het artikel</span>
                </div>
              </div>
            </div>

            {/* Step 1: Search */}
            <div class="bg-white rounded-xl shadow-md p-6 mb-6" id="step-search">
              <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span class="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                Zoek naar nieuws op het internet
              </h2>
              <p class="text-sm text-gray-500 mb-4">
                AI doorzoekt het web naar actuele informatie over amateurkoren, koorfestivals, koormuziek en meer.
              </p>
              <div class="flex gap-3">
                <input 
                  type="text" 
                  id="searchQuery" 
                  placeholder="bijv. amateurkoor Vlaanderen, koorfestival 2026, koorwedstrijd..."
                  class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-lg"
                  value=""
                />
                <button 
                  onclick="searchNews()"
                  id="searchBtn"
                  class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium flex items-center gap-2"
                >
                  <i class="fas fa-search"></i> Zoeken
                </button>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <span class="text-xs text-gray-400">Suggesties:</span>
                {[
                  'amateurkoor België nieuws',
                  'koorfestival 2026', 
                  'koorcompetitie Vlaanderen', 
                  'gemengd koor concert België',
                  'World Choir Games 2026',
                  'koormuziek trends',
                  'subsidies amateurkunsten Vlaanderen',
                  'Koor&Stem magazine'
                ].map(s => (
                  <button 
                    onclick={`document.getElementById('searchQuery').value='${s}'; searchNews()`}
                    class="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-full hover:bg-purple-100 hover:text-purple-700 transition cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Results */}
            <div id="searchResults" class="hidden mb-6">
              <div class="bg-white rounded-xl shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <span class="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                    Gevonden op het internet
                    <span id="resultCount" class="text-sm font-normal text-gray-500 ml-2"></span>
                  </h2>
                  <div class="flex gap-2">
                    <button onclick="selectAllSources(true)" class="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition">
                      <i class="fas fa-check-double mr-1"></i> Alles selecteren
                    </button>
                    <button onclick="selectAllSources(false)" class="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition">
                      Deselecteren
                    </button>
                  </div>
                </div>
                <div id="resultsList" class="space-y-3"></div>
              </div>
            </div>

            {/* Step 3: Generate Article */}
            <div id="step-generate" class="hidden mb-6">
              <div class="bg-white rounded-xl shadow-md p-6">
                <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <span class="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  Artikel genereren met AI
                </h2>
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Toon / Stijl</label>
                      <select id="articleTone" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                        <option value="informatief">📰 Informatief (standaard nieuwsbericht)</option>
                        <option value="enthousiast">🎉 Enthousiast (feestelijk, wervend)</option>
                        <option value="formeel">📋 Formeel (officieel, zakelijk)</option>
                        <option value="persoonlijk">💬 Persoonlijk (column-stijl, warm)</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Doelgroep / Zichtbaarheid</label>
                      <select id="targetAudience" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                        <option value="publiek">🌍 Publiek (zichtbaar voor iedereen)</option>
                        <option value="leden">🔒 Enkel leden</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Extra instructies (optioneel)</label>
                    <textarea 
                      id="extraInstructions" 
                      rows={2}
                      placeholder="bijv. Maak het relevant voor ons koor Animato, voeg een oproep toe om lid te worden, focus op het competitie-aspect..."
                      class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    ></textarea>
                  </div>
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" id="generateImage" checked class="w-4 h-4 text-green-600 rounded" />
                      <span class="text-sm text-gray-700">🖼️ Genereer een AI-afbeelding bij het artikel</span>
                    </label>
                  </div>
                  <button 
                    onclick="generateArticle()"
                    id="generateBtn"
                    class="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-bold flex items-center justify-center gap-2 text-lg"
                  >
                    <i class="fas fa-magic"></i> Genereer Nieuwsbericht
                  </button>
                </div>
              </div>
            </div>

            {/* Loading State */}
            <div id="loadingState" class="hidden mb-6">
              <div class="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-8 text-center">
                <div class="animate-spin w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full mx-auto mb-4"></div>
                <p class="text-lg font-bold text-gray-900" id="loadingText">Even geduld, AI is aan het nadenken...</p>
                <p class="text-sm text-gray-500 mt-1" id="loadingSubtext">Dit kan tot 30 seconden duren</p>
                <div class="mt-4 w-full bg-gray-200 rounded-full h-2 max-w-md mx-auto">
                  <div id="loadingBar" class="bg-purple-600 h-2 rounded-full transition-all duration-1000" style="width: 10%"></div>
                </div>
              </div>
            </div>

            {/* Step 4: Preview & Edit */}
            <div id="step-preview" class="hidden mb-6">
              <div class="bg-white rounded-xl shadow-md overflow-hidden">
                <div class="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-4 flex items-center justify-between">
                  <h2 class="text-xl font-bold flex items-center gap-2">
                    <span class="w-8 h-8 bg-white text-green-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                    Review & Publiceer
                  </h2>
                  <div class="flex gap-2">
                    <button onclick="regenerateArticle()" class="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition text-sm font-medium">
                      <i class="fas fa-redo mr-1"></i> Opnieuw genereren
                    </button>
                    <button onclick="regenerateImage()" class="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition text-sm font-medium">
                      <i class="fas fa-image mr-1"></i> Nieuwe foto
                    </button>
                  </div>
                </div>
                <div class="p-6">
                  {/* Live Preview Toggle */}
                  <div class="flex gap-2 mb-4">
                    <button onclick="togglePreviewMode('edit')" id="editModeBtn" class="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium">
                      <i class="fas fa-edit mr-1"></i> Bewerken
                    </button>
                    <button onclick="togglePreviewMode('preview')" id="previewModeBtn" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium">
                      <i class="fas fa-eye mr-1"></i> Voorbeeld
                    </button>
                  </div>

                  {/* Edit Mode */}
                  <div id="editMode">
                    {/* Editable Title */}
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Titel</label>
                      <input 
                        type="text" 
                        id="previewTitle" 
                        class="w-full text-2xl font-bold text-gray-900 border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-green-500"
                        style="font-family: 'Playfair Display', serif;"
                      />
                    </div>

                    {/* Editable Excerpt */}
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Samenvatting (verschijnt op overzichtspagina)</label>
                      <textarea 
                        id="previewExcerpt" 
                        rows={2}
                        class="w-full text-gray-600 border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-green-500"
                      ></textarea>
                    </div>

                    {/* Generated Image */}
                    <div class="mb-4" id="imageContainer">
                      <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Afbeelding</label>
                      <div id="imagePreview" class="w-full h-72 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 overflow-hidden relative">
                        <div class="text-center">
                          <i class="fas fa-image text-4xl mb-2"></i>
                          <p class="text-sm">Klik op "Genereer" om een afbeelding te maken</p>
                        </div>
                      </div>
                    </div>

                    {/* Editable Body (HTML) */}
                    <div class="mb-6">
                      <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Inhoud (HTML)</label>
                      <textarea 
                        id="previewBody" 
                        rows={15}
                        class="w-full text-gray-700 leading-relaxed border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 font-mono text-sm"
                      ></textarea>
                    </div>
                  </div>

                  {/* Preview Mode */}
                  <div id="previewMode" class="hidden">
                    <div id="livePreviewContent" class="prose prose-lg max-w-none"></div>
                  </div>

                  {/* Source attribution */}
                  <div id="sourcesBlock" class="mb-6 p-4 bg-gray-50 rounded-lg">
                    <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      <i class="fas fa-link mr-1"></i> Bronvermelding
                    </p>
                    <div id="sourcesList" class="text-sm text-gray-600 space-y-1"></div>
                  </div>

                  {/* Tags */}
                  <div class="mb-4">
                    <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Tags</label>
                    <input 
                      type="text" 
                      id="previewTags" 
                      placeholder="bijv. koorfestival, Vlaanderen, amateurkoren (kommagescheiden)"
                      class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                    />
                  </div>

                  {/* Save Actions */}
                  <div class="flex gap-3 pt-4 border-t border-gray-200">
                    <button 
                      onclick="saveAsDraft()"
                      id="saveDraftBtn"
                      class="flex-1 px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-animato-secondary transition font-bold flex items-center justify-center gap-2"
                    >
                      <i class="fas fa-save"></i> Opslaan als Concept
                    </button>
                    <button 
                      onclick="saveAndPublish()"
                      id="publishBtn"
                      class="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-bold flex items-center justify-center gap-2"
                    >
                      <i class="fas fa-paper-plane"></i> Direct Publiceren
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent AI Articles */}
            {recentAiPosts.length > 0 && (
              <div class="bg-white rounded-xl shadow-md p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <i class="fas fa-history text-gray-500"></i>
                  Recente AI-artikels
                </h3>
                <div class="space-y-2">
                  {recentAiPosts.map((post: any) => (
                    <a href={`/admin/content/${post.id}?type=posts`} class="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition group">
                      <div class="flex items-center gap-3 min-w-0">
                        <i class="fas fa-robot text-purple-400 text-sm"></i>
                        <span class="text-sm font-medium text-gray-900 truncate">{post.titel}</span>
                        <span class={`text-xs px-2 py-0.5 rounded-full ${post.is_published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {post.is_published ? 'Gepubliceerd' : 'Concept'}
                        </span>
                      </div>
                      <span class="text-xs text-gray-400 flex-shrink-0">
                        {new Date(post.created_at).toLocaleDateString('nl-BE')}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      <script dangerouslySetInnerHTML={{__html: `
        let searchResultsData = [];
        let generatedImageUrl = '';
        let currentImagePrompt = '';
        let loadingInterval = null;

        function handleImageError(img) {
          img.parentElement.innerHTML = '<div class="text-center text-red-400 py-8"><i class="fas fa-exclamation-triangle text-2xl mb-2"></i><p class="text-sm">Afbeelding kon niet geladen worden</p></div>';
        }

        // ===== LOADING ANIMATION =====
        function showLoading(text, subtext) {
          document.getElementById('loadingState').classList.remove('hidden');
          document.getElementById('loadingText').textContent = text || 'Even geduld...';
          document.getElementById('loadingSubtext').textContent = subtext || 'Dit kan tot 30 seconden duren';
          
          let progress = 10;
          const bar = document.getElementById('loadingBar');
          clearInterval(loadingInterval);
          bar.style.width = '10%';
          loadingInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 8, 90);
            bar.style.width = progress + '%';
          }, 800);
        }

        function hideLoading() {
          clearInterval(loadingInterval);
          const bar = document.getElementById('loadingBar');
          bar.style.width = '100%';
          setTimeout(() => {
            document.getElementById('loadingState').classList.add('hidden');
            bar.style.width = '10%';
          }, 400);
        }

        // ===== STEP 1: SEARCH =====
        async function searchNews() {
          const query = document.getElementById('searchQuery').value.trim();
          if (!query) {
            alert('Voer een zoekterm in.');
            return;
          }

          const btn = document.getElementById('searchBtn');
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zoeken...';

          // Hide previous results
          document.getElementById('searchResults').classList.add('hidden');
          document.getElementById('step-generate').classList.add('hidden');
          document.getElementById('step-preview').classList.add('hidden');

          showLoading('AI doorzoekt het internet...', 'Relevante bronnen over "' + query + '" worden gezocht');

          try {
            const res = await fetch('/api/admin/ai-news/search', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ query })
            });
            const data = await res.json();

            if (data.error) {
              alert('Fout bij zoeken: ' + data.error);
              return;
            }

            searchResultsData = data.results || [];
            renderResults(searchResultsData);
          } catch (e) {
            alert('Fout bij zoeken: ' + e.message);
          } finally {
            hideLoading();
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-search"></i> Zoeken';
          }
        }

        function renderResults(results) {
          const container = document.getElementById('resultsList');
          const countEl = document.getElementById('resultCount');
          const panel = document.getElementById('searchResults');

          if (results.length === 0) {
            container.innerHTML = '<div class="text-center py-8"><i class="fas fa-search text-4xl text-gray-300 mb-3"></i><p class="text-gray-500 italic">Geen relevante resultaten gevonden. Probeer andere zoektermen.</p></div>';
            countEl.textContent = '';
            panel.classList.remove('hidden');
            return;
          }

          countEl.textContent = '(' + results.length + ' bronnen gevonden)';

          container.innerHTML = results.map((r, idx) => {
            const domain = r.url ? new URL(r.url).hostname.replace('www.', '') : '';
            return '<label class="flex items-start gap-3 p-4 border rounded-lg hover:bg-blue-50 transition cursor-pointer border-blue-100" for="src-' + idx + '">' +
              '<input type="checkbox" id="src-' + idx + '" class="source-checkbox mt-1 w-4 h-4 text-blue-600 rounded" data-idx="' + idx + '" checked />' +
              '<div class="flex-1 min-w-0">' +
                '<div class="font-semibold text-gray-900 text-sm">' + escapeHtml(r.title) + '</div>' +
                '<p class="text-sm text-gray-600 mt-1">' + escapeHtml(r.snippet || '') + '</p>' +
                '<div class="flex items-center gap-2 mt-2">' +
                  '<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">' + escapeHtml(domain) + '</span>' +
                  (r.url ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener" class="text-xs text-blue-500 hover:underline"><i class="fas fa-external-link-alt mr-1"></i>Bekijk bron</a>' : '') +
                '</div>' +
              '</div>' +
            '</label>';
          }).join('');

          panel.classList.remove('hidden');
          document.getElementById('step-generate').classList.remove('hidden');

          // Scroll to results
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function selectAllSources(select) {
          document.querySelectorAll('.source-checkbox').forEach(cb => {
            cb.checked = select;
          });
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text || '';
          return div.innerHTML;
        }

        // ===== STEP 3: GENERATE ARTICLE =====
        async function generateArticle() {
          const checkedBoxes = document.querySelectorAll('.source-checkbox:checked');
          if (checkedBoxes.length === 0) {
            alert('Selecteer minstens één bron om een artikel te genereren.');
            return;
          }

          const sources = Array.from(checkedBoxes).map(cb => {
            const idx = parseInt(cb.dataset.idx);
            return searchResultsData[idx];
          }).filter(Boolean);

          const extra = document.getElementById('extraInstructions').value;
          const audience = document.getElementById('targetAudience').value;
          const tone = document.getElementById('articleTone').value;
          const wantImage = document.getElementById('generateImage').checked;
          const query = document.getElementById('searchQuery').value;

          document.getElementById('step-generate').classList.add('hidden');
          showLoading('AI schrijft het artikel...', 'Bezig met het analyseren van ' + sources.length + ' bron(nen)');

          try {
            const res = await fetch('/api/admin/ai-news/generate', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ sources, extra, audience, tone, query })
            });
            const data = await res.json();

            if (data.error) {
              alert('Fout bij genereren: ' + data.error);
              document.getElementById('step-generate').classList.remove('hidden');
              return;
            }

            // Fill preview
            document.getElementById('previewTitle').value = data.title || '';
            document.getElementById('previewExcerpt').value = data.excerpt || '';
            document.getElementById('previewBody').value = data.body || '';
            document.getElementById('previewTags').value = (data.tags || []).join(', ');
            currentImagePrompt = data.imagePrompt || '';
            
            // Sources
            const sourcesList = document.getElementById('sourcesList');
            sourcesList.innerHTML = sources.map(s => 
              '<div class="flex items-center gap-2">' +
                '<i class="fas fa-link text-gray-400 text-xs"></i>' +
                (s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" class="text-blue-600 hover:underline">' + escapeHtml(s.title) + '</a>' : '<span>' + escapeHtml(s.title) + '</span>') +
              '</div>'
            ).join('');

            hideLoading();
            document.getElementById('step-generate').classList.remove('hidden');
            document.getElementById('step-preview').classList.remove('hidden');

            // Scroll to preview
            document.getElementById('step-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Generate image in background if wanted
            if (wantImage && currentImagePrompt) {
              generateImage(data.title, currentImagePrompt);
            }

          } catch (e) {
            hideLoading();
            alert('Fout: ' + e.message);
            document.getElementById('step-generate').classList.remove('hidden');
          }
        }

        // ===== IMAGE GENERATION =====
        async function generateImage(title, imagePrompt) {
          const preview = document.getElementById('imagePreview');
          preview.innerHTML = '<div class="text-center py-8"><div class="animate-spin w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full mx-auto mb-3"></div><p class="text-sm text-gray-500 font-medium">AI genereert een afbeelding...</p><p class="text-xs text-gray-400 mt-1">Dit kan 15-30 seconden duren</p></div>';

          try {
            const res = await fetch('/api/admin/ai-news/image', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ title, imagePrompt })
            });
            const data = await res.json();

            if (data.imageUrl) {
              generatedImageUrl = data.imageUrl;
              preview.innerHTML = '<img src="' + data.imageUrl + '" class="w-full h-full object-cover rounded-lg" alt="AI-gegenereerde afbeelding" onerror="handleImageError(this)" />' +
                '<div class="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded"><i class="fas fa-robot mr-1"></i>AI Generated</div>';
            } else {
              preview.innerHTML = '<div class="text-center text-gray-400 py-8"><i class="fas fa-image text-3xl mb-2"></i><p class="text-sm">' + (data.error || 'Geen afbeelding gegenereerd') + '</p><button onclick="regenerateImage()" class="mt-2 text-purple-600 hover:underline text-sm">Opnieuw proberen</button></div>';
            }
          } catch (e) {
            preview.innerHTML = '<div class="text-center text-red-400 py-8"><i class="fas fa-exclamation-triangle text-2xl mb-2"></i><p class="text-sm">Afbeelding generatie mislukt: ' + escapeHtml(e.message) + '</p><button onclick="regenerateImage()" class="mt-2 text-purple-600 hover:underline text-sm">Opnieuw proberen</button></div>';
          }
        }

        function regenerateImage() {
          const title = document.getElementById('previewTitle').value;
          generateImage(title, currentImagePrompt || title);
        }

        function regenerateArticle() {
          document.getElementById('step-preview').classList.add('hidden');
          generateArticle();
        }

        // ===== PREVIEW MODE =====
        function togglePreviewMode(mode) {
          const editMode = document.getElementById('editMode');
          const previewMode = document.getElementById('previewMode');
          const editBtn = document.getElementById('editModeBtn');
          const previewBtn = document.getElementById('previewModeBtn');

          if (mode === 'preview') {
            editMode.classList.add('hidden');
            previewMode.classList.remove('hidden');
            editBtn.className = 'px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium';
            previewBtn.className = 'px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium';

            // Render preview
            const title = document.getElementById('previewTitle').value;
            const excerpt = document.getElementById('previewExcerpt').value;
            const body = document.getElementById('previewBody').value;
            const img = generatedImageUrl ? '<img src="' + generatedImageUrl + '" class="w-full rounded-xl mb-6 shadow-lg" alt="" />' : '';
            
            document.getElementById('livePreviewContent').innerHTML = 
              '<h1 style="font-family: Playfair Display, serif;" class="text-3xl font-bold mb-4">' + escapeHtml(title) + '</h1>' +
              '<p class="text-lg text-gray-500 italic mb-6">' + escapeHtml(excerpt) + '</p>' +
              img +
              '<div class="prose-content">' + body + '</div>';
          } else {
            editMode.classList.remove('hidden');
            previewMode.classList.add('hidden');
            editBtn.className = 'px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium';
            previewBtn.className = 'px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium';
          }
        }

        // ===== STEP 4: SAVE =====
        async function saveAsDraft() { await saveArticle(false); }
        async function saveAndPublish() { await saveArticle(true); }

        async function saveArticle(publish) {
          const title = document.getElementById('previewTitle').value;
          const excerpt = document.getElementById('previewExcerpt').value;
          const body = document.getElementById('previewBody').value;
          const audience = document.getElementById('targetAudience').value;
          const tags = document.getElementById('previewTags').value;

          if (!title || !body) {
            alert('Titel en inhoud zijn verplicht.');
            return;
          }

          const btn = publish ? document.getElementById('publishBtn') : document.getElementById('saveDraftBtn');
          const originalHtml = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Opslaan...';

          try {
            const res = await fetch('/api/admin/ai-news/save', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ title, excerpt, body, audience, publish, imageUrl: generatedImageUrl, tags })
            });
            const data = await res.json();

            if (data.error) {
              alert('Fout bij opslaan: ' + data.error);
              return;
            }

            // Success notification
            const msg = publish ? 'Artikel is gepubliceerd!' : 'Artikel is opgeslagen als concept.';
            if (confirm(msg + '\\n\\nWil je het artikel bekijken?')) {
              window.location.href = '/admin/content/' + data.postId + '?success=' + (publish ? 'published' : 'created') + '&type=posts';
            }
          } catch (e) {
            alert('Fout: ' + e.message);
          } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
          }
        }

        // Enter key on search
        document.getElementById('searchQuery').addEventListener('keypress', function(e) {
          if (e.key === 'Enter') searchNews();
        });
      `}} />
    </Layout>
  )
})

// =====================================================
// API: Search for news using AI with web search grounding
// =====================================================
app.post('/api/admin/ai-news/search', async (c) => {
  const user = c.get('user') as SessionUser
  const { query } = await c.req.json()

  if (!query) return c.json({ error: 'Zoekterm is verplicht' }, 400)

  try {
    // Use REAL web search — no LLM hallucination
    const enrichedQuery = `${query} koor muziek amateurkoor`
    const results = await webSearch(enrichedQuery, 10)

    if (results.length === 0) {
      // Fallback: try a broader search
      const fallbackResults = await webSearch(query, 10)
      return c.json({ results: fallbackResults })
    }

    return c.json({ results })
  } catch (e: any) {
    console.error('Search error:', e)
    return c.json({ error: e.message || 'Onbekende fout bij zoeken' }, 500)
  }
})

// =====================================================
// API: Generate article from sources using AI
// =====================================================
app.post('/api/admin/ai-news/generate', async (c) => {
  const user = c.get('user') as SessionUser
  const { sources, extra, audience, tone, query } = await c.req.json()

  if (!sources || sources.length === 0) return c.json({ error: 'Geen bronnen geselecteerd' }, 400)

  try {
    const sourceSummary = sources.map((s: any, i: number) =>
      `Bron ${i + 1}: "${s.title}" — ${s.snippet} (${s.url || 'geen URL'})`
    ).join('\n')

    const toneInstructions: Record<string, string> = {
      informatief: 'Schrijf in een informatieve, nieuwswaardige toon. Objectief maar toegankelijk.',
      enthousiast: 'Schrijf enthousiast en wervend. Gebruik een feestelijke, positieve toon die mensen inspireert.',
      formeel: 'Schrijf formeel en zakelijk. Geschikt voor officiële communicatie.',
      persoonlijk: 'Schrijf in een warme, persoonlijke column-stijl. Alsof je direct tegen de lezer praat.'
    }

    const prompt = `Je bent de communicatieverantwoordelijke van Gemengd Koor Animato, een enthousiast amateurkoor gevestigd in Oppuurs (Klein-Brabant), België. Het koor zingt een breed repertoire van klassiek tot pop onder leiding van dirigent Frank.

OPDRACHT: Schrijf een professioneel nieuwsbericht voor de website van het koor op basis van deze bronnen:

${sourceSummary}

OORSPRONKELIJKE ZOEKTERM: "${query}"

STIJL: ${toneInstructions[tone || 'informatief'] || toneInstructions.informatief}

RICHTLIJNEN:
- Schrijf in het Nederlands (Belgisch/Vlaams)
- Lengte: 400-600 woorden
- Structuur: pakkende inleiding, kern (2-3 alinea's met inhoud), afsluiting met call-to-action
- Maak het relevant voor koorleden en koormuziekliefhebbers
- Verwijs waar passend naar hoe dit relevant is voor Animato of amateurkoren in het algemeen
- Voeg eventueel een quote of pakkende zin toe
- ${audience === 'leden' ? 'Dit bericht is voor leden — je mag interne referenties maken naar repetities, stemgroepen, etc.' : 'Dit is een publiek bericht — ook voor niet-leden leesbaar. Vermeld kort wie Animato is.'}
${extra ? `\nEXTRA INSTRUCTIES VAN DE REDACTIE: ${extra}` : ''}

FORMAAT VAN JE ANTWOORD (pure JSON, geen markdown):
{
  "title": "Pakkende, informatieve titel (max 80 karakters)",
  "excerpt": "Korte samenvatting in 1-2 zinnen voor de overzichtspagina",
  "body": "Het volledige artikel als HTML. Gebruik: <p>, <h3>, <strong>, <em>, <a href=''>, <blockquote>, <ul>, <li>. Geen <h1> of <h2> (die komen automatisch van de titel).",
  "tags": ["tag1", "tag2", "tag3"],
  "imagePrompt": "Gedetailleerde Engelstalige beschrijving voor AI image generation. Beschrijf een sfeervolle, warme foto die past bij dit artikel. Denk aan: koor dat zingt, concertzaal, muzieknoten, repetitielokaal, dirigent, etc. Stijl: warm, professioneel, editorial photography."
}`

    const content = await callAI(c.env, [
      { role: 'system', content: 'Je bent een professionele Nederlandstalige contentschrijver voor een Belgisch amateurkoor. Antwoord uitsluitend in pure JSON zonder markdown formatting.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.7, max_tokens: 4000 })

    let article: any = {}
    try {
      article = parseLLMJson(content)
    } catch (e) {
      console.error('JSON parse error for article:', content)
      return c.json({ error: 'AI gaf een ongeldig antwoord. Probeer opnieuw.' }, 500)
    }

    return c.json(article)
  } catch (e: any) {
    console.error('Generate error:', e)
    return c.json({ error: e.message || 'Onbekende fout bij genereren' }, 500)
  }
})

// =====================================================
// API: Generate image for article using AI
// =====================================================
app.post('/api/admin/ai-news/image', async (c) => {
  const user = c.get('user') as SessionUser
  const { title, imagePrompt } = await c.req.json()

  try {
    const prompt = imagePrompt || `A warm, professional editorial photo related to: ${title}. Amateur choir, singing, music, concert hall.`

    // Try Cloudflare Workers AI image generation (free)
    if (c.env.AI) {
      try {
        const result = await c.env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
          prompt: `Professional editorial photograph, warm lighting, high quality: ${prompt}. Style: realistic photography, not illustration.`,
          num_steps: 20
        })
        
        if (result) {
          // Workers AI returns raw image bytes - convert to base64 data URL
          const base64 = btoa(String.fromCharCode(...new Uint8Array(result)))
          return c.json({ imageUrl: `data:image/png;base64,${base64}` })
        }
      } catch (imgErr: any) {
        console.error('Workers AI image generation failed:', imgErr.message)
      }
    }

    // Fallback: Use curated Unsplash images based on search query
    const searchTerms = (title || 'choir music').replace(/[^a-zA-Z0-9\s]/g, '').split(' ').slice(0, 3).join('+')
    const unsplashImages = [
      'photo-1507838153414-b4b713384a76', // choir/music
      'photo-1514320291840-2e0a9bf2a9ae', // concert hall
      'photo-1493225457124-a3eb161ffa5f', // audience
      'photo-1460723237483-7a6dc9d0b212', // piano/music
      'photo-1511671782779-c97d3d27a1d4', // singing/music
    ]
    const idx = Math.floor(Math.random() * unsplashImages.length)
    const fallbackUrl = `https://images.unsplash.com/${unsplashImages[idx]}?w=800&h=400&fit=crop&auto=format`

    return c.json({ imageUrl: fallbackUrl, fallback: true })
  } catch (e: any) {
    console.error('Image error:', e)
    return c.json({ error: e.message || 'Afbeelding generatie mislukt' }, 500)
  }
})

// =====================================================
// API: Save generated article as post
// =====================================================
app.post('/api/admin/ai-news/save', async (c) => {
  const user = c.get('user') as SessionUser
  const { title, excerpt, body, audience, publish, imageUrl, tags } = await c.req.json()

  if (!title || !body) return c.json({ error: 'Titel en inhoud zijn verplicht' }, 400)

  try {
    // Generate slug
    const slug = title.toString().toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36)

    const now = new Date().toISOString()
    const publishedValue = publish ? 1 : 0

    // Prepend image if available
    let finalBody = body
    if (imageUrl) {
      finalBody = `<figure class="mb-6"><img src="${imageUrl}" alt="${title.replace(/"/g, '&quot;')}" class="w-full rounded-lg shadow-md" /><figcaption class="text-xs text-gray-400 mt-1 text-center"><i class="fas fa-robot mr-1"></i>AI-gegenereerde afbeelding</figcaption></figure>\n\n${body}`
    }

    // Add AI-generated badge at bottom
    finalBody += '\n\n<p class="text-xs text-gray-400 italic mt-8 pt-4 border-t border-gray-200"><i class="fas fa-robot mr-1"></i> Dit artikel werd gegenereerd met behulp van AI en geredigeerd door de redactie van Animato.</p>'

    // Parse tags
    let tagsJson: string | null = null
    if (tags) {
      const tagList = typeof tags === 'string' 
        ? tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : Array.isArray(tags) ? tags : []
      if (tagList.length > 0) {
        tagsJson = JSON.stringify(tagList)
      }
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO posts (
        type, categorie, titel, slug, excerpt, body, tags, zichtbaarheid, 
        is_published, is_pinned, auteur_id, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      'nieuws',
      'algemeen',
      title,
      slug,
      excerpt || null,
      finalBody,
      tagsJson,
      audience || 'publiek',
      publishedValue,
      0,
      user.id,
      now,
      publishedValue === 1 ? now : null
    ).run()

    // Audit log
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, actie, entity_type, entity_id, meta)
         VALUES (?, 'ai_news_create', 'post', ?, ?)`
      ).bind(user.id, result.meta.last_row_id, JSON.stringify({ 
        title, 
        ai_generated: true, 
        published: publish,
        audience 
      })).run()
    } catch (auditErr) {
      console.error('Audit log error (non-fatal):', auditErr)
    }

    return c.json({ postId: result.meta.last_row_id, success: true })
  } catch (e: any) {
    console.error('Save error:', e)
    return c.json({ error: e.message || 'Opslaan mislukt' }, 500)
  }
})

export default app
