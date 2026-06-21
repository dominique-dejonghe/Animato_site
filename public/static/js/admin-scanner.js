(function() {
  'use strict';

  // ─── Bootstrap from <script data-...> attributes ──────────────────
  var _scriptTag = document.currentScript || document.querySelector('script[data-concert-id]');
  var _ds = (_scriptTag && _scriptTag.dataset) || {};

  // ─── State ──────────────────────────────────────────────────────────
  const CONCERT_ID = parseInt(_ds.concertId, 10);
  const HAS_SEATING_PLAN = _ds.hasSeatingPlan === '1' || _ds.hasSeatingPlan === 'true';
  const POLL_INTERVAL_MS = 3000;
  const SCAN_DEBOUNCE_MS = 2500;

  let currentState = { seats: [], counters: { total_paid: 0, checked_in: 0, remaining: 0, pct: 0 } };
  let recentScans = []; // { order_ref, koper_naam, time, status }
  let lastScannedCode = '';
  let lastScannedAt = 0;
  let pollingTimer = null;

  // Camera state
  let html5QrCode = null;
  let availableCameras = [];
  let currentCameraIdx = 0;
  let cameraRunning = false;
  let torchOn = false;

  // Modal state — welke order is open
  let currentModalOrder = null; // { ticket, seats, buyer_photo_url }
  let modalSelectedIds = new Set(); // welke ticket_seat_ids zijn aangevinkt

  // ─── Toast notifications (WebAudio beep + visual) ───────────────────
  function beep(freq, duration) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* niet kritiek */ }
  }

  function showToast(opts) {
    const { type, title, message, photo } = opts;
    const colors = {
      success: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-900', icon: 'fa-check-circle text-green-600' },
      warning: { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-900', icon: 'fa-exclamation-triangle text-amber-600' },
      error:   { bg: 'bg-red-50',   border: 'border-red-500',   text: 'text-red-900',   icon: 'fa-times-circle text-red-600' },
      info:    { bg: 'bg-blue-50',  border: 'border-blue-500',  text: 'text-blue-900',  icon: 'fa-info-circle text-blue-600' }
    };
    const c = colors[type] || colors.info;
    const toast = document.createElement('div');
    toast.className = c.bg + ' border-l-4 ' + c.border + ' rounded-lg shadow-lg p-4 pointer-events-auto transition-all duration-300';
    toast.style.cssText = 'min-width: 300px; max-width: 400px; transform: translateX(120%); opacity: 0;';
    const photoHtml = photo
      ? '<img src="' + photo + '" class="w-12 h-12 rounded-full object-cover border-2 border-white shadow flex-shrink-0">'
      : '<i class="fas ' + c.icon + ' text-3xl flex-shrink-0"></i>';
    toast.innerHTML = '<div class="flex items-start gap-3">'
      + photoHtml
      + '<div class="flex-1 min-w-0">'
      + '<p class="font-bold ' + c.text + '">' + escapeHtml(title) + '</p>'
      + (message ? '<p class="text-sm text-gray-700 mt-0.5">' + escapeHtml(message) + '</p>' : '')
      + '</div></div>';
    document.getElementById('toast-container').appendChild(toast);
    // Slide-in
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
    // Slide-out na 4s
    setTimeout(() => {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 350);
    }, 4000);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ─── State polling (elke 3s) ────────────────────────────────────────
  async function pollState() {
    try {
      const resp = await fetch('/api/admin/scanner/' + CONCERT_ID + '/state', { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      currentState = data;
      updateCounters();
      if (HAS_SEATING_PLAN) renderSeatMap();
      // Als de pending-lijst open is, ook bijwerken
      if (!document.getElementById('pending-section').classList.contains('hidden')) {
        renderPendingList();
      }
    } catch (e) {
      console.warn('Polling fout:', e.message);
    }
  }
  function startPolling() {
    pollState(); // Direct initiële fetch
    pollingTimer = setInterval(pollState, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  }

  // ─── Counters updaten ───────────────────────────────────────────────
  function updateCounters() {
    const c = currentState.counters || {};
    document.getElementById('counter-checked').textContent = c.checked_in || 0;
    document.getElementById('counter-total').textContent = c.total_paid || 0;
    document.getElementById('counter-pct').textContent = (c.pct || 0) + '%';
    document.getElementById('counter-remaining').textContent = c.remaining || 0;
  }

  // ─── Zaalplan-rendering ─────────────────────────────────────────────
  function seatColor(s) {
    // Niet verkocht of geblokt
    const isBooked = s.booking_status && s.ticket_status === 'paid';
    if (!isBooked) {
      if (s.base_status === 'blocked') return { bg: '#D1D5DB', fg: '#6B7280' }; // grijs
      if (s.type === 'wheelchair')      return { bg: '#D1FAE5', fg: '#065F46' }; // licht-groen
      return { bg: '#E5E7EB', fg: '#9CA3AF' }; // licht-grijs (vrij)
    }
    // Verkocht en ingecheckt
    if (s.checked_in_at) return { bg: '#10B981', fg: 'white' }; // groen
    // Verkocht, nog niet binnen
    return { bg: '#3B82F6', fg: 'white' }; // blauw
  }

  function toExcelLetter(idx) {
    let s = ''; let n = idx;
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  }

  function renderSeatMap() {
    const map = document.getElementById('seatMap');
    if (!map) return;
    const seats = currentState.seats || [];

    // Hou statische elementen (podium, gang) — verwijder enkel dynamische
    Array.from(map.children).forEach(child => {
      if (!child.hasAttribute('data-static')) child.remove();
    });

    // Rij-labels berekenen
    const yMap = {};
    seats.forEach(seat => {
      const k = seat.y;
      if (!yMap[k]) yMap[k] = { minX: seat.x, maxX: seat.x, lbl: seat.row_label || '' };
      if (seat.x < yMap[k].minX) yMap[k].minX = seat.x;
      if (seat.x > yMap[k].maxX) yMap[k].maxX = seat.x;
      if (!yMap[k].lbl && seat.row_label) yMap[k].lbl = seat.row_label;
    });
    const sortedYs = Object.keys(yMap).map(Number).sort((a, b) => a - b);
    sortedYs.forEach((y, idx) => {
      const g = yMap[y];
      const lbl = g.lbl || toExcelLetter(idx);
      const shared = 'top:' + (y + 4) + 'px;background:rgba(255,255,255,.95);padding:2px 6px;'
        + 'border-radius:4px;border:1px solid #cbd5e1;letter-spacing:.05em;z-index:5;'
        + 'min-width:24px;text-align:center;line-height:1.1;font-size:11px;';
      const left = document.createElement('div');
      left.className = 'absolute font-bold text-gray-700 pointer-events-none';
      left.style.cssText = 'left:' + (g.minX - 38) + 'px;' + shared;
      left.innerText = lbl;
      map.appendChild(left);
      const right = document.createElement('div');
      right.className = 'absolute font-bold text-gray-700 pointer-events-none';
      right.style.cssText = 'left:' + (g.maxX + 38) + 'px;' + shared;
      right.innerText = lbl;
      map.appendChild(right);
    });

    // Stoelen
    seats.forEach(seat => {
      const el = document.createElement('div');
      el.className = 'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-[10px] font-bold shadow-sm transition-all';
      el.style.left = seat.x + 'px';
      el.style.top = seat.y + 'px';
      el.innerText = seat.seat_number;
      const c = seatColor(seat);
      el.style.backgroundColor = c.bg;
      el.style.color = c.fg;
      const isBooked = seat.booking_status && seat.ticket_status === 'paid';
      if (isBooked) {
        el.style.cursor = 'pointer';
        el.classList.add('hover:scale-110');
        // Tooltip op hover
        const status = seat.checked_in_at ? 'BINNEN' : 'verwacht';
        el.title = (seat.row_label || '') + '-' + seat.seat_number
          + ' · ' + (seat.koper_naam || '?') + ' · ' + status;
        // Vinkje overlay voor ingechecked
        if (seat.checked_in_at) {
          const check = document.createElement('div');
          check.style.cssText = 'position:absolute;top:-4px;right:-4px;background:white;color:#10B981;'
            + 'width:14px;height:14px;border-radius:50%;font-size:8px;display:flex;'
            + 'align-items:center;justify-content:center;box-shadow:0 0 0 2px #10B981;';
          check.innerHTML = '<i class="fas fa-check" style="font-size:7px"></i>';
          el.appendChild(check);
        }
        el.onclick = () => openOrderModal(seat.order_ref);
      } else {
        el.style.cursor = 'default';
        el.style.opacity = '0.6';
        el.title = (seat.row_label || '') + '-' + seat.seat_number + ' · vrij';
      }
      map.appendChild(el);
    });

    // Auto-fit op eerste render
    if (!renderSeatMap._fitDone) {
      fitSeatMap();
      renderSeatMap._fitDone = true;
    }
  }

  function fitSeatMap() {
    const frame = document.getElementById('seatMapFrame');
    const scale = document.getElementById('seatMapScale');
    if (!frame || !scale) return;
    const seats = currentState.seats || [];
    if (seats.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    seats.forEach(s => {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x + 32 > maxX) maxX = s.x + 32;
      if (s.y + 32 > maxY) maxY = s.y + 32;
    });
    const contentW = Math.max(50, maxX - minX + 88);
    const contentH = Math.max(50, maxY + 40);
    const frameW = frame.clientWidth - 8;
    const frameH = frame.clientHeight - 8;
    const scaleX = frameW / contentW;
    const scaleY = frameH / contentH;
    const k = Math.min(scaleX, scaleY, 1);
    scale.style.transform = 'scale(' + k + ')';
    scale.style.transformOrigin = 'top left';
    scale.style.width = contentW + 'px';
    scale.style.height = contentH + 'px';
  }

  window.addEventListener('resize', () => { renderSeatMap._fitDone = false; fitSeatMap(); });

  // ─── QR Validatie + multi-seat modal flow ───────────────────────────
  async function validateQR() {
    const input = document.getElementById('qr-input');
    const raw = input.value.trim();
    if (!raw) return;

    // Parse "qr_code-ticket_seat_id" formaat
    const m = raw.match(/^(.+)-(\d+)$/);
    let qrCode = raw;
    let scannedSeatId = null;
    if (m) { qrCode = m[1]; scannedSeatId = parseInt(m[2], 10); }

    // Zoek ticket via order-ref (omdat qr_code = order-niveau in onze DB)
    // We hebben de state al — zoek lokaal
    const matchSeat = currentState.seats.find(s => {
      // qr_code zit niet direct in state, maar order_ref kan gematcht worden
      // via ticket-info uit state. We doen daarom een fetch naar de QR-API
      // — die kent qr_code → ticket-mapping.
      return false;
    });

    // Doe een API-call naar de bestaande validate-qr endpoint die qr_code → ticket-info kent
    try {
      const resp = await fetch('/api/admin/tickets/validate-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ qr_code: raw, concert_id: CONCERT_ID })
      });
      const data = await resp.json();

      if (data.status === 'not_found' || !data.valid) {
        beep(220, 0.4);
        showToast({ type: 'error', title: 'Ongeldig ticket', message: data.message || 'QR niet gevonden voor dit concert' });
        input.value = '';
        return;
      }

      // De backend heeft de scan al ge-checked-in (1 stoel). We willen echter
      // de multi-seat modal tonen zodat admin de hele order kan zien.
      // Open modal voor deze order.
      input.value = '';
      await openOrderModal(data.ticket.order_ref, {
        afterScanSeatId: scannedSeatId,
        autoCheckedIn: data.status === 'checked_in'
      });

      // Update state direct (anders zien we de groene stoel pas na volgende poll)
      pollState();
    } catch (e) {
      showToast({ type: 'error', title: 'Server fout', message: e.message });
    }
  }

  // ─── Order-modal openen ─────────────────────────────────────────────
  async function openOrderModal(orderRef, opts) {
    opts = opts || {};
    try {
      const resp = await fetch('/api/admin/scanner/' + CONCERT_ID + '/order/' + encodeURIComponent(orderRef), { credentials: 'same-origin' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showToast({ type: 'error', title: 'Kan order niet ophalen', message: err.error || 'HTTP ' + resp.status });
        return;
      }
      const data = await resp.json();
      currentModalOrder = data;
      modalSelectedIds = new Set();

      // Smart default (Optie c):
      // - Solo-stoel + nog niet binnen → auto-check (geen modal openen)
      // - Multi-stoel of correctie → modal openen
      const notYet = data.seats.filter(s => !s.checked_in_at);
      if (notYet.length === 1 && opts.afterScanSeatId && opts.autoCheckedIn) {
        // Backend heeft al ingecheckt — toon enkel een success toast
        beep(880, 0.15);
        showToast({
          type: 'success',
          title: 'Welkom ' + (data.ticket.koper_naam || '!').split(' ')[0],
          message: 'Rij ' + (notYet[0].row_label || '?') + '-' + (notYet[0].seat_number || '?'),
          photo: data.buyer_photo_url
        });
        addRecentScan(data.ticket, [notYet[0]]);
        return;
      }

      // Pre-select de gescande stoel (indien aanwezig en nog niet binnen)
      data.seats.forEach(s => {
        if (!s.checked_in_at && opts.afterScanSeatId && s.ticket_seat_id === opts.afterScanSeatId) {
          modalSelectedIds.add(s.ticket_seat_id);
        }
      });

      renderOrderModal();
      document.getElementById('order-modal').classList.remove('hidden');
    } catch (e) {
      showToast({ type: 'error', title: 'Server fout', message: e.message });
    }
  }

  function renderOrderModal() {
    if (!currentModalOrder) return;
    const { ticket, seats, buyer_photo_url } = currentModalOrder;
    document.getElementById('modal-title').textContent = ticket.koper_naam || '(onbekend)';
    document.getElementById('modal-subtitle').textContent = 'Order ' + ticket.order_ref + ' · ' + (ticket.categorie || '') + ' · ' + seats.length + ' stoel' + (seats.length === 1 ? '' : 'en');

    if (buyer_photo_url) {
      document.getElementById('modal-photo').src = buyer_photo_url;
      document.getElementById('modal-photo-wrap').classList.remove('hidden');
    } else {
      document.getElementById('modal-photo-wrap').classList.add('hidden');
    }

    const list = document.getElementById('modal-seats');
    list.innerHTML = '';
    seats.forEach(s => {
      const row = document.createElement('div');
      const isChecked = !!s.checked_in_at;
      const isSelected = modalSelectedIds.has(s.ticket_seat_id);
      row.className = 'flex items-center gap-3 p-3 rounded border ' + (isChecked ? 'bg-green-50 border-green-300' : isSelected ? 'bg-teal-50 border-teal-400' : 'bg-white border-gray-200 hover:bg-gray-50');

      if (isChecked) {
        // Reeds binnen — toon uitcheck-knop
        const time = s.checked_in_at ? new Date(s.checked_in_at.includes('T') ? s.checked_in_at : s.checked_in_at.replace(' ', 'T') + 'Z').toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '?';
        row.innerHTML =
          '<i class="fas fa-check-circle text-green-500 text-xl"></i>'
          + '<div class="flex-1 min-w-0">'
          +   '<p class="font-medium text-gray-900">Rij ' + escapeHtml(s.row_label || '?') + '-' + escapeHtml(s.seat_number || '?') + '</p>'
          +   '<p class="text-xs text-gray-500">Ingecheckt om ' + time + (s.checked_in_by_naam ? ' door ' + escapeHtml(s.checked_in_by_naam) : '') + '</p>'
          + '</div>'
          + '<button onclick="uncheckSeat(' + s.ticket_seat_id + ')" class="px-3 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-medium">'
          +   '<i class="fas fa-undo mr-1"></i>Uitchecken'
          + '</button>';
      } else {
        // Nog niet binnen — checkbox
        row.innerHTML =
          '<input type="checkbox" id="seat-cb-' + s.ticket_seat_id + '" ' + (isSelected ? 'checked' : '') + ' class="w-5 h-5 text-teal-600 rounded focus:ring-teal-500" onchange="toggleSeatSelect(' + s.ticket_seat_id + ', this.checked)">'
          + '<label for="seat-cb-' + s.ticket_seat_id + '" class="flex-1 cursor-pointer">'
          +   '<p class="font-medium text-gray-900">Rij ' + escapeHtml(s.row_label || '?') + '-' + escapeHtml(s.seat_number || '?') + '</p>'
          +   '<p class="text-xs text-gray-500">Nog niet binnen</p>'
          + '</label>';
      }
      list.appendChild(row);
    });

    updateModalConfirmCount();
  }

  window.toggleSeatSelect = function(seatId, checked) {
    if (checked) modalSelectedIds.add(seatId);
    else modalSelectedIds.delete(seatId);
    updateModalConfirmCount();
    // Visuele update
    renderOrderModal();
  };

  function updateModalConfirmCount() {
    const btn = document.getElementById('modal-confirm-btn');
    const cnt = document.getElementById('modal-confirm-count');
    cnt.textContent = modalSelectedIds.size;
    if (modalSelectedIds.size === 0) {
      btn.disabled = true;
      btn.className = 'px-6 py-2 bg-gray-300 text-gray-500 rounded text-sm font-medium cursor-not-allowed';
    } else {
      btn.disabled = false;
      btn.className = 'px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm font-medium';
    }
  }

  window.closeOrderModal = function() {
    document.getElementById('order-modal').classList.add('hidden');
    currentModalOrder = null;
    modalSelectedIds = new Set();
  };

  window.confirmCheckIn = async function() {
    if (modalSelectedIds.size === 0) return;
    const ids = Array.from(modalSelectedIds);
    try {
      const resp = await fetch('/api/admin/scanner/' + CONCERT_ID + '/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ticket_seat_ids: ids })
      });
      const data = await resp.json();
      if (!data.success) {
        showToast({ type: 'error', title: 'Fout bij inchecken', message: data.error });
        return;
      }
      const s = data.summary;
      beep(880, 0.15);
      const seatsCheckedIn = currentModalOrder.seats.filter(x => ids.includes(x.ticket_seat_id) && !x.checked_in_at);
      showToast({
        type: 'success',
        title: 'Welkom ' + (currentModalOrder.ticket.koper_naam || '!').split(' ')[0] + '!',
        message: s.checked_in + ' stoel' + (s.checked_in === 1 ? '' : 'en') + ' ingecheckt',
        photo: currentModalOrder.buyer_photo_url
      });
      addRecentScan(currentModalOrder.ticket, seatsCheckedIn);
      closeOrderModal();
      pollState();
    } catch (e) {
      showToast({ type: 'error', title: 'Server fout', message: e.message });
    }
  };

  window.uncheckSeat = async function(ticketSeatId) {
    if (!confirm('Stoel uitchecken? Deze persoon wordt weer als "nog niet binnen" gemarkeerd.')) return;
    try {
      const resp = await fetch('/api/admin/scanner/' + CONCERT_ID + '/uncheck-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ticket_seat_id: ticketSeatId })
      });
      const data = await resp.json();
      if (data.success) {
        showToast({ type: 'info', title: 'Stoel uitgecheckt', message: 'Persoon weer op pendinglijst' });
        // Reload de modal-data
        if (currentModalOrder) await openOrderModal(currentModalOrder.ticket.order_ref);
        pollState();
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Server fout', message: e.message });
    }
  };

  // ─── Recent gescand-lijst ───────────────────────────────────────────
  function addRecentScan(ticket, seats) {
    const seatLabels = seats.map(s => (s.row_label || '?') + '-' + (s.seat_number || '?')).join(', ');
    recentScans.unshift({
      order_ref: ticket.order_ref,
      koper_naam: ticket.koper_naam || '(onbekend)',
      seats: seatLabels,
      time: new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    if (recentScans.length > 8) recentScans.pop();
    renderRecentList();
  }
  function renderRecentList() {
    const list = document.getElementById('recent-list');
    if (recentScans.length === 0) {
      list.innerHTML = '<p class="text-gray-400 italic">Nog niets gescand…</p>';
      return;
    }
    list.innerHTML = recentScans.map(r =>
      '<div class="flex items-center justify-between gap-2 py-1.5 px-2 bg-green-50 border border-green-200 rounded cursor-pointer hover:bg-green-100" onclick="openOrderModal(\'' + escapeHtml(r.order_ref) + '\')">'
      + '<div class="flex-1 min-w-0">'
      +   '<p class="font-medium text-gray-900 truncate">' + escapeHtml(r.koper_naam) + '</p>'
      +   '<p class="text-[10px] text-gray-500">' + escapeHtml(r.seats) + '</p>'
      + '</div>'
      + '<span class="text-[10px] text-gray-500 flex-shrink-0">' + escapeHtml(r.time) + '</span>'
      + '</div>'
    ).join('');
  }

  // ─── Pending lijst (nog niet binnen) ────────────────────────────────
  window.togglePendingList = function() {
    const sec = document.getElementById('pending-section');
    if (sec.classList.contains('hidden')) {
      sec.classList.remove('hidden');
      renderPendingList();
    } else {
      sec.classList.add('hidden');
    }
  };
  function renderPendingList() {
    const list = document.getElementById('pending-list');
    const pending = (currentState.seats || []).filter(s =>
      s.booking_status && s.ticket_status === 'paid' && !s.checked_in_at
    );
    // Groepeer per order
    const byOrder = {};
    pending.forEach(s => {
      const ref = s.order_ref || '?';
      if (!byOrder[ref]) byOrder[ref] = { koper_naam: s.koper_naam || '?', seats: [] };
      byOrder[ref].seats.push(s);
    });
    const orderRefs = Object.keys(byOrder).sort((a, b) => byOrder[a].koper_naam.localeCompare(byOrder[b].koper_naam));
    if (orderRefs.length === 0) {
      list.innerHTML = '<p class="text-gray-400 italic">Iedereen is binnen! 🎉</p>';
      return;
    }
    list.innerHTML = orderRefs.map(ref => {
      const o = byOrder[ref];
      const seatLabels = o.seats.map(s => (s.row_label || '?') + '-' + (s.seat_number || '?')).join(', ');
      return '<div class="flex items-center justify-between gap-2 py-1.5 px-2 bg-amber-50 border border-amber-200 rounded cursor-pointer hover:bg-amber-100" onclick="openOrderModal(\'' + escapeHtml(ref) + '\')">'
        + '<div class="flex-1 min-w-0">'
        +   '<p class="font-medium text-gray-900 truncate">' + escapeHtml(o.koper_naam) + '</p>'
        +   '<p class="text-[10px] text-gray-500">' + escapeHtml(seatLabels) + '</p>'
        + '</div>'
        + '<i class="fas fa-chevron-right text-gray-400 text-[10px]"></i>'
        + '</div>';
    }).join('');
  }

  // ─── Zoeken (debounced) ─────────────────────────────────────────────
  let searchDebounce = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    if (searchDebounce) clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('search-results').classList.add('hidden');
      return;
    }
    searchDebounce = setTimeout(() => doSearch(q), 300);
  });

  async function doSearch(q) {
    try {
      const resp = await fetch('/api/admin/scanner/' + CONCERT_ID + '/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
      const data = await resp.json();
      const results = data.results || [];
      const container = document.getElementById('search-results');
      if (results.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 p-3">Geen resultaten gevonden.</p>';
        container.classList.remove('hidden');
        return;
      }
      container.innerHTML = results.map(r => {
        const allIn = r.total_seats > 0 && r.checked_in_seats === r.total_seats;
        const partial = r.checked_in_seats > 0 && r.checked_in_seats < r.total_seats;
        const statusBadge = allIn
          ? '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full"><i class="fas fa-check mr-1"></i>Binnen</span>'
          : partial
          ? '<span class="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">' + r.checked_in_seats + '/' + r.total_seats + '</span>'
          : '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">' + r.total_seats + ' stoel' + (r.total_seats === 1 ? '' : 'en') + '</span>';
        return '<div class="flex items-center justify-between gap-2 p-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50" onclick="openOrderModal(\'' + escapeHtml(r.order_ref) + '\'); document.getElementById(\'search-results\').classList.add(\'hidden\'); document.getElementById(\'search-input\').value=\'\';">'
          + '<div class="flex-1 min-w-0">'
          +   '<p class="font-medium text-sm text-gray-900 truncate">' + escapeHtml(r.koper_naam || '(geen naam)') + '</p>'
          +   '<p class="text-xs text-gray-500 truncate">' + escapeHtml(r.koper_email || '') + ' · ' + escapeHtml(r.order_ref) + '</p>'
          + '</div>'
          + statusBadge
          + '</div>';
      }).join('');
      container.classList.remove('hidden');
    } catch (e) {
      console.error(e);
    }
  }

  // Klik buiten search-results → sluit
  document.addEventListener('click', (e) => {
    const c = document.getElementById('search-results');
    const i = document.getElementById('search-input');
    if (c && !c.contains(e.target) && e.target !== i) c.classList.add('hidden');
  });

  // ─── QR input keyboard ──────────────────────────────────────────────
  document.getElementById('qr-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); validateQR(); }
  });
  window.validateQR = validateQR;
  window.openOrderModal = openOrderModal;

  // ─── Camera ─────────────────────────────────────────────────────────
  window.startCamera = async function() {
    if (cameraRunning) return;
    if (typeof Html5Qrcode === 'undefined') {
      document.getElementById('cam-error').classList.remove('hidden');
      document.getElementById('cam-error-msg').textContent = 'QR-library niet geladen. Refresh de pagina.';
      return;
    }
    try {
      const cams = await Html5Qrcode.getCameras();
      if (!cams || cams.length === 0) throw new Error('Geen camera gevonden');
      availableCameras = cams;
      // Voorkeur achter-camera (mobile)
      let initialIdx = 0;
      for (let i = 0; i < cams.length; i++) {
        const lbl = (cams[i].label || '').toLowerCase();
        if (lbl.includes('back') || lbl.includes('environment') || lbl.includes('rear')) { initialIdx = i; break; }
      }
      currentCameraIdx = initialIdx;
      await launchCamera();
    } catch (e) {
      document.getElementById('cam-error').classList.remove('hidden');
      document.getElementById('cam-error-msg').textContent = e.message || 'Camera-fout';
    }
  };

  async function launchCamera() {
    if (!html5QrCode) html5QrCode = new Html5Qrcode('cam-reader');
    document.getElementById('cam-reader-wrap').classList.remove('hidden');
    document.getElementById('cam-error').classList.add('hidden');
    document.getElementById('cam-start-btn').classList.add('hidden');
    document.getElementById('cam-stop-btn').classList.remove('hidden');
    if (availableCameras.length > 1) document.getElementById('cam-flip-btn').classList.remove('hidden');

    await html5QrCode.start(
      availableCameras[currentCameraIdx].id,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      onScanError
    );
    cameraRunning = true;
    document.getElementById('cam-status').innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Scant…';
  }

  window.stopCamera = async function() {
    if (!cameraRunning || !html5QrCode) return;
    try { await html5QrCode.stop(); } catch (e) {}
    cameraRunning = false;
    torchOn = false;
    document.getElementById('cam-reader-wrap').classList.add('hidden');
    document.getElementById('cam-start-btn').classList.remove('hidden');
    document.getElementById('cam-stop-btn').classList.add('hidden');
    document.getElementById('cam-flip-btn').classList.add('hidden');
    document.getElementById('cam-torch-btn').classList.add('hidden');
  };

  window.flipCamera = async function() {
    if (!cameraRunning || availableCameras.length < 2) return;
    await html5QrCode.stop();
    currentCameraIdx = (currentCameraIdx + 1) % availableCameras.length;
    await launchCamera();
  };

  window.toggleTorch = async function() {
    if (!cameraRunning || !html5QrCode) return;
    try {
      const cap = html5QrCode.getRunningTrackCameraCapabilities();
      if (cap && cap.torchFeature && cap.torchFeature().isSupported()) {
        torchOn = !torchOn;
        await cap.torchFeature().apply(torchOn);
      }
    } catch (e) { /* niet kritiek */ }
  };

  function onScanSuccess(decodedText) {
    const now = Date.now();
    if (decodedText === lastScannedCode && (now - lastScannedAt) < SCAN_DEBOUNCE_MS) return;
    lastScannedCode = decodedText;
    lastScannedAt = now;
    document.getElementById('qr-input').value = decodedText;
    validateQR();
  }
  function onScanError(err) { /* stil — wordt elke frame zonder QR gecalled */ }

  // ─── Init ───────────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => { stopPolling(); if (cameraRunning) stopCamera(); });
  startPolling();
})();
