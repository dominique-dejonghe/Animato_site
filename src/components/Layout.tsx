// Layout component met Animato branding
// Base HTML structure met navigation, header, footer

import type { FC } from 'hono/jsx'
import { getNavPages } from '../utils/nav-context'

interface LayoutProps {
  title?: string
  description?: string
  children: any
  user?: { voornaam: string; achternaam: string; role: string; foto_url?: string | null; is_bestuurslid?: number } | null
  currentPath?: string
  impersonating?: boolean
  // OpenGraph / social-share metadata — gebruikt voor mooie WhatsApp / Facebook / LinkedIn preview-kaarten
  ogImage?: string         // absolute URL naar cover image (1200x630 ideaal)
  ogUrl?: string           // canonical URL van deze pagina
  ogType?: string          // 'article' voor nieuwsposts, anders 'website'
  ogSiteName?: string      // standaard 'Gemengd Koor Animato'
}

export const Layout: FC<LayoutProps> = ({ 
  title = 'Gemengd Koor Animato', 
  description = 'Koor met passie',
  children,
  user = null,
  currentPath = '/',
  impersonating = false,
  ogImage,
  ogUrl,
  ogType = 'website',
  ogSiteName = 'Gemengd Koor Animato'
}) => {
  const fullTitle = title === 'Gemengd Koor Animato' ? title : `${title} | Gemengd Koor Animato`
  // Default OG-image = Animato logo (kleine fallback, dan toont WhatsApp tenminste iets visueel)
  const finalOgImage = ogImage || 'https://animato-live.pages.dev/static/images/animato-logo-full.png'

  // Avatar voor de header: kleine ronde profielfoto als ingelogde user er een heeft,
  // anders een fallback fa-user-circle icon (zoals voorheen).
  // We renderen 1 element zodat de layout-flow constant blijft.
  const renderHeaderAvatar = (extraClass = 'mr-2') => {
    if (user?.foto_url) {
      return (
        <img
          src={user.foto_url}
          alt={user.voornaam}
          class={`w-7 h-7 rounded-full object-cover border border-gray-200 ${extraClass}`}
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      )
    }
    return <i class={`fas fa-user-circle text-lg ${extraClass}`}></i>
  }

  // =====================================================
  // NAV-ITEMS — mix van statische items met editable_pages (show_in_nav=1)
  // =====================================================
  // Statische items hebben hardcoded nav_order zodat editable_pages tussen,
  // voor of na de standaard-items kunnen verschijnen.
  // - Home: 0
  // - Over Ons: 10
  // - Nieuws: 20
  // - Agenda: 30
  // - Concerten: 40
  // - Foto's: 50
  // - Contact: 9999 (altijd laatst)
  // editable_pages met nav_order 11–9 verschijnen tussen Home/Over,
  // met 21–39 tussen Nieuws/Agenda, enz. nav_order 100 = na Foto's.
  type NavItem = { href: string; label: string; nav_order: number; activePaths?: string[] }
  const staticItems: NavItem[] = [
    { href: '/', label: 'Home', nav_order: 0, activePaths: ['/'] },
    { href: '/over', label: 'Over Ons', nav_order: 10, activePaths: ['/over', '/koor'] },
    { href: '/nieuws', label: 'Nieuws', nav_order: 20, activePaths: ['/nieuws'] },
    { href: '/agenda', label: 'Agenda', nav_order: 30, activePaths: ['/agenda'] },
    { href: '/concerten', label: 'Concerten', nav_order: 40, activePaths: ['/concerten'] },
    { href: '/fotoboek', label: "Foto's", nav_order: 50, activePaths: ['/fotoboek'] },
    { href: '/contact', label: 'Contact', nav_order: 9999, activePaths: ['/contact'] },
  ]
  const dynamicItems: NavItem[] = getNavPages().map(p => ({
    href: `/${p.slug}`,
    label: p.titel,
    nav_order: p.nav_order,
    activePaths: [`/${p.slug}`],
  }))
  const allNavItems = [...staticItems, ...dynamicItems].sort((a, b) => a.nav_order - b.nav_order)

  // Desktop overflow-drempel: max 7 items zichtbaar, rest in "Meer" dropdown.
  // Contact (nav_order 9999) blijft altijd zichtbaar.
  const DESKTOP_MAX = 7
  let visibleNav: NavItem[] = allNavItems
  let overflowNav: NavItem[] = []
  if (allNavItems.length > DESKTOP_MAX) {
    const contact = allNavItems.find(i => i.nav_order === 9999)
    const rest = allNavItems.filter(i => i.nav_order !== 9999)
    visibleNav = rest.slice(0, DESKTOP_MAX - 1)
    overflowNav = rest.slice(DESKTOP_MAX - 1)
    if (contact) visibleNav.push(contact)
  }

  const isActive = (item: NavItem) => item.activePaths?.some(p => currentPath === p) ?? false

  return (
    <html lang="nl">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{fullTitle}</title>
        <meta name="description" content={description} />

        {/* OpenGraph tags — voor WhatsApp / Facebook / LinkedIn link-previews */}
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content={ogType} />
        <meta property="og:image" content={finalOgImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content={ogSiteName} />
        <meta property="og:locale" content="nl_BE" />
        {ogUrl && <meta property="og:url" content={ogUrl} />}

        {/* Twitter Card — zelfde info, ander formaat (oa ook gebruikt door iMessage) */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={finalOgImage} />

        {/* Animato branding colors */}
        <meta name="theme-color" content="#00A9CE" />

        {/* ⚡ PERFORMANCE — 2026-07-08:
            Vroeger laadden we Tailwind via cdn.tailwindcss.com (JIT compiler
            in de browser). Nadeel: traag first-paint EN als je 'defer' zet
            breekt de layout (admin-sidebar met bg-animato-secondary werd wit
            op wit). Zie #TAILWIND-BREAK.

            Nu: pre-compiled bundle via `tailwindcss` CLI in de build-pipeline.
            - Één statisch bestand: /static/css/tailwind.css (~50kB gzipped)
            - Browser-cachet dit tussen paginas
            - Geen browser-CPU voor compileren
            - Geen FOUC — CSS is er vóór eerste paint
            - Custom colors (animato-primary etc.) staan in tailwind.config.js */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />

        {/* Tailwind CSS — pre-compiled, geen runtime CDN meer nodig. */}
        <link href="/static/css/tailwind.css" rel="stylesheet" />

        {/* Font Awesome Icons — synchroon om icoon-flash te voorkomen. */}
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />

        {/* Google Fonts - Playfair Display & Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
        
        {/* Custom CSS */}
        <link href="/static/css/styles.css" rel="stylesheet" />

        {/* Global rich-text editor & textarea scroll behaviour
            Zorgt dat Quill-editors en grote textareas in admin-formulieren
            niet onbeperkt uitdijen. Lange tekst → interne scrollbar. */}
        <style dangerouslySetInnerHTML={{ __html: `
          /* Quill rich-text editors: compact wanneer leeg, scrollbaar wanneer lang */
          .ql-editor {
            min-height: 140px;
            max-height: 260px !important;
            overflow-y: auto !important;
          }
          /* Container van de editor mag niet meer groeien dan de editor zelf */
          .ql-container {
            max-height: 260px !important;
          }
          /* Voor notulen-achtige velden mag het iets groter */
          .ql-editor.ql-editor-large {
            max-height: 420px !important;
          }
          .ql-editor.ql-editor-large ~ .ql-container,
          .ql-container.ql-container-large {
            max-height: 420px !important;
          }
          textarea.admin-textarea-large {
            max-height: 420px;
            overflow-y: auto;
          }
          /* Standaard: alle textareas in admin-formulieren scrollen als ze groeien */
          .admin-form textarea,
          form[action^="/api/admin"] textarea,
          form[action^="/admin/"] textarea {
            max-height: 260px;
            overflow-y: auto;
          }
        ` }} />
        
        {/* Shepherd.js - Walkthrough Tours
            ⚡ PERFORMANCE: alleen gebruikt voor onboarding-tours (zelden actief).
            Laden via defer + preload voor css → geen render-blocking. */}
        <link rel="preload" href="https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/css/shepherd.css" as="style" onload="this.onload=null;this.rel='stylesheet'" />
        <noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/css/shepherd.css" /></noscript>
        <script src="https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/js/shepherd.min.js" defer></script>
        
        {/* Favicon - placeholder */}
        <link rel="icon" type="image/png" href="/static/images/animato-note.png" />
        <link rel="apple-touch-icon" href="/static/images/animato-note.png" />
      </head>
      
      <body class="font-sans bg-gray-50 text-gray-900" style="font-family: 'Inter', sans-serif;">
        {/* Top loading bar (subtle progress indicator during navigation + AJAX) */}
        <div id="topLoadingBar" class="fixed top-0 left-0 h-[3px] bg-gradient-to-r from-animato-primary via-pink-500 to-animato-secondary z-[9999] pointer-events-none" style="width: 0%; transition: width 200ms ease-out, opacity 300ms ease-out; opacity: 0; box-shadow: 0 0 8px rgba(236, 72, 153, 0.6);"></div>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var bar = document.getElementById('topLoadingBar');
            if (!bar) return;
            var progress = 0, interval = null, active = 0;
            function start(){
              active++;
              if (active > 1) return; // already running
              progress = 5;
              bar.style.opacity = '1';
              bar.style.width = progress + '%';
              clearInterval(interval);
              interval = setInterval(function(){
                // slow increment towards 90
                if (progress < 90) {
                  progress += (90 - progress) * 0.08;
                  bar.style.width = progress + '%';
                }
              }, 200);
            }
            function done(){
              active = Math.max(0, active - 1);
              if (active > 0) return;
              clearInterval(interval);
              bar.style.width = '100%';
              setTimeout(function(){
                bar.style.opacity = '0';
                setTimeout(function(){ bar.style.width = '0%'; }, 300);
              }, 150);
            }
            // Expose for AJAX callers
            window.__topbar = { start: start, done: done };

            // Trigger on navigation clicks (same-origin, non-blank target, not modifier-click)
            document.addEventListener('click', function(e){
              var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
              if (!a) return;
              if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              var href = a.getAttribute('href');
              if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
              if (href.indexOf('http') === 0 && href.indexOf(location.origin) !== 0) return; // external
              start();
            }, true);
            // Trigger on form submits
            document.addEventListener('submit', function(){ start(); }, true);
            // Hide when page fully loaded (back/forward cache)
            window.addEventListener('pageshow', function(){ active = 0; clearInterval(interval); bar.style.opacity = '0'; bar.style.width = '0%'; });
            // Intercept fetch for AJAX
            var origFetch = window.fetch;
            if (origFetch) {
              window.fetch = function(){
                start();
                return origFetch.apply(this, arguments).finally(function(){ done(); });
              };
            }
          })();

          // #116 — Laad ongelezen notificatie-count en update badge in header (desktop + mobile)
          (function(){
            var bell = document.getElementById('notif-bell-link');
            var badge = document.getElementById('notif-badge');
            var badgeMobile = document.getElementById('notif-badge-mobile');
            // Werk ook als enkel mobile badge bestaat (kleine viewports)
            if (!badge && !badgeMobile) return;
            function setBadge(el, n) {
              if (!el) return;
              if (n > 0) {
                el.textContent = n > 99 ? '99+' : String(n);
                el.classList.remove('hidden');
              } else {
                el.classList.add('hidden');
              }
            }
            function loadCount(){
              fetch('/api/leden/notifications/unread-count', { credentials: 'same-origin' })
                .then(function(r){ return r.ok ? r.json() : { count: 0 }; })
                .then(function(d){
                  var n = (d && d.count) || 0;
                  setBadge(badge, n);
                  setBadge(badgeMobile, n);
                })
                .catch(function(){ /* stil */ });
            }
            loadCount();
            // Refresh elke 2 minuten als de tab open staat
            setInterval(loadCount, 120000);
            // Refresh wanneer tab terug zichtbaar wordt
            document.addEventListener('visibilitychange', function(){
              if (!document.hidden) loadCount();
            });
          })();
        ` }} />
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
                <a href="/" class="flex items-center" aria-label="Animato - Koor met passie - Home">
                  <img
                    src="/static/images/animato-logo-full.png"
                    alt="Animato - Koor met passie"
                    class="h-12 md:h-14 w-auto"
                    width="256"
                    height="145"
                  />
                </a>
              </div>

              {/* Desktop Navigation — pas vanaf lg (1024px) tonen.
                  Op md/tablet/iPhone-landscape (768-1023px) was deze nav krap
                  en duwde hij de rechter auth-cluster van het scherm. */}
              <nav class="hidden lg:flex items-center space-x-6 lg:space-x-8">
                {visibleNav.map(item => (
                  <a
                    href={item.href}
                    class={`hover:text-animato-primary transition whitespace-nowrap ${isActive(item) ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}
                  >
                    {item.label}
                  </a>
                ))}
                {overflowNav.length > 0 && (
                  <div class="relative group" id="nav-more-dropdown">
                    <button
                      type="button"
                      class="flex items-center gap-1 text-gray-700 hover:text-animato-primary transition whitespace-nowrap"
                      onclick="this.nextElementSibling.classList.toggle('hidden')"
                      aria-haspopup="true"
                    >
                      Meer <i class="fas fa-chevron-down text-xs"></i>
                    </button>
                    <div class="hidden absolute right-0 top-full mt-2 w-56 bg-white shadow-xl rounded-lg border border-gray-200 py-2 z-50">
                      {overflowNav.map(item => (
                        <a
                          href={item.href}
                          class={`block px-4 py-2 hover:bg-gray-50 transition ${isActive(item) ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </nav>

              {/* Auth Buttons */}
              <div class="flex items-center space-x-4">
                {user ? (
                  user.role === 'kaartkoper' ? (
                    <>
                      {/* Kaartkoper-dropdown: enkel Mijn tickets + Profiel + Uitloggen */}
                      <div class="relative group" id="kaartkoper-dropdown">
                        <button
                          type="button"
                          class="hidden lg:flex items-center gap-2 text-gray-700 hover:text-animato-primary transition"
                          onclick="this.nextElementSibling.classList.toggle('hidden')"
                          aria-haspopup="true"
                        >
                          {renderHeaderAvatar('')}
                          <span>Mijn account</span>
                          <i class="fas fa-chevron-down text-xs"></i>
                        </button>
                        <div class="hidden absolute right-0 top-full mt-2 w-52 bg-white shadow-xl rounded-lg border border-gray-200 py-2 z-50">
                          <a href="/mijn-tickets" class="block px-4 py-2 hover:bg-gray-50 text-gray-700">
                            <i class="fas fa-ticket-alt mr-2 text-blue-500"></i>Mijn tickets
                          </a>
                          <a href="/profiel" class="block px-4 py-2 hover:bg-gray-50 text-gray-700">
                            <i class="fas fa-user-edit mr-2 text-blue-500"></i>Profiel
                          </a>
                          <hr class="my-1" />
                          <a href="/api/auth/logout" class="block px-4 py-2 hover:bg-gray-50 text-gray-600">
                            <i class="fas fa-sign-out-alt mr-2"></i>Uitloggen
                          </a>
                        </div>
                      </div>
                      {/* Mobile: simpele link naar mijn-tickets */}
                      <a href="/mijn-tickets" class="lg:hidden text-gray-700 hover:text-animato-primary transition">
                        <i class="fas fa-ticket-alt mr-1"></i>Tickets
                      </a>
                    </>
                  ) : (
                  <>
                    {/* Admin/Bestuur link — admins, moderators én bestuursleden */}
                    {(user.role === 'admin' || user.role === 'moderator' || user.is_bestuurslid === 1) && (
                      <a href="/admin" class="hidden lg:block text-gray-700 hover:text-animato-primary transition">
                        <i class="fas fa-shield-alt mr-2"></i>
                        {(user.role === 'admin' || user.role === 'moderator') ? 'Admin' : 'Bestuur'}
                      </a>
                    )}
                    {/* #116 — Notificatie-belletje met badge (voor ingelogde leden) */}
                    <a href="/leden/profiel#notifications-card" class="hidden lg:inline-flex relative items-center text-gray-700 hover:text-animato-primary transition px-2" title="Mijn meldingen" id="notif-bell-link">
                      <i class="fas fa-bell text-lg"></i>
                      <span
                        id="notif-badge"
                        class="hidden absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
                      ></span>
                    </a>
                    {/* Leden portal link */}
                    <a href="/leden" class="hidden lg:inline-flex items-center gap-2 text-gray-700 hover:text-animato-primary transition">
                      {renderHeaderAvatar('')}
                      <span>{user.voornaam}</span>
                    </a>
                    {/* Uitloggen - Desktop only (hidden on mobile to prevent accidental clicks) */}
                    <a href="/api/auth/logout" class="hidden lg:block text-sm text-gray-600 hover:text-gray-900">
                      Uitloggen
                    </a>
                  </>
                  )
                ) : (
                  <>
                    <a href="/word-lid" class="hidden lg:block bg-animato-accent text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition font-semibold">
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
                
                {/* Mobile menu button — getoond tot lg (1024px), dus ook in iPhone-landscape en iPad-portrait */}
                <button id="mobile-menu-button" class="lg:hidden text-gray-700 hover:text-animato-primary" aria-label="Menu openen">
                  <i class="fas fa-bars text-xl"></i>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Navigation — getoond tot lg (1024px). Bevat alle nav-items én auth-items. */}
          <div id="mobile-menu" class="hidden lg:hidden border-t border-gray-200">
            <div class="px-4 py-4 space-y-3">
              {allNavItems.map(item => (
                <a
                  href={item.href}
                  class={`block hover:text-animato-primary ${isActive(item) ? 'text-animato-primary font-semibold' : 'text-gray-700'}`}
                >
                  {item.label}
                </a>
              ))}
              
              {user ? (
                user.role === 'kaartkoper' ? (
                  <>
                    {/* Kaartkoper mobile menu — enkel tickets, profiel, uitloggen */}
                    <div class="border-t border-gray-300 my-2"></div>
                    <a href="/mijn-tickets" class="block text-gray-700 hover:text-animato-primary">
                      <i class="fas fa-ticket-alt mr-2 text-blue-500"></i>Mijn tickets
                    </a>
                    <a href="/profiel" class="block text-gray-700 hover:text-animato-primary">
                      <i class="fas fa-user-edit mr-2 text-blue-500"></i>Profiel
                    </a>
                    <div class="border-t border-gray-300 my-2"></div>
                    <a href="/api/auth/logout" class="block text-red-600 hover:text-red-700 font-medium">
                      <i class="fas fa-sign-out-alt mr-2"></i>Uitloggen
                    </a>
                  </>
                ) : (
                <>
                  {/* Admin/Bestuur link in mobile menu */}
                  {(user.role === 'admin' || user.role === 'moderator' || user.is_bestuurslid === 1) && (
                    <a href="/admin" class="block text-gray-700 hover:text-animato-primary">
                      <i class="fas fa-shield-alt mr-2"></i>
                      {(user.role === 'admin' || user.role === 'moderator') ? 'Admin Panel' : 'Bestuur Panel'}
                    </a>
                  )}
                  {/* Leden portal link in mobile menu */}
                  <a href="/leden" class="block text-gray-700 hover:text-animato-primary">
                    <i class="fas fa-users mr-2"></i>
                    Ledenpagina
                  </a>
                  {/* Notificaties in mobile menu */}
                  <a href="/leden/profiel#notifications-card" class="flex items-center text-gray-700 hover:text-animato-primary">
                    <i class="fas fa-bell mr-2"></i>
                    <span>Mijn meldingen</span>
                    <span id="notif-badge-mobile" class="hidden ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"></span>
                  </a>
                  {/* Divider */}
                  <div class="border-t border-gray-300 my-2"></div>
                  {/* Uitloggen link in mobile menu (safer placement to avoid accidental clicks) */}
                  <a href="/api/auth/logout" class="block text-red-600 hover:text-red-700 font-medium">
                    <i class="fas fa-sign-out-alt mr-2"></i>
                    Uitloggen
                  </a>
                </>
                )
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
                <img
                  src="/static/images/animato-logo-full.png"
                  alt="Animato - Koor met passie"
                  class="h-16 w-auto mb-4 brightness-0 invert opacity-90"
                  width="256"
                  height="145"
                />
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

        {/* Automatic external-link handler: opens external URLs in new tab */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            function processLinks() {
              var currentHost = window.location.hostname;
              var links = document.querySelectorAll('a[href]');
              for (var i = 0; i < links.length; i++) {
                var a = links[i];
                var href = a.getAttribute('href');
                if (!href) continue;
                // Skip anchors, mailto, tel, javascript, and data URLs
                if (href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('javascript:') === 0 || href.indexOf('data:') === 0) continue;
                // Relative links are always internal
                if (href.charAt(0) === '/' || href.indexOf('./') === 0 || href.indexOf('../') === 0) {
                  // If someone accidentally set target=_blank on an internal link, leave it (explicit override)
                  continue;
                }
                // Absolute URL: check host
                var isExternal = false;
                try {
                  var url = new URL(href, window.location.href);
                  if (url.hostname && url.hostname !== currentHost) {
                    isExternal = true;
                  }
                } catch(e) { /* invalid URL, skip */ continue; }
                if (isExternal && !a.hasAttribute('target')) {
                  a.setAttribute('target', '_blank');
                  var rel = (a.getAttribute('rel') || '').split(/\\s+/);
                  if (rel.indexOf('noopener') === -1) rel.push('noopener');
                  if (rel.indexOf('noreferrer') === -1) rel.push('noreferrer');
                  a.setAttribute('rel', rel.filter(Boolean).join(' '));
                }
              }
            }
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', processLinks);
            } else {
              processLinks();
            }
            // Re-run after Quill editors render or dynamic content is injected
            document.addEventListener('animato:content-loaded', processLinks);
          })();
        `}} />

        {/* Custom JS - includes mobile menu handler */}
        <script src="/static/js/app.js"></script>

        {/* Comment reactions UI (auto-init op .comment-reactions elementen) */}
        <script src="/static/js/comment-reactions.js" defer></script>

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
        <script src="/static/js/beta-feedback.js" defer></script>
      </body>
    </html>
  )
}
