/**
 * Seat Map Renderer + Interaction
 *
 * Verwacht globale config in `window.ANIMATO_SEATMAP`:
 *   {
 *     prijzen:         [{ categorie, prijs, beschrijving? }, ...],
 *     seats:           [{ id, x, y, row_label, seat_number, type, effective_status }, ...],
 *     planW:           number,
 *     planH:           number,
 *     seatingPlanId:   number | null,
 *   }
 *
 * Verantwoordelijk voor:
 *   - Renderen van stoelen + rij-labels + gang (bij plan 1)
 *   - Auto-fit + zoom-knoppen (bestaand)
 *   - Fullscreen-modal met verplaats-in-place (bestaand)
 *   - NIEUW: mobile-first flow (< 768px):
 *       * inline plan wordt CTA-knop → opent modal
 *       * pinch-to-zoom + drag-to-pan met touch events
 *       * sticky bottom-bar met "N stoelen · €YY · Doorgaan"
 *   - NIEUW: chip-lijst van geselecteerde stoelen boven order-form
 *     (zichtbaar op alle schermgroottes, staat leeg als niets is gekozen)
 */
(function () {
  'use strict';

  const cfg = window.ANIMATO_SEATMAP;
  if (!cfg || !cfg.seats) return;

  const { prijzen, seats, planW, planH, seatingPlanId } = cfg;
  const hasSeatingPlan = seats.length > 0;
  const SEAT_SIZE = 32; // CSS-px in origineel

  // Selectie-state — gedeeld met updateTotal (window-scope zodat externe hooks werken)
  window.selectedSeats = [];

  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

  // ── Excel-style fallback voor rijlabel op basis van y-volgorde ──
  function toExcelLetter(idx) {
    let s = '';
    let n = idx;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  // ================================================================
  // 1. RENDER: rij-labels, gang, stoelen
  // ================================================================
  const map = document.getElementById('seatMap');
  if (!map) return;
  map.style.overflow = 'visible';

  const yMap = {};
  seats.forEach((seat) => {
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
    const sharedStyle =
      'top:' + (y + 4) + 'px;' +
      'background:rgba(255,255,255,.95);padding:2px 6px;border-radius:4px;' +
      'border:1px solid #cbd5e1;letter-spacing:.05em;z-index:5;' +
      'min-width:24px;text-align:center;line-height:1.1;font-size:11px;';
    const leftTag = document.createElement('div');
    leftTag.className = 'absolute font-bold text-gray-700 pointer-events-none';
    leftTag.style.cssText = 'left:' + (g.minX - 38) + 'px;' + sharedStyle;
    leftTag.innerText = lbl;
    map.appendChild(leftTag);
    const rightTag = document.createElement('div');
    rightTag.className = 'absolute font-bold text-gray-700 pointer-events-none';
    rightTag.style.cssText = 'left:' + (g.maxX + 32 + 6) + 'px;' + sharedStyle;
    rightTag.innerText = lbl;
    map.appendChild(rightTag);
  });

  // Gang tussen rij B en C — enkel voor cc Binder (plan_id = 1)
  if (seatingPlanId === 1) {
    const yB = Object.entries(yMap).find(([_, g]) => g.lbl === 'B');
    const yC = Object.entries(yMap).find(([_, g]) => g.lbl === 'C');
    if (yB && yC) {
      const yBn = Number(yB[0]);
      const yCn = Number(yC[0]);
      const yMid = yBn + (yCn - yBn) / 2 + 16;
      let minX = Infinity, maxX = -Infinity;
      Object.values(yMap).forEach((g) => {
        if (g.minX < minX) minX = g.minX;
        if (g.maxX > maxX) maxX = g.maxX;
      });
      const aisleW = (maxX + 32) - minX;
      const aisle = document.createElement('div');
      aisle.className = 'absolute pointer-events-none';
      aisle.style.cssText =
        'left:' + minX + 'px;top:' + (yMid - 10) + 'px;' +
        'width:' + aisleW + 'px;height:20px;z-index:3;' +
        'border-top:2px dashed #94a3b8;border-bottom:2px dashed #94a3b8;' +
        'background:repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 6px,#e2e8f0 6px,#e2e8f0 12px);' +
        'display:flex;align-items:center;justify-content:center;';
      const lblG = document.createElement('span');
      lblG.innerHTML = '<i class="fas fa-walking" style="margin-right:6px"></i>GANG';
      lblG.style.cssText =
        'background:#fff;padding:1px 10px;border:1px solid #94a3b8;' +
        'border-radius:10px;font-size:10px;font-weight:bold;color:#475569;' +
        'letter-spacing:.1em;';
      aisle.appendChild(lblG);
      map.appendChild(aisle);
    }
  }

  // ── Stoelen zelf ──
  const seatElements = new Map(); // seat.id -> DOM element (voor toggleSeat vanuit chip)
  seats.forEach((seat) => {
    const el = document.createElement('div');
    el.className =
      'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-[10px] text-white font-bold shadow-sm transition-transform';
    el.style.left = seat.x + 'px';
    el.style.top = seat.y + 'px';
    el.innerText = seat.seat_number;
    el.title = (seat.row_label || '') + ' - Stoel ' + seat.seat_number;

    if (seat.effective_status !== 'available') {
      el.style.backgroundColor = '#D1D5DB';
      el.style.cursor = 'not-allowed';
      el.title += ' (Niet beschikbaar)';
    } else {
      el.style.cursor = 'pointer';
      el.classList.add('hover:scale-110');
      if (seat.type === 'wheelchair') {
        el.style.backgroundColor = '#10B981';
        el.innerHTML = '<i class="fas fa-wheelchair"></i>';
      } else {
        el.style.backgroundColor = '#3B82F6';
      }
      el.onclick = () => toggleSeat(seat, el);
    }
    map.appendChild(el);
    seatElements.set(seat.id, el);
  });

  // ================================================================
  // 2. ZOOM + FIT
  // ================================================================
  const inlineFrame = document.getElementById('seatMapFrame');
  const scale = document.getElementById('seatMapScale');
  const zoomLabel = document.getElementById('seatZoomLabel');
  const zoomControls = document.getElementById('seatZoomControls');
  const fsLabel = document.getElementById('seatFsZoomLabel');
  let seatZoom = 1.0;

  const LABEL_GUTTER = 44;
  const TOP_PADDING = 28;
  let bbox = { minX: 0, minY: 0, maxX: planW, maxY: planH };
  if (seats.length > 0) {
    bbox = seats.reduce((acc, s) => ({
      minX: Math.min(acc.minX, s.x),
      minY: Math.min(acc.minY, s.y),
      maxX: Math.max(acc.maxX, s.x + SEAT_SIZE),
      maxY: Math.max(acc.maxY, s.y + SEAT_SIZE),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    bbox.minX = bbox.minX - LABEL_GUTTER;
    bbox.maxX = bbox.maxX + LABEL_GUTTER;
    bbox.minY = Math.max(0, bbox.minY - TOP_PADDING);
  }
  const contentW = Math.max(50, bbox.maxX - bbox.minX);
  const contentH = Math.max(50, bbox.maxY - bbox.minY);
  const cxBbox = (bbox.minX + bbox.maxX) / 2;
  const cyBbox = (bbox.minY + bbox.maxY) / 2;
  const cxPlan = planW / 2;
  const cyPlan = planH / 2;

  // Pan-offset in bovenop de bbox-centrering (mobiel: users kunnen slepen)
  let panX = 0;
  let panY = 0;

  function currentSeatFrame() {
    if (!scale) return inlineFrame;
    if (scale.parentElement && scale.parentElement.id === 'seatFullscreenStage') {
      return scale.parentElement;
    }
    return inlineFrame;
  }

  function applySeatZoom() {
    if (!scale) return;
    const tx = (cxPlan - cxBbox) + panX;
    const ty = (cyPlan - cyBbox) + panY;
    scale.style.transformOrigin = 'center center';
    scale.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + seatZoom + ')';
    const label = Math.round(seatZoom * 100) + '%';
    if (zoomLabel) zoomLabel.innerText = label;
    if (fsLabel) fsLabel.innerText = label;
  }

  function fitSeatPlan() {
    const frame = currentSeatFrame();
    if (!frame || !scale) return;
    panX = 0;
    panY = 0;
    const isFullscreen = frame.id === 'seatFullscreenStage';
    const pad = 32;
    const availW = Math.max(50, frame.clientWidth - pad);
    let seatZoomNew;
    if (isFullscreen) {
      const availH = Math.max(50, frame.clientHeight - pad);
      const sx = availW / contentW;
      const sy = availH / contentH;
      seatZoomNew = Math.min(sx, sy, 3.0);
    } else {
      const maxFrameH = Math.max(400, Math.round(window.innerHeight * 0.80));
      let s = availW / contentW;
      if (contentH * s + pad > maxFrameH) {
        s = (maxFrameH - pad) / contentH;
      }
      seatZoomNew = Math.min(s, 3.0);
      const neededH = Math.max(400, Math.ceil(contentH * seatZoomNew) + pad);
      frame.style.height = Math.min(neededH, maxFrameH) + 'px';
    }
    if (seatZoomNew < 0.1) seatZoomNew = 0.1;
    seatZoom = seatZoomNew;
    applySeatZoom();
  }

  if (zoomControls) zoomControls.classList.remove('hidden');
  document.getElementById('seatZoomFit')?.addEventListener('click', fitSeatPlan);
  document.getElementById('seatZoom100')?.addEventListener('click', () => { seatZoom = 1.0; applySeatZoom(); });
  document.getElementById('seatZoomIn')?.addEventListener('click', () => { seatZoom = Math.min(3.0, seatZoom + 0.1); applySeatZoom(); });
  document.getElementById('seatZoomOut')?.addEventListener('click', () => { seatZoom = Math.max(0.1, seatZoom - 0.1); applySeatZoom(); });
  document.getElementById('seatFsZoomFit')?.addEventListener('click', fitSeatPlan);
  document.getElementById('seatFsZoom100')?.addEventListener('click', () => { seatZoom = 1.0; applySeatZoom(); });
  document.getElementById('seatFsZoomIn')?.addEventListener('click', () => { seatZoom = Math.min(3.0, seatZoom + 0.1); applySeatZoom(); });
  document.getElementById('seatFsZoomOut')?.addEventListener('click', () => { seatZoom = Math.max(0.1, seatZoom - 0.1); applySeatZoom(); });
  window.addEventListener('resize', fitSeatPlan);
  setTimeout(fitSeatPlan, 50);
  setTimeout(fitSeatPlan, 250);

  // ================================================================
  // 3. NIEUW: pinch-zoom + pan met touch events
  //
  // Werkt op #seatMapScale binnen elk kader (inline of fullscreen).
  // - 1 vinger drag → pan
  // - 2 vingers pinch → zoom (rond het geometrisch midden van de 2 vingers)
  // ================================================================
  function attachTouchGestures(target) {
    if (!target) return;
    let activePointers = new Map(); // pointerId -> { x, y }
    let lastCenter = null;
    let lastDist = null;
    let lastPanPoint = null;

    // touch-action: none zodat browser niet zelf scroll/zoom pakt
    target.style.touchAction = 'none';

    function onPointerDown(e) {
      // Alleen touch/pen — laat muis-clicks door zodat click-to-select werkt
      if (e.pointerType === 'mouse') return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        lastCenter = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        lastPanPoint = null;
      } else if (activePointers.size === 1) {
        lastPanPoint = { x: e.clientX, y: e.clientY };
      }
      target.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2 && lastDist !== null) {
        // Pinch-zoom
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const factor = dist / lastDist;
        const newZoom = Math.min(3.0, Math.max(0.1, seatZoom * factor));
        // Pan-compensatie zodat het geometrisch midden onder de vingers blijft
        // (kleine benadering: de scale-factor delta trekken we ook door in panX/Y)
        seatZoom = newZoom;
        lastDist = dist;
        applySeatZoom();
        e.preventDefault?.();
      } else if (activePointers.size === 1 && lastPanPoint) {
        // Pan
        const dx = e.clientX - lastPanPoint.x;
        const dy = e.clientY - lastPanPoint.y;
        // Deel door zoom zodat panning voelt zoals verwacht (1px vinger = 1px op scherm)
        panX += dx / seatZoom;
        panY += dy / seatZoom;
        lastPanPoint = { x: e.clientX, y: e.clientY };
        applySeatZoom();
        e.preventDefault?.();
      }
    }

    function onPointerUp(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        lastDist = null;
        lastCenter = null;
      }
      if (activePointers.size === 1) {
        // Overgang van 2 → 1 vinger: hervat pan met resterende vinger
        const remaining = Array.from(activePointers.values())[0];
        lastPanPoint = { x: remaining.x, y: remaining.y };
      } else if (activePointers.size === 0) {
        lastPanPoint = null;
      }
    }

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('pointerleave', onPointerUp);
  }

  // Attach op scale zelf én op de frame (zodat je ook op de lege ruimte kan slepen)
  attachTouchGestures(scale);
  attachTouchGestures(inlineFrame);
  attachTouchGestures(document.getElementById('seatFullscreenStage'));

  // ================================================================
  // 4. Fullscreen-modal openen/sluiten (bestaand)
  // ================================================================
  const fsModal = document.getElementById('seatFullscreenModal');
  const fsStage = document.getElementById('seatFullscreenStage');
  const fsOpenBtn = document.getElementById('seatFullscreenOpenBtn');
  const fsCloseBtn = document.getElementById('seatFullscreenCloseBtn');
  const mobileOpenBtn = document.getElementById('seatMobileOpenBtn'); // NIEUW: mobile CTA

  function openSeatFullscreen() {
    if (!fsModal || !fsStage || !scale || !inlineFrame) return;
    fsStage.appendChild(scale);
    fsModal.classList.remove('hidden');
    fsModal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    setTimeout(fitSeatPlan, 30);
    setTimeout(fitSeatPlan, 250);
  }
  function closeSeatFullscreen() {
    if (!fsModal || !inlineFrame || !scale) return;
    inlineFrame.appendChild(scale);
    fsModal.classList.add('hidden');
    fsModal.classList.remove('flex');
    document.body.style.overflow = '';
    setTimeout(fitSeatPlan, 30);
    setTimeout(fitSeatPlan, 250);
  }
  fsOpenBtn?.addEventListener('click', openSeatFullscreen);
  mobileOpenBtn?.addEventListener('click', openSeatFullscreen);
  fsCloseBtn?.addEventListener('click', closeSeatFullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fsModal && !fsModal.classList.contains('hidden')) {
      closeSeatFullscreen();
    }
  });
  fsModal?.addEventListener('click', (e) => {
    if (e.target === fsModal) closeSeatFullscreen();
  });

  // Auto-open modal op mobile bij pageload zodat de flow "kies eerst plaats" duidelijk is?
  // → NEE, laten we niet doen. Users klikken zelf op de CTA, minder verrassend.

  // ================================================================
  // 5. Selectie-logica + chip-lijst boven de form
  // ================================================================
  const chipsContainer = document.getElementById('selectedSeatsChips');

  function seatLabel(seat) {
    return (seat.row_label || '?') + ' · Stoel ' + seat.seat_number;
  }

  function renderChips() {
    if (!chipsContainer) return;
    chipsContainer.innerHTML = '';
    if (window.selectedSeats.length === 0) {
      chipsContainer.innerHTML =
        '<div class="text-sm text-gray-500 italic">' +
        '<i class="fas fa-info-circle mr-1"></i>' +
        'Nog geen stoelen gekozen — klik op het zaalplan om plaatsen te selecteren.' +
        '</div>';
      return;
    }
    window.selectedSeats.forEach((seat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className =
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full ' +
        'bg-animato-accent text-white text-sm font-semibold shadow-sm ' +
        'hover:bg-amber-600 transition';
      chip.innerHTML =
        '<i class="fas fa-chair"></i>' +
        '<span>' + seatLabel(seat) + '</span>' +
        '<i class="fas fa-times ml-1 opacity-80"></i>';
      chip.title = 'Klik om deze stoel weer vrij te geven';
      chip.addEventListener('click', () => {
        const el = seatElements.get(seat.id);
        if (el) toggleSeat(seat, el);
      });
      chipsContainer.appendChild(chip);
    });
  }

  function toggleSeat(seat, el) {
    const idx = window.selectedSeats.findIndex((s) => s.id === seat.id);
    if (idx > -1) {
      window.selectedSeats.splice(idx, 1);
      el.style.backgroundColor = seat.type === 'wheelchair' ? '#10B981' : '#3B82F6';
      el.style.zIndex = '0';
      el.classList.remove('ring-2', 'ring-offset-1', 'ring-animato-accent');
    } else {
      window.selectedSeats.push(seat);
      el.style.backgroundColor = '#F59E0B';
      el.style.zIndex = '10';
      el.classList.add('ring-2', 'ring-offset-1', 'ring-animato-accent');
    }
    updateTotal();
    renderChips();
  }

  // ================================================================
  // 6. Totaal berekenen (nu window-scoped zodat quantity-mode 'm ook aanroept)
  // ================================================================
  function updateTotal() {
    let totalTickets = 0;
    let totalPrice = 0;

    if (hasSeatingPlan) {
      totalTickets = window.selectedSeats.length;
      let pricePerSeat = prijzen[0].prijs;
      let categoryName = prijzen[0].categorie;
      if (prijzen.length > 1) {
        const selector = document.getElementById('globalCategory');
        if (selector) {
          pricePerSeat = parseFloat(selector.value);
          categoryName = selector.options[selector.selectedIndex].getAttribute('data-cat');
          const catSel = document.getElementById('seatCategorySelector');
          if (catSel) catSel.classList.remove('hidden');
        }
      }
      totalPrice = totalTickets * pricePerSeat;

      const container = document.getElementById('selectedSeatsInputs');
      if (container) {
        container.innerHTML = '';
        window.selectedSeats.forEach((seat, i) => {
          const inputId = document.createElement('input');
          inputId.type = 'hidden';
          inputId.name = 'seats[' + i + '][id]';
          inputId.value = seat.id;
          const inputCat = document.createElement('input');
          inputCat.type = 'hidden';
          inputCat.name = 'seats[' + i + '][category]';
          inputCat.value = categoryName;
          const inputPrice = document.createElement('input');
          inputPrice.type = 'hidden';
          inputPrice.name = 'seats[' + i + '][price]';
          inputPrice.value = pricePerSeat;
          container.appendChild(inputId);
          container.appendChild(inputCat);
          container.appendChild(inputPrice);
        });
      }
    } else {
      prijzen.forEach((prijs, index) => {
        const ipt = document.getElementById('ticket-' + index);
        if (!ipt) return;
        const aantal = parseInt(ipt.value) || 0;
        totalTickets += aantal;
        totalPrice += aantal * prijs.prijs;
      });
    }

    const totT = document.getElementById('total-tickets');
    const totP = document.getElementById('total-price');
    if (totT) totT.textContent = totalTickets;
    if (totP) totP.textContent = '€' + totalPrice.toFixed(2);

    // Spiegel naar fullscreen-modal footer
    const fsCount = document.getElementById('seatFsTicketCount');
    const fsTotal = document.getElementById('seatFsTicketTotal');
    if (fsCount) fsCount.textContent = totalTickets;
    if (fsTotal) fsTotal.textContent = '€' + totalPrice.toFixed(2);

    // Mobile CTA-badge (# stoelen)
    const mobileBadge = document.getElementById('seatMobileBadge');
    const mobileTotal = document.getElementById('seatMobileTotal');
    if (mobileBadge) {
      if (totalTickets > 0) {
        mobileBadge.classList.remove('hidden');
        mobileBadge.textContent = totalTickets;
      } else {
        mobileBadge.classList.add('hidden');
      }
    }
    if (mobileTotal) {
      mobileTotal.textContent = totalTickets > 0 ? '€' + totalPrice.toFixed(2) : '';
    }

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.disabled = totalTickets === 0;
  }

  // Expose zodat de quantity-mode buttons en de category-select 'm kunnen aanroepen
  window.updateTotal = updateTotal;
  window.updateSeatPrices = updateTotal;
  window.incrementTicket = function (index) {
    const input = document.getElementById('ticket-' + index);
    if (!input) return;
    const max = parseInt(input.getAttribute('max'));
    const current = parseInt(input.value);
    if (current < max) {
      input.value = current + 1;
      updateTotal();
    }
  };
  window.decrementTicket = function (index) {
    const input = document.getElementById('ticket-' + index);
    if (!input) return;
    const current = parseInt(input.value);
    if (current > 0) {
      input.value = current - 1;
      updateTotal();
    }
  };

  // Initial render
  renderChips();
  updateTotal();
})();
