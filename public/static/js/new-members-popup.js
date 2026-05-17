// =====================================================
// NIEUWE-LID AANKONDIGING POPUP
// =====================================================
//
// Toont een feestelijke popup met confetti voor bestaande koorleden
// wanneer er nieuwe leden zijn die ze nog niet zagen.
//
// Werking:
//   1. Bij DOMContentLoaded: GET /api/leden/new-members
//   2. Als items.length > 0 \u2192 toon fullscreen modal met confetti
//   3. Bij sluiten of klik "Maak kennis" \u2192 POST mark-seen met alle ids
//
// Dit script is "best effort": bij netwerkfout, geen confetti meer
// dan een console.warn. Geen UX-blocker.

(function() {
  'use strict';

  // Wacht tot DOM klaar is
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNewMembersPopup);
  } else {
    initNewMembersPopup();
  }

  async function initNewMembersPopup() {
    try {
      const res = await fetch('/api/leden/new-members', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return; // niet ingelogd of fout \u2192 stil

      const data = await res.json();
      if (!data.items || data.items.length === 0) return;

      showNewMembersPopup(data.items);
    } catch (err) {
      console.warn('[new-members] fetch failed:', err);
    }
  }

  function showNewMembersPopup(members) {
    // Bouw modal HTML dynamisch
    const overlay = document.createElement('div');
    overlay.id = 'new-members-overlay';
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    overlay.style.cssText = 'background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);';

    const isPlural = members.length > 1;
    const title = isPlural
      ? `\ud83c\udf89 ${members.length} nieuwe koorleden!`
      : '\ud83c\udf89 Welkom aan ons nieuw koorlid!';
    const subtitle = isPlural
      ? 'Ze sluiten zich aan bij Animato. Maak kennis met hen!'
      : 'Hij/zij sluit zich aan bij Animato. Maak kennis!';

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative animate-popin">
        <button id="new-members-close" aria-label="Sluiten"
                class="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition flex items-center justify-center z-10">
          <i class="fas fa-times"></i>
        </button>

        <div class="bg-gradient-to-br from-animato-secondary to-animato-primary text-white px-6 py-8 sm:px-8 sm:py-10 rounded-t-2xl text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4 animate-pulse">
            <i class="fas fa-users text-3xl"></i>
          </div>
          <h2 class="text-2xl sm:text-3xl font-bold mb-2" style="font-family: 'Playfair Display', serif;">
            ${escapeHtml(title)}
          </h2>
          <p class="text-white/90 text-base sm:text-lg">${escapeHtml(subtitle)}</p>
        </div>

        <div class="px-6 py-6 sm:px-8 sm:py-8 space-y-4">
          ${members.map(renderMemberCard).join('')}
        </div>

        <div class="px-6 pb-6 sm:px-8 sm:pb-8">
          <a id="new-members-cta"
             href="/leden/smoelenboek"
             class="block w-full text-center bg-animato-accent hover:bg-yellow-500 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-yellow-500/30 transition-all">
            <i class="fas fa-id-card mr-2"></i>
            Bekijk smoelenboek
          </a>
          <button id="new-members-dismiss"
                  class="block w-full text-center mt-3 text-gray-600 hover:text-gray-900 text-sm py-2 transition">
            Sluiten
          </button>
        </div>
      </div>

      <style>
        @keyframes popin {
          0% { transform: scale(0.85); opacity: 0; }
          60% { transform: scale(1.03); }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-popin { animation: popin 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
      </style>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden'; // voorkom scroll achter modal

    // Confetti vuren!
    fireConfetti();

    // Close handlers
    const ids = members.map(m => m.id);
    const closeBtn = overlay.querySelector('#new-members-close');
    const dismissBtn = overlay.querySelector('#new-members-dismiss');
    const ctaBtn = overlay.querySelector('#new-members-cta');

    const closeModal = async (markSeen = true) => {
      if (markSeen) await markMembersSeen(ids);
      overlay.remove();
      document.body.style.overflow = '';
    };

    closeBtn?.addEventListener('click', () => closeModal(true));
    dismissBtn?.addEventListener('click', () => closeModal(true));
    // CTA: markeer als gezien EN navigeer
    ctaBtn?.addEventListener('click', (e) => {
      // markSeen async laten lopen, navigatie niet blokkeren
      markMembersSeen(ids).catch(() => {});
    });

    // Klik op overlay buiten modal \u2192 sluit
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(true);
    });

    // Escape \u2192 sluit
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        closeModal(true);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function renderMemberCard(m) {
    const stemgroepBadge = m.stemgroep_label
      ? `<span class="inline-block bg-animato-primary/10 text-animato-primary text-xs font-semibold px-2.5 py-1 rounded-full">${escapeHtml(m.stemgroep_label)}</span>`
      : '';

    const photoHtml = m.foto_url
      ? `<img src="${escapeHtml(m.foto_url)}" alt="${escapeHtml(m.fullname)}" class="w-16 h-16 rounded-full object-cover border-2 border-animato-primary shadow"/>`
      : `<div class="w-16 h-16 rounded-full bg-gradient-to-br from-animato-secondary to-animato-primary text-white flex items-center justify-center text-xl font-bold border-2 border-animato-primary shadow">
           ${escapeHtml((m.voornaam[0] || '?') + (m.achternaam[0] || ''))}
         </div>`;

    const lidSinds = formatLidSinds(m.created_at);

    return `
      <div class="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-xl hover:shadow-md transition">
        ${photoHtml}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-lg font-semibold text-gray-900 truncate">${escapeHtml(m.fullname)}</h3>
            ${stemgroepBadge}
          </div>
          <p class="text-sm text-gray-500 mt-0.5">
            <i class="fas fa-calendar-check mr-1 text-animato-primary"></i>
            Lid sinds ${escapeHtml(lidSinds)}
          </p>
        </div>
      </div>
    `;
  }

  function formatLidSinds(isoDate) {
    if (!isoDate) return 'recent';
    try {
      // SQLite formaat "2026-05-15 20:25:35" \u2192 Date
      const d = new Date(isoDate.replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return 'recent';

      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'vandaag';
      if (diffDays === 1) return 'gisteren';
      if (diffDays < 7) return `${diffDays} dagen geleden`;

      return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return 'recent';
    }
  }

  async function markMembersSeen(ids) {
    if (!ids || ids.length === 0) return;
    try {
      await fetch('/api/leden/new-members/mark-seen', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.warn('[new-members] mark-seen failed:', err);
    }
  }

  function fireConfetti() {
    // canvas-confetti CDN moet ingeladen zijn voor we vuren
    if (typeof window.confetti !== 'function') {
      // Lazy-load
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
      script.onload = () => doFireConfetti();
      document.head.appendChild(script);
      return;
    }
    doFireConfetti();
  }

  function doFireConfetti() {
    const colors = ['#00A9CE', '#1B4D5C', '#F59E0B', '#FFFFFF', '#FFD700'];

    // Burst 1 \u2014 links
    setTimeout(() => window.confetti({
      particleCount: 70,
      angle: 60,
      spread: 65,
      origin: { x: 0.1, y: 0.6 },
      colors,
      startVelocity: 50,
      zIndex: 10000,
    }), 50);

    // Burst 2 \u2014 rechts
    setTimeout(() => window.confetti({
      particleCount: 70,
      angle: 120,
      spread: 65,
      origin: { x: 0.9, y: 0.6 },
      colors,
      startVelocity: 50,
      zIndex: 10000,
    }), 200);

    // Burst 3 \u2014 centraal groot
    setTimeout(() => window.confetti({
      particleCount: 120,
      spread: 100,
      origin: { y: 0.4 },
      colors,
      startVelocity: 45,
      zIndex: 10000,
    }), 500);

    // Subtiele continue val \u2014 6 seconden
    const duration = 6 * 1000;
    const animationEnd = Date.now() + duration;
    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval);
      window.confetti({
        particleCount: 2,
        startVelocity: 0,
        ticks: 200,
        origin: { x: Math.random(), y: 0 },
        colors,
        gravity: 0.4,
        scalar: 0.8,
        zIndex: 10000,
      });
    }, 250);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
