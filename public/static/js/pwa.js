// ============================================================================
// Animato PWA — client-side registratie + install-prompt
// ============================================================================
// Doet 3 dingen:
//   1. Registreert /sw.js als service worker (na page-load, niet-blokkerend)
//   2. Vangt het browser-native `beforeinstallprompt` event op zodat we onze
//      eigen "Installeer app" knop kunnen tonen ipv de browser-suggestie
//   3. Detecteert of we IN de standalone-modus draaien (na installatie) om
//      dubbele prompts te vermijden
//
// Dominique 2026-08-22
// ============================================================================

(function() {
  'use strict'

  // ------------------------------------------------------------
  // 1. Service worker registreren
  // ------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    // Wacht tot page-load — anders vertragen we first paint
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function(reg) {
          // Wanneer er een nieuwe SW klaar staat, laten we die onmiddellijk actief
          // worden zodat de gebruiker niet een reload moet doen om updates te zien.
          reg.addEventListener('updatefound', function() {
            var newWorker = reg.installing
            if (!newWorker) return
            newWorker.addEventListener('statechange', function() {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nieuwe versie geïnstalleerd terwijl er al één actief was
                newWorker.postMessage({ type: 'SKIP_WAITING' })
              }
            })
          })
        })
        .catch(function(err) {
          console.warn('[PWA] Service worker registratie mislukt:', err)
        })

      // Als de nieuwe SW de controle overneemt, herlaad éénmaal voor verse assets
      var reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (reloading) return
        reloading = true
        window.location.reload()
      })
    })
  }

  // ------------------------------------------------------------
  // 2. Install-prompt beheer
  // ------------------------------------------------------------
  var deferredPrompt = null
  var INSTALL_DISMISSED_KEY = 'animato_pwa_install_dismissed'
  var DISMISS_COOLDOWN_DAYS = 30

  function isStandalone() {
    // Chromium: matchMedia. iOS Safari: navigator.standalone
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true
  }

  function wasDismissedRecently() {
    try {
      var raw = localStorage.getItem(INSTALL_DISMISSED_KEY)
      if (!raw) return false
      var when = parseInt(raw, 10)
      if (isNaN(when)) return false
      var days = (Date.now() - when) / (1000 * 60 * 60 * 24)
      return days < DISMISS_COOLDOWN_DAYS
    } catch (_) { return false }
  }

  function markDismissed() {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())) } catch (_) {}
  }

  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return
    var el = document.createElement('div')
    el.id = 'pwa-install-banner'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Installeer de Animato app')
    el.style.cssText = [
      'position:fixed',
      'left:16px',
      'right:16px',
      'bottom:16px',
      'z-index:9998',
      'background:white',
      'border-radius:14px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.18)',
      'padding:14px 16px',
      'display:flex',
      'align-items:center',
      'gap:12px',
      'max-width:520px',
      'margin-left:auto',
      'margin-right:auto',
      'border:1px solid rgba(0,0,0,0.06)',
      'font-family:Inter,system-ui,sans-serif',
      'animation:pwa-slide-up 240ms ease-out'
    ].join(';')
    el.innerHTML = [
      '<style>@keyframes pwa-slide-up{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>',
      '<img src="/static/images/pwa/icon-192.png" alt="" width="44" height="44" style="border-radius:10px;flex-shrink:0" />',
      '<div style="flex:1;min-width:0">',
      '  <div style="font-weight:600;color:#111827;font-size:14px;line-height:1.3">Installeer de Animato app</div>',
      '  <div style="color:#6b7280;font-size:12px;margin-top:2px;line-height:1.3">Snel toegang vanaf je startscherm, zonder browser-balken.</div>',
      '</div>',
      '<button type="button" id="pwa-install-dismiss" aria-label="Later" style="background:none;border:none;color:#6b7280;font-size:14px;padding:6px 10px;cursor:pointer;border-radius:6px">Later</button>',
      '<button type="button" id="pwa-install-accept" style="background:#00A9CE;color:white;border:none;padding:8px 14px;font-weight:600;font-size:13px;border-radius:8px;cursor:pointer;white-space:nowrap">Installeer</button>'
    ].join('')
    document.body.appendChild(el)

    document.getElementById('pwa-install-dismiss').addEventListener('click', function() {
      markDismissed()
      el.remove()
    })

    document.getElementById('pwa-install-accept').addEventListener('click', function() {
      if (!deferredPrompt) { el.remove(); return }
      deferredPrompt.prompt()
      deferredPrompt.userChoice.then(function(choice) {
        if (choice.outcome !== 'accepted') markDismissed()
        deferredPrompt = null
        el.remove()
      })
    })
  }

  window.addEventListener('beforeinstallprompt', function(e) {
    // Voorkom de default browser mini-infobar (bovenaan Chrome)
    e.preventDefault()
    deferredPrompt = e

    // Toon onze eigen prompt enkel als:
    //   - we nog niet zijn geïnstalleerd
    //   - gebruiker niet recent op "Later" heeft geklikt
    //   - er minstens 8 seconden verstreken zijn (niet meteen bij landing)
    if (isStandalone() || wasDismissedRecently()) return
    setTimeout(showInstallBanner, 8000)
  })

  window.addEventListener('appinstalled', function() {
    // Wis dismiss-flag zodat 'em bij re-install opnieuw kan tonen
    try { localStorage.removeItem(INSTALL_DISMISSED_KEY) } catch (_) {}
    deferredPrompt = null
  })
})()
