// Layout component met Animato branding
// Base HTML structure met navigation, header, footer

import type { FC } from 'hono/jsx'

interface LayoutProps {
  title?: string
  description?: string
  children: any
  user?: { voornaam: string; achternaam: string; role: string } | null
  currentPath?: string
  impersonating?: boolean
}

export const Layout: FC<LayoutProps> = ({ 
  title = 'Gemengd Koor Animato', 
  description = 'Koor met passie',
  children,
  user = null,
  currentPath = '/',
  impersonating = false
}) => {
  const fullTitle = title === 'Gemengd Koor Animato' ? title : `${title} | Gemengd Koor Animato`

  return (
    <html lang="nl">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{fullTitle}</title>
        <meta name="description" content={description} />
        
        {/* Animato branding colors */}
        <meta name="theme-color" content="#00A9CE" />
        
        {/* Tailwind CSS */}
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{
          __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    'animato-primary': '#00A9CE',
                    'animato-secondary': '#1B4D5C',
                    'animato-accent': '#F59E0B',
                  }
                }
              }
            }
          `
        }} />
        
        {/* Font Awesome Icons */}
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        
        {/* Google Fonts - Playfair Display & Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
        
        {/* Custom CSS */}
        <link href="/static/css/styles.css" rel="stylesheet" />
        
        {/* Shepherd.js - Walkthrough Tours */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/css/shepherd.css" />
        <script src="https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/js/shepherd.min.js"></script>
        
        {/* Favicon - placeholder */}
        <link rel="icon" type="image/svg+xml" href="/static/images/favicon.svg" />
      </head>
      
      <body class="font-sans bg-gray-50 text-gray-900" style="font-family: 'Inter', sans-serif;">
        {/* Impersonate Banner */}
        {impersonating && (
          <div class="bg-orange-500 text-white py-2 px-4 text-center text-sm font-semibold sticky top-0 z-[100] shadow-lg">
            <i class="fas fa-user-secret mr-2"></i>
            Je bekijkt de site als <strong>{user?.voornaam} {user?.achternaam}</strong> (lid-weergave)
            <a href="/leden/stop-impersonate" class="ml-4 bg-white text-orange-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-orange-100 transition">
              <i class="fas fa-sign-out-alt mr-1"></i> Terug naar admin
            </a>
          </div>
        )}
        {/* Header */}
        <header class="bg-white shadow-sm sticky top-0 z-50">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between items-center h-16">
              {/* Logo */}
              <div class="flex items-center">
                <a href="/" class="flex items-center space-x-3">
                  <div class="text-animato-primary text-3xl">
                    <i class="fas fa-music"></i>
                  </div>
                  <div>
                    <div class="text-xl font-bold text-animato-primary" style="font-family: 'Playfair Display', serif;">
                      Animato
                    </div>
                    <div class="text-xs text-animato-secondary -mt-1">
                      koor met passie
                    </div>
                  </div>
                </a>
              </div>

              {/* Desktop Navigation */}
              <nav class="hidden md:flex items-center space-x-8">
                <a href="/" class={`hover:text-animato-primary transition ${currentPath === '/' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Home
                </a>
                <a href="/koor" class={`hover:text-animato-primary transition ${currentPath === '/koor' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Over Ons
                </a>
                <a href="/nieuws" class={`hover:text-animato-primary transition ${currentPath === '/nieuws' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Nieuws
                </a>
                <a href="/agenda" class={`hover:text-animato-primary transition ${currentPath === '/agenda' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Agenda
                </a>
                <a href="/concerten" class={`hover:text-animato-primary transition ${currentPath === '/concerten' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Concerten
                </a>
                <a href="/fotoboek" class={`hover:text-animato-primary transition ${currentPath === '/fotoboek' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Foto's
                </a>
                <a href="/contact" class={`hover:text-animato-primary transition ${currentPath === '/contact' ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}>
                  Contact
                </a>
              </nav>

              {/* Auth Buttons */}
              <div class="flex items-center space-x-4">
                {user ? (
                  <>
                    {/* Admin link (only for admin/moderator) */}
                    {(user.role === 'admin' || user.role === 'moderator') && (
                      <a href="/admin" class="hidden md:block text-gray-700 hover:text-animato-primary transition">
                        <i class="fas fa-shield-alt mr-2"></i>
                        Admin
                      </a>
                    )}
                    {/* Leden portal link */}
                    <a href="/leden" class="hidden md:block text-gray-700 hover:text-animato-primary transition">
                      <i class="fas fa-user-circle mr-2"></i>
                      {user.voornaam}
                    </a>
                    {/* Uitloggen - Desktop only (hidden on mobile to prevent accidental clicks) */}
                    <a href="/api/auth/logout" class="hidden md:block text-sm text-gray-600 hover:text-gray-900">
                      Uitloggen
                    </a>
                  </>
                ) : (
                  <>
                    <a href="/word-lid" class="hidden md:block bg-animato-accent text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition font-semibold">
                      Word Lid
                    </a>
                    {/* Login link - visible on both mobile and desktop */}
                    <a href="/login" class="text-animato-primary hover:text-animato-secondary transition font-medium">
                      <i class="fas fa-sign-in-alt mr-1"></i>
                      <span class="hidden sm:inline">Login</span>
                      <span class="sm:hidden">Login</span>
                    </a>
                  </>
                )}
                
                {/* Mobile menu button */}
                <button id="mobile-menu-button" class="md:hidden text-gray-700 hover:text-animato-primary">
                  <i class="fas fa-bars text-xl"></i>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Navigation */}
          <div id="mobile-menu" class="hidden md:hidden border-t border-gray-200">
            <div class="px-4 py-4 space-y-3">
              <a href="/" class="block text-gray-700 hover:text-animato-primary">Home</a>
              <a href="/koor" class="block text-gray-700 hover:text-animato-primary">Over Ons</a>
              <a href="/nieuws" class="block text-gray-700 hover:text-animato-primary">Nieuws</a>
              <a href="/agenda" class="block text-gray-700 hover:text-animato-primary">Agenda</a>
              <a href="/concerten" class="block text-gray-700 hover:text-animato-primary">Concerten</a>
              <a href="/fotoboek" class="block text-gray-700 hover:text-animato-primary">Foto's</a>
              <a href="/contact" class="block text-gray-700 hover:text-animato-primary">Contact</a>
              
              {user ? (
                <>
                  {/* Admin link in mobile menu */}
                  {(user.role === 'admin' || user.role === 'moderator') && (
                    <a href="/admin" class="block text-gray-700 hover:text-animato-primary">
                      <i class="fas fa-shield-alt mr-2"></i>
                      Admin Panel
                    </a>
                  )}
                  {/* Leden portal link in mobile menu */}
                  <a href="/leden" class="block text-gray-700 hover:text-animato-primary">
                    <i class="fas fa-user-circle mr-2"></i>
                    Mijn Profiel
                  </a>
                  {/* Divider */}
                  <div class="border-t border-gray-300 my-2"></div>
                  {/* Uitloggen link in mobile menu (safer placement to avoid accidental clicks) */}
                  <a href="/api/auth/logout" class="block text-red-600 hover:text-red-700 font-medium">
                    <i class="fas fa-sign-out-alt mr-2"></i>
                    Uitloggen
                  </a>
                </>
              ) : (
                <>
                  {/* Login and Word Lid in mobile menu for non-authenticated users */}
                  <div class="border-t border-gray-300 my-2"></div>
                  <a href="/login" class="block text-animato-primary hover:text-animato-secondary font-medium">
                    <i class="fas fa-sign-in-alt mr-2"></i>
                    Inloggen
                  </a>
                  <a href="/word-lid" class="block bg-animato-accent text-white px-4 py-2 rounded-lg text-center font-semibold mt-2">
                    <i class="fas fa-user-plus mr-2"></i>
                    Word Lid
                  </a>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main>
          {children}
        </main>

        {/* Footer */}
        <footer class="bg-animato-secondary text-white mt-16">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
              {/* Over Animato */}
              <div>
                <h3 class="text-lg font-bold mb-4" style="font-family: 'Playfair Display', serif;">
                  Gemengd Koor Animato
                </h3>
                <p class="text-gray-300 text-sm">
                  Koor met passie. Samen musiceren, samen groeien, samen genieten van prachtige muziek.
                </p>
              </div>

              {/* Snelle Links */}
              <div>
                <h3 class="text-lg font-semibold mb-4">Snelle Links</h3>
                <ul class="space-y-2 text-sm">
                  <li><a href="/koor" class="text-gray-300 hover:text-white transition">Over Ons</a></li>
                  <li><a href="/word-lid" class="text-gray-300 hover:text-white transition">Word Lid</a></li>
                  <li><a href="/agenda" class="text-gray-300 hover:text-white transition">Agenda</a></li>
                  <li><a href="/concerten" class="text-gray-300 hover:text-white transition">Concerten</a></li>
                </ul>
              </div>

              {/* Contact */}
              <div>
                <h3 class="text-lg font-semibold mb-4">Contact</h3>
                <ul class="space-y-2 text-sm text-gray-300">
                  <li><i class="fas fa-envelope mr-2"></i><a href="mailto:gemengdkooranimato@gmail.com" class="hover:text-white transition">gemengdkooranimato@gmail.com</a></li>
                  <li><i class="fas fa-map-marker-alt mr-2"></i>Zaal De Sopper, Oppuursdorp 15<br/><span class="ml-5">2890 Oppuurs</span></li>
                </ul>
              </div>

              {/* Social Media */}
              <div>
                <h3 class="text-lg font-semibold mb-4">Volg Ons</h3>
                <div class="flex space-x-4">
                  <a href="https://www.facebook.com/GemengdkoorAnimato" target="_blank" rel="noopener" aria-label="Facebook" class="text-2xl text-gray-300 hover:text-white transition">
                    <i class="fab fa-facebook"></i>
                  </a>
                  <a href="https://www.youtube.com/@GemengdkoorAnimato" target="_blank" rel="noopener" aria-label="YouTube" class="text-2xl text-gray-300 hover:text-white transition">
                    <i class="fab fa-youtube"></i>
                  </a>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-600 mt-8 pt-8 text-center text-sm text-gray-400">
              <p>&copy; {new Date().getFullYear()} Gemengd Koor Animato. Alle rechten voorbehouden.</p>
              <div class="mt-2 space-x-4">
                <a href="/privacy" class="hover:text-white transition">Privacy</a>
                <span>•</span>
                <a href="/cookies" class="hover:text-white transition">Cookies</a>
                <span>•</span>
                <a href="/contact" class="hover:text-white transition">Contact</a>
              </div>
            </div>
          </div>
        </footer>

        {/* Custom JS - includes mobile menu handler */}
        <script src="/static/js/app.js"></script>
        
        {/* Walkthrough Tours */}
        <script src="/static/walkthrough.js"></script>

        {/* Beta Feedback Bubble */}
        <div id="beta-bubble-container" class="fixed bottom-6 right-6 z-50 hidden">
            <button id="beta-bubble-btn" class="bg-animato-accent text-white p-4 rounded-full shadow-lg hover:bg-yellow-600 transition flex items-center justify-center w-14 h-14">
                <i class="fas fa-bug text-xl"></i>
            </button>
            <div id="beta-popup" class="absolute bottom-16 right-0 bg-white rounded-xl shadow-2xl w-96 border border-gray-200 hidden overflow-hidden" style="max-height: 85vh;">
                {/* Header */}
                <div class="flex justify-between items-center px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 class="font-bold text-gray-900 text-sm"><i class="fas fa-bug text-animato-accent mr-1.5"></i>Beta Feedback</h3>
                    <button id="beta-close" class="text-gray-400 hover:text-gray-600 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-200 transition"><i class="fas fa-times text-xs"></i></button>
                </div>
                {/* Tabs */}
                <div class="flex border-b border-gray-100">
                    <button id="tab-submit" onclick="switchBetaTab('submit')" class="flex-1 py-2 text-xs font-semibold text-animato-primary border-b-2 border-animato-primary bg-white transition">
                        <i class="fas fa-paper-plane mr-1"></i> Versturen
                    </button>
                    <button id="tab-mine" onclick="switchBetaTab('mine')" class="flex-1 py-2 text-xs font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 bg-white transition">
                        <i class="fas fa-list mr-1"></i> Mijn Feedback
                    </button>
                </div>

                {/* Tab: Submit */}
                <div id="beta-tab-submit" class="p-4">
                    <p class="text-xs text-gray-500 mb-3">Spoor je een bug op of heb je een idee? Laat het ons weten!</p>
                    <form id="beta-form" onsubmit="submitBetaFeedback(event)">
                        <div class="mb-2">
                            <select name="type" class="w-full text-sm border border-gray-200 rounded-lg p-2 bg-gray-50 focus:ring-2 focus:ring-animato-primary focus:border-transparent">
                                <option value="bug">🐛 Bug Melden</option>
                                <option value="feature">💡 Idee / Feature</option>
                                <option value="other">📝 Anders</option>
                            </select>
                        </div>
                        <div class="mb-2">
                            <textarea name="message" rows={4} class="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:ring-2 focus:ring-animato-primary focus:border-transparent resize-none" placeholder="Beschrijf het probleem of jouw idee..." required></textarea>
                        </div>
                        {/* Screenshot plakzone */}
                        <div class="mb-3">
                            <div id="screenshot-zone"
                                class="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center text-xs text-gray-400 cursor-pointer hover:border-animato-primary hover:text-animato-primary transition relative"
                                title="Klik of plak een screenshot (Ctrl+V)">
                                <i class="fas fa-image mr-1"></i>
                                Screenshot plakken <span class="font-mono bg-gray-100 px-1 rounded text-gray-500">Ctrl+V</span> of klik
                                <input type="file" id="screenshot-file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer" />
                            </div>
                            <div id="screenshot-preview" class="hidden mt-2 relative">
                                <img id="screenshot-img" class="w-full rounded border max-h-32 object-contain" src="" alt="Screenshot preview" />
                                <button type="button" onclick="clearScreenshot()" class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-600">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-animato-primary text-white text-sm font-bold py-2.5 rounded-lg hover:bg-animato-secondary transition">
                            <i class="fas fa-paper-plane mr-1"></i> Versturen
                        </button>
                    </form>
                </div>

                {/* Tab: My Feedback */}
                <div id="beta-tab-mine" class="hidden">
                    {/* Filter bar */}
                    <div id="my-feedback-filters" class="hidden px-3 py-2 border-b border-gray-100 bg-gray-50/80 flex gap-1.5 overflow-x-auto" style="scrollbar-width:none;">
                        <button onclick="filterFeedback('all')" data-filter="all" class="fb-filter-btn active shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-animato-primary text-white border-animato-primary">Alles</button>
                        <button onclick="filterFeedback('open')" data-filter="open" class="fb-filter-btn shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600">Open</button>
                        <button onclick="filterFeedback('hertesten')" data-filter="hertesten" class="fb-filter-btn shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600">Hertesten</button>
                        <button onclick="filterFeedback('meer_info_nodig')" data-filter="meer_info_nodig" class="fb-filter-btn shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-white text-gray-500 border-gray-200 hover:border-orange-300 hover:text-orange-600">Info nodig</button>
                        <button onclick="filterFeedback('in_progress')" data-filter="in_progress" class="fb-filter-btn shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-white text-gray-500 border-gray-200 hover:border-yellow-300 hover:text-yellow-600">In behandeling</button>
                        <button onclick="filterFeedback('resolved')" data-filter="resolved" class="fb-filter-btn shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition bg-white text-gray-500 border-gray-200 hover:border-green-300 hover:text-green-600">Opgelost</button>
                    </div>
                    <div id="my-feedback-loading" class="p-6 text-center text-gray-400 text-sm">
                        <i class="fas fa-spinner fa-spin mr-2"></i> Laden...
                    </div>
                    <div id="my-feedback-list" class="hidden overflow-y-auto" style="max-height: 380px;"></div>
                    <div id="my-feedback-empty" class="hidden p-6 text-center">
                        <i class="fas fa-inbox text-3xl text-gray-200 mb-2 block"></i>
                        <p class="text-sm text-gray-400">Je hebt nog geen feedback ingediend.</p>
                    </div>
                    {/* Conversation detail view (replaces list when opened) */}
                    <div id="my-feedback-detail" class="hidden">
                        <button onclick="closeFeedbackDetail()" class="flex items-center gap-1 text-xs text-animato-primary font-semibold px-4 pt-3 hover:underline">
                            <i class="fas fa-arrow-left"></i> Terug naar overzicht
                        </button>
                        <div id="my-feedback-detail-header" class="px-4 py-2 border-b border-gray-100"></div>
                        <div id="my-feedback-detail-messages" class="overflow-y-auto px-4 py-2 space-y-2" style="max-height: 260px;"></div>
                        <div class="px-4 py-3 border-t border-gray-100">
                            <div class="flex gap-2">
                                <input
                                    type="text"
                                    id="my-feedback-reply-input"
                                    placeholder="Reageer of geef meer info..."
                                    class="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendUserComment()}"
                                />
                                <button
                                    onclick="sendUserComment()"
                                    class="px-3 py-2 bg-animato-primary text-white text-xs font-semibold rounded-lg hover:bg-animato-secondary transition"
                                >
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <script dangerouslySetInnerHTML={{__html: `
            let betaScreenshotData = null;
            let betaFeedbackLoaded = false;

            (async function() {
                try {
                    const res = await fetch('/api/system/beta-status');
                    const data = await res.json();
                    if (data.enabled) {
                        const container = document.getElementById('beta-bubble-container');
                        const btn = document.getElementById('beta-bubble-btn');
                        const popup = document.getElementById('beta-popup');
                        const close = document.getElementById('beta-close');
                        const zone = document.getElementById('screenshot-zone');
                        const fileInput = document.getElementById('screenshot-file');

                        container.classList.remove('hidden');
                        btn.onclick = () => {
                            popup.classList.toggle('hidden');
                        };
                        close.onclick = () => {
                            popup.classList.add('hidden');
                            clearScreenshot();
                        };

                        // Paste event (Ctrl+V anywhere in popup)
                        popup.addEventListener('paste', function(e) {
                            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                            for (const item of items) {
                                if (item.type.startsWith('image/')) {
                                    e.preventDefault();
                                    const blob = item.getAsFile();
                                    loadScreenshot(blob);
                                    break;
                                }
                            }
                        });

                        // Also listen for global paste when popup is open
                        document.addEventListener('paste', function(e) {
                            if (popup.classList.contains('hidden')) return;
                            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                            for (const item of items) {
                                if (item.type.startsWith('image/')) {
                                    e.preventDefault();
                                    const blob = item.getAsFile();
                                    loadScreenshot(blob);
                                    break;
                                }
                            }
                        });

                        // File input (click to upload)
                        if (fileInput) fileInput.addEventListener('change', function(e) {
                            const file = e.target.files[0];
                            if (file) loadScreenshot(file);
                        });

                        // Drag & drop
                        if (zone) {
                            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('border-animato-primary'); });
                            zone.addEventListener('dragleave', () => zone.classList.remove('border-animato-primary'));
                            zone.addEventListener('drop', (e) => {
                                e.preventDefault();
                                zone.classList.remove('border-animato-primary');
                                const file = e.dataTransfer.files[0];
                                if (file && file.type.startsWith('image/')) loadScreenshot(file);
                            });
                        }
                    }
                } catch(e) { console.error('Beta status check failed', e); }
            })();

            function switchBetaTab(tab) {
                const submitTab = document.getElementById('beta-tab-submit');
                const mineTab = document.getElementById('beta-tab-mine');
                const btnSubmit = document.getElementById('tab-submit');
                const btnMine = document.getElementById('tab-mine');

                if (tab === 'submit') {
                    submitTab.classList.remove('hidden');
                    mineTab.classList.add('hidden');
                    btnSubmit.classList.add('text-animato-primary', 'border-animato-primary');
                    btnSubmit.classList.remove('text-gray-500', 'border-transparent');
                    btnMine.classList.remove('text-animato-primary', 'border-animato-primary');
                    btnMine.classList.add('text-gray-500', 'border-transparent');
                } else {
                    submitTab.classList.add('hidden');
                    mineTab.classList.remove('hidden');
                    btnMine.classList.add('text-animato-primary', 'border-animato-primary');
                    btnMine.classList.remove('text-gray-500', 'border-transparent');
                    btnSubmit.classList.remove('text-animato-primary', 'border-animato-primary');
                    btnSubmit.classList.add('text-gray-500', 'border-transparent');
                    loadMyFeedback();
                }
            }

            let currentDetailFeedbackId = null;
            let allFeedbackItems = [];
            let currentFeedbackFilter = 'all';

            const fbTypeLabels = { bug: '\\u{1F41B} Bug', feature: '\\u{1F4A1} Idee', other: '\\u{1F4DD} Anders' };
            const fbStatusColors = {
                open: 'bg-blue-100 text-blue-700',
                meer_info_nodig: 'bg-orange-100 text-orange-700',
                in_progress: 'bg-yellow-100 text-yellow-700',
                hertesten: 'bg-purple-100 text-purple-700',
                resolved: 'bg-green-100 text-green-700',
                rejected: 'bg-red-50 text-red-500'
            };
            const fbStatusLabels = {
                open: 'Open',
                meer_info_nodig: '\\u26a0\\ufe0f Meer info nodig',
                in_progress: 'In behandeling',
                hertesten: '\\ud83d\\udd01 Hertesten',
                resolved: 'Opgelost',
                rejected: 'Afgewezen'
            };

            function renderFeedbackItem(item) {
                const sColor = fbStatusColors[item.status] || 'bg-gray-100 text-gray-500';
                const sLabel = fbStatusLabels[item.status] || item.status;
                const tLabel = fbTypeLabels[item.type] || item.type;
                const date = new Date(item.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' });
                const hasComments = item.comment_count > 0;
                const hasNewReplies = item.unread_admin_replies > 0;
                
                const actionBadge = item.status === 'hertesten'
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;animation:pulse 2s infinite;"><i class="fas fa-sync-alt"></i> Graag hertesten!</span>'
                    : item.status === 'meer_info_nodig'
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#fff7ed;color:#ea580c;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;animation:pulse 2s infinite;"><i class="fas fa-question-circle"></i> Info gevraagd</span>'
                    : '';
                const commentBadge = hasNewReplies 
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#fef3c7;color:#d97706;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;"><i class="fas fa-comment-dots"></i> Nieuw antwoord</span>'
                    : hasComments 
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;color:#9ca3af;font-size:10px;"><i class="fas fa-comments"></i> ' + item.comment_count + '</span>'
                    : '';

                return '<div onclick="openFeedbackDetail(' + item.id + ')" class="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer" data-status="' + item.status + '">' +
                    '<div class="flex items-start justify-between gap-2">' +
                    '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-1.5 mb-1 flex-wrap">' +
                    '<span class="text-xs text-gray-500">' + tLabel + '</span>' +
                    '<span class="text-gray-300">&middot;</span>' +
                    '<span class="text-xs text-gray-400">' + date + '</span>' +
                    actionBadge +
                    commentBadge +
                    '</div>' +
                    '<p class="text-xs text-gray-700 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + _escHtml(item.message) + '</p>' +
                    '</div>' +
                    '<div class="flex flex-col items-end gap-1 shrink-0">' +
                    '<span class="text-xs font-medium px-2 py-0.5 rounded-full ' + sColor + '">' + sLabel + '</span>' +
                    '<i class="fas fa-chevron-right text-xs text-gray-300"></i>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            }

            function renderFilteredList(items) {
                const list = document.getElementById('my-feedback-list');
                const empty = document.getElementById('my-feedback-empty');
                const filtered = currentFeedbackFilter === 'all' ? items : items.filter(function(i) { return i.status === currentFeedbackFilter; });
                
                if (filtered.length === 0) {
                    list.classList.add('hidden');
                    empty.classList.remove('hidden');
                    const filterLabel = currentFeedbackFilter === 'all' ? '' : ' met status "' + (fbStatusLabels[currentFeedbackFilter] || currentFeedbackFilter) + '"';
                    empty.innerHTML = '<i class="fas fa-filter text-3xl text-gray-200 mb-2 block"></i>' +
                        '<p class="text-sm text-gray-400">Geen feedback' + filterLabel + ' gevonden.</p>';
                } else {
                    empty.classList.add('hidden');
                    list.innerHTML = filtered.map(renderFeedbackItem).join('');
                    list.classList.remove('hidden');
                }

                // Update filter button counts + active state
                updateFilterButtons(items);
            }

            function updateFilterButtons(items) {
                const counts = { all: items.length };
                items.forEach(function(i) { counts[i.status] = (counts[i.status] || 0) + 1; });
                
                document.querySelectorAll('.fb-filter-btn').forEach(function(btn) {
                    const f = btn.getAttribute('data-filter');
                    const count = counts[f] || 0;
                    const isActive = f === currentFeedbackFilter;
                    
                    // Determine color based on filter type
                    var activeColors = {
                        all: 'bg-animato-primary text-white border-animato-primary',
                        open: 'bg-blue-500 text-white border-blue-500',
                        hertesten: 'bg-purple-500 text-white border-purple-500',
                        meer_info_nodig: 'bg-orange-500 text-white border-orange-500',
                        in_progress: 'bg-yellow-500 text-white border-yellow-500',
                        resolved: 'bg-green-500 text-white border-green-500'
                    };
                    var inactiveClass = 'bg-white text-gray-500 border-gray-200';
                    
                    // Strip all state classes
                    btn.className = btn.className.replace(/bg-\\S+|text-\\S+|border-\\S+/g, '').trim();
                    btn.classList.add(...(isActive ? (activeColors[f] || activeColors.all) : inactiveClass).split(' '));
                    
                    // Hide button if count is 0 (except 'all')
                    if (f !== 'all' && count === 0) {
                        btn.style.display = 'none';
                    } else {
                        btn.style.display = '';
                    }
                    
                    // Update text with count
                    var labels = { all: 'Alles', open: 'Open', hertesten: 'Hertesten', meer_info_nodig: 'Info nodig', in_progress: 'In behandeling', resolved: 'Opgelost' };
                    btn.textContent = (labels[f] || f) + (count > 0 ? ' (' + count + ')' : '');
                });
            }

            function filterFeedback(status) {
                currentFeedbackFilter = status;
                renderFilteredList(allFeedbackItems);
            }

            async function loadMyFeedback() {
                const loading = document.getElementById('my-feedback-loading');
                const list = document.getElementById('my-feedback-list');
                const empty = document.getElementById('my-feedback-empty');
                const detail = document.getElementById('my-feedback-detail');
                const filters = document.getElementById('my-feedback-filters');

                loading.classList.remove('hidden');
                list.classList.add('hidden');
                empty.classList.add('hidden');
                detail.classList.add('hidden');
                filters.classList.add('hidden');

                try {
                    const res = await fetch('/api/feedback/mine');
                    if (!res.ok) {
                        loading.innerHTML = '<i class="fas fa-lock text-gray-300 text-2xl mb-2 block"></i><p class="text-xs text-gray-400">Log in om je feedback te bekijken.</p>';
                        return;
                    }
                    const data = await res.json();
                    loading.classList.add('hidden');

                    if (!data.items || data.items.length === 0) {
                        empty.classList.remove('hidden');
                        empty.innerHTML = '<i class="fas fa-inbox text-3xl text-gray-200 mb-2 block"></i><p class="text-sm text-gray-400">Je hebt nog geen feedback ingediend.</p>';
                        return;
                    }

                    allFeedbackItems = data.items;
                    filters.classList.remove('hidden');
                    renderFilteredList(allFeedbackItems);
                } catch(e) {
                    loading.innerHTML = '<i class="fas fa-exclamation-circle text-red-300 text-2xl mb-2 block"></i><p class="text-xs text-gray-400">Kon feedback niet laden.</p>';
                }
            }

            function _escHtml(text) {
                const d = document.createElement('div');
                d.textContent = text;
                return d.innerHTML;
            }

            async function openFeedbackDetail(feedbackId) {
                currentDetailFeedbackId = feedbackId;
                const list = document.getElementById('my-feedback-list');
                const detail = document.getElementById('my-feedback-detail');
                const header = document.getElementById('my-feedback-detail-header');
                const messages = document.getElementById('my-feedback-detail-messages');
                const empty = document.getElementById('my-feedback-empty');
                const filters = document.getElementById('my-feedback-filters');

                list.classList.add('hidden');
                empty.classList.add('hidden');
                if (filters) filters.classList.add('hidden');
                detail.classList.remove('hidden');
                messages.innerHTML = '<div class="text-center text-xs text-gray-400 py-4"><i class="fas fa-spinner fa-spin mr-1"></i> Laden...</div>';

                try {
                    // Load the feedback item details + comments
                    const [mineRes, commentsRes] = await Promise.all([
                        fetch('/api/feedback/mine'),
                        fetch('/api/feedback/' + feedbackId + '/comments')
                    ]);
                    
                    const mineData = await mineRes.json();
                    const commentsData = await commentsRes.json();
                    const item = (mineData.items || []).find(function(i) { return i.id === feedbackId; });
                    
                    if (!item) {
                        messages.innerHTML = '<div class="text-center text-xs text-red-400 py-4">Item niet gevonden.</div>';
                        return;
                    }

                    const typeLabels = { bug: '🐛 Bug', feature: '💡 Idee', other: '📝 Anders' };
                    const statusLabels = { open: 'Open', meer_info_nodig: '\u26a0\ufe0f Meer info nodig', in_progress: 'In behandeling', hertesten: '\ud83d\udd01 Hertesten', resolved: 'Opgelost', rejected: 'Afgewezen' };
                    const statusColors = { open: '#3b82f6', meer_info_nodig: '#f97316', in_progress: '#f59e0b', hertesten: '#a855f7', resolved: '#22c55e', rejected: '#ef4444' };
                    
                    // Build header with status badge
                    let headerHtml = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                        '<span style="font-size:11px;font-weight:600;">' + (typeLabels[item.type] || item.type) + '</span>' +
                        '<span style="font-size:10px;font-weight:600;padding:1px 8px;border-radius:9999px;background:' + (statusColors[item.status] || '#9ca3af') + '15;color:' + (statusColors[item.status] || '#9ca3af') + ';">' + (statusLabels[item.status] || item.status) + '</span>' +
                        '</div>' +
                        '<p style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;">' + _escHtml(item.message) + '</p>';

                    // Add retest response buttons when status is 'hertesten'
                    if (item.status === 'hertesten') {
                        headerHtml += '<div id="retest-response-block" style="margin-top:10px;padding:10px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;">' +
                            '<p style="font-size:11px;font-weight:600;color:#6d28d9;margin-bottom:8px;"><i class="fas fa-sync-alt" style="margin-right:4px;"></i> Er is een fix toegepast. Werkt het nu?</p>' +
                            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
                            '<button onclick="submitRetestResponse(' + item.id + ', &quot;ok&quot;)" style="flex:1;padding:8px 12px;background:#22c55e;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all .2s;" onmouseover="this.style.background=&quot;#16a34a&quot;" onmouseout="this.style.background=&quot;#22c55e&quot;">' +
                            '<i class="fas fa-check-circle"></i> Ja, werkt nu!</button>' +
                            '<button onclick="submitRetestResponse(' + item.id + ', &quot;not_ok&quot;)" style="flex:1;padding:8px 12px;background:#ef4444;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all .2s;" onmouseover="this.style.background=&quot;#dc2626&quot;" onmouseout="this.style.background=&quot;#ef4444&quot;">' +
                            '<i class="fas fa-times-circle"></i> Nee, nog niet goed</button>' +
                            '</div>' +
                            '<input type="text" id="retest-comment-input" placeholder="Optioneel: geef extra uitleg..." style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #ddd6fe;border-radius:6px;font-size:11px;background:white;" />' +
                            '</div>';
                    }

                    header.innerHTML = headerHtml;

                    const comments = commentsData.comments || [];
                    if (comments.length === 0) {
                        messages.innerHTML = '<div class="text-center py-6">' +
                            '<i class="fas fa-comments text-2xl text-gray-200 mb-2 block"></i>' +
                            '<p class="text-xs text-gray-400">Nog geen reacties.</p>' +
                            '<p class="text-xs text-gray-300 mt-1">Stel een vraag of geef meer info hieronder.</p>' +
                            '</div>';
                    } else {
                        messages.innerHTML = comments.map(function(c) {
                            const isAdmin = c.is_admin === 1;
                            const name = ((c.voornaam || '') + ' ' + (c.achternaam || '')).trim();
                            const date = new Date(c.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                            
                            if (isAdmin) {
                                return '<div style="display:flex;justify-content:flex-start;">' +
                                    '<div style="max-width:85%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;border-bottom-left-radius:2px;padding:6px 10px;">' +
                                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                                    '<span style="font-size:10px;font-weight:700;color:#166534;"><i class="fas fa-shield-alt" style="margin-right:2px;"></i>Admin</span>' +
                                    '<span style="font-size:9px;color:#9ca3af;">' + date + '</span>' +
                                    '</div>' +
                                    '<p style="font-size:12px;color:#1f2937;margin:0;line-height:1.4;">' + _escHtml(c.message) + '</p>' +
                                    '</div></div>';
                            } else {
                                return '<div style="display:flex;justify-content:flex-end;">' +
                                    '<div style="max-width:85%;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;border-bottom-right-radius:2px;padding:6px 10px;">' +
                                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                                    '<span style="font-size:10px;font-weight:600;color:#1e40af;"><i class="fas fa-user" style="margin-right:2px;"></i>Jij</span>' +
                                    '<span style="font-size:9px;color:#9ca3af;">' + date + '</span>' +
                                    '</div>' +
                                    '<p style="font-size:12px;color:#1f2937;margin:0;line-height:1.4;">' + _escHtml(c.message) + '</p>' +
                                    '</div></div>';
                            }
                        }).join('');
                        messages.scrollTop = messages.scrollHeight;
                    }
                } catch(e) {
                    messages.innerHTML = '<div class="text-center text-xs text-red-400 py-4"><i class="fas fa-exclamation-triangle mr-1"></i> Kon conversatie niet laden.</div>';
                }
            }

            function closeFeedbackDetail() {
                currentDetailFeedbackId = null;
                document.getElementById('my-feedback-detail').classList.add('hidden');
                // Re-fetch to get updated statuses (e.g. after retest response)
                loadMyFeedback();
            }

            async function submitRetestResponse(feedbackId, verdict) {
                const commentInput = document.getElementById('retest-comment-input');
                const comment = commentInput ? commentInput.value.trim() : '';
                
                // Disable buttons to prevent double-click
                const block = document.getElementById('retest-response-block');
                if (block) {
                    block.innerHTML = '<div style="text-align:center;padding:8px;"><i class="fas fa-spinner fa-spin" style="color:#6d28d9;"></i> <span style="font-size:11px;color:#6d28d9;font-weight:600;">Verwerken...</span></div>';
                }

                try {
                    const res = await fetch('/api/feedback/' + feedbackId + '/retest-response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ verdict: verdict, comment: comment })
                    });

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Fout bij versturen');
                    }

                    const data = await res.json();
                    
                    // Show success message
                    if (block) {
                        if (verdict === 'ok') {
                            block.innerHTML = '<div style="text-align:center;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">' +
                                '<i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;display:block;margin-bottom:4px;"></i>' +
                                '<span style="font-size:11px;color:#166534;font-weight:600;">Bedankt! Gemarkeerd als opgelost.</span></div>';
                        } else {
                            block.innerHTML = '<div style="text-align:center;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">' +
                                '<i class="fas fa-redo" style="color:#ef4444;font-size:18px;display:block;margin-bottom:4px;"></i>' +
                                '<span style="font-size:11px;color:#991b1b;font-weight:600;">Feedback ontvangen. We kijken er opnieuw naar!</span></div>';
                        }
                    }

                    // Refresh the detail view after a short delay
                    setTimeout(function() { openFeedbackDetail(feedbackId); }, 1500);
                } catch(e) {
                    if (block) {
                        block.innerHTML = '<div style="text-align:center;padding:8px;color:#ef4444;font-size:11px;font-weight:600;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> ' + _escHtml(e.message) + '</div>';
                    }
                }
            }

            async function sendUserComment() {
                if (!currentDetailFeedbackId) return;
                const input = document.getElementById('my-feedback-reply-input');
                const message = input.value.trim();
                if (!message) return;
                
                input.disabled = true;
                try {
                    const res = await fetch('/api/feedback/' + currentDetailFeedbackId + '/comments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: message })
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Fout');
                    }
                    input.value = '';
                    openFeedbackDetail(currentDetailFeedbackId);
                } catch(e) {
                    alert('Fout: ' + e.message);
                } finally {
                    input.disabled = false;
                    input.focus();
                }
            }

            function loadScreenshot(blob) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    betaScreenshotData = e.target.result;
                    document.getElementById('screenshot-img').src = betaScreenshotData;
                    document.getElementById('screenshot-preview').classList.remove('hidden');
                    document.getElementById('screenshot-zone').classList.add('hidden');
                };
                reader.readAsDataURL(blob);
            }

            function clearScreenshot() {
                betaScreenshotData = null;
                document.getElementById('screenshot-img').src = '';
                document.getElementById('screenshot-preview').classList.add('hidden');
                document.getElementById('screenshot-zone').classList.remove('hidden');
                const fi = document.getElementById('screenshot-file');
                if (fi) fi.value = '';
            }

            async function submitBetaFeedback(e) {
                e.preventDefault();
                const form = e.target;
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Versturen...';

                const formData = new FormData(form);
                const data = {
                    type: formData.get('type'),
                    message: formData.get('message'),
                    url: window.location.href,
                    screenshot: betaScreenshotData || '',
                    browser_info: navigator.userAgent + ' | ' + screen.width + 'x' + screen.height + ' | ' + (navigator.language || '')
                };

                try {
                    const res = await fetch('/api/feedback', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    });

                    if (res.ok) {
                        submitBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Verzonden!';
                        betaFeedbackLoaded = false; // reset so it reloads next time
                        setTimeout(() => {
                            document.getElementById('beta-popup').classList.add('hidden');
                            form.reset();
                            clearScreenshot();
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                        }, 1500);
                    } else {
                        const err = await res.json();
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                        if(err.error === 'Unauthorized') alert('Je moet ingelogd zijn om feedback te geven.');
                        else alert('Er ging iets mis: ' + (err.error || 'Onbekende fout'));
                    }
                } catch(e) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                    alert('Verbindingsfout');
                }
            }
        `}} />
      </body>
    </html>
  )
}
