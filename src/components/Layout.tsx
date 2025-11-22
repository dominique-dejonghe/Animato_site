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
                    <a href="/api/auth/logout" class="text-sm text-gray-600 hover:text-gray-900">
                      Uitloggen
                    </a>
                  </>
                ) : (
                  <>
                    <a href="/word-lid" class="hidden md:block bg-animato-accent text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition font-semibold">
                      Word Lid
                    </a>
                    <a href="/login" class="text-animato-primary hover:text-animato-secondary transition">
                      <i class="fas fa-sign-in-alt mr-1"></i>
                      Login
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
                </>
              ) : (
                <a href="/word-lid" class="block bg-animato-accent text-white px-4 py-2 rounded-lg text-center font-semibold">
                  Word Lid
                </a>
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
                  <li><i class="fas fa-envelope mr-2"></i>info@animato.be</li>
                  <li><i class="fas fa-phone mr-2"></i>+32 470 12 34 56</li>
                  <li><i class="fas fa-map-marker-alt mr-2"></i>Koorstraat 1, 1000 Brussel</li>
                </ul>
              </div>

              {/* Social Media */}
              <div>
                <h3 class="text-lg font-semibold mb-4">Volg Ons</h3>
                <div class="flex space-x-4">
                  <a href="#" class="text-2xl text-gray-300 hover:text-white transition">
                    <i class="fab fa-facebook"></i>
                  </a>
                  <a href="#" class="text-2xl text-gray-300 hover:text-white transition">
                    <i class="fab fa-instagram"></i>
                  </a>
                  <a href="#" class="text-2xl text-gray-300 hover:text-white transition">
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

        {/* Mobile menu toggle script */}
        <script dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('mobile-menu-button').addEventListener('click', function() {
              const menu = document.getElementById('mobile-menu');
              menu.classList.toggle('hidden');
            });
          `
        }} />

        {/* Custom JS */}
        <script src="/static/js/app.js"></script>
      </body>
    </html>
  )
}
