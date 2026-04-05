// Layout component met Animato branding
// Base HTML structure met navigation, header, footer

import type { FC } from 'hono/jsx'

interface LayoutProps {
  title?: string
  description?: string
  children: any
  user?: { voornaam: string; achternaam: string; role: string } | null
  currentPath?: string
}

export const Layout: FC<LayoutProps> = ({ 
  title = 'Gemengd Koor Animato', 
  description = 'Koor met passie',
  children,
  user = null,
  currentPath = '/'
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
            <div id="beta-popup" class="absolute bottom-16 right-0 bg-white rounded-lg shadow-xl p-4 w-96 border border-gray-200 hidden">
                <div class="flex justify-between items-center mb-2">
                    <h3 class="font-bold text-gray-900">Beta Feedback</h3>
                    <button id="beta-close" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
                </div>
                <p class="text-xs text-gray-600 mb-3">Spoor je een bug op of heb je een idee? Laat het ons weten!</p>
                <form id="beta-form" onsubmit="submitBetaFeedback(event)">
                    <div class="mb-2">
                        <select name="type" class="w-full text-sm border rounded p-1.5 bg-gray-50">
                            <option value="bug">🐛 Bug Melden</option>
                            <option value="feature">💡 Idee / Feature</option>
                            <option value="other">📝 Anders</option>
                        </select>
                    </div>
                    <div class="mb-2">
                        <textarea name="message" rows={3} class="w-full text-sm border rounded p-2" placeholder="Beschrijf het probleem..." required></textarea>
                    </div>
                    {/* Screenshot plakzone */}
                    <div class="mb-3">
                        <div id="screenshot-zone"
                            class="border-2 border-dashed border-gray-300 rounded p-3 text-center text-xs text-gray-400 cursor-pointer hover:border-animato-primary hover:text-animato-primary transition relative"
                            title="Klik of plak een screenshot (Ctrl+V)">
                            <i class="fas fa-image mr-1"></i>
                            Screenshot plakken <span class="font-mono bg-gray-100 px-1 rounded">Ctrl+V</span> of klik om te uploaden
                            <input type="file" id="screenshot-file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                        <div id="screenshot-preview" class="hidden mt-2 relative">
                            <img id="screenshot-img" class="w-full rounded border max-h-40 object-contain" src="" alt="Screenshot preview" />
                            <button type="button" onclick="clearScreenshot()" class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-600">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-animato-primary text-white text-sm font-bold py-2 rounded hover:bg-opacity-90">
                        <i class="fas fa-paper-plane mr-1"></i> Versturen
                    </button>
                </form>
            </div>
        </div>
        <script dangerouslySetInnerHTML={{__html: `
            let betaScreenshotData = null;

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
                        btn.onclick = () => popup.classList.toggle('hidden');
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
                        fileInput.addEventListener('change', function(e) {
                            const file = e.target.files[0];
                            if (file) loadScreenshot(file);
                        });

                        // Drag & drop
                        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('border-animato-primary'); });
                        zone.addEventListener('dragleave', () => zone.classList.remove('border-animato-primary'));
                        zone.addEventListener('drop', (e) => {
                            e.preventDefault();
                            zone.classList.remove('border-animato-primary');
                            const file = e.dataTransfer.files[0];
                            if (file && file.type.startsWith('image/')) loadScreenshot(file);
                        });
                    }
                } catch(e) { console.error('Beta status check failed', e); }
            })();

            function loadScreenshot(blob) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    betaScreenshotData = e.target.result; // base64 data URL
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
                document.getElementById('screenshot-file').value = '';
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
                    screenshot: betaScreenshotData || ''
                };

                try {
                    const res = await fetch('/api/feedback', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    });

                    if (res.ok) {
                        submitBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Verzonden!';
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
