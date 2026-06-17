import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireRole, requireBestuurslid } from '../middleware/auth'
import { queryAll, queryOne, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('/admin/*', requireBestuurslid)

// =====================================================
// OVERVIEW
// =====================================================
app.get('/admin/seating', async (c) => {
  const user = c.get('user') as SessionUser
  const layouts = await queryAll(c.env.DB, "SELECT * FROM seating_plans ORDER BY name")

  return c.html(
    <Layout title="Zaalplannen Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="seating" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h1 class="text-3xl font-bold text-gray-900">
                <i class="fas fa-chair text-animato-primary mr-3"></i>
                Zaalplannen
              </h1>
              <p class="text-gray-600 mt-1">Beheer zaalopstellingen en VIP-configuraties</p>
            </div>
            <a href="/admin/seating/new" class="bg-animato-primary text-white px-4 py-2 rounded hover:opacity-90 shadow-sm">
              <i class="fas fa-plus mr-2"></i> Nieuw Zaalplan
            </a>
          </div>

          {layouts.length > 0 ? (
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {layouts.map((layout: any) => (
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition">
                  <div class="p-6">
                    <div class="flex justify-between items-start mb-4">
                      <h3 class="text-xl font-bold text-gray-900">{layout.name}</h3>
                      <span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded">
                        Zaalplan
                      </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-4 line-clamp-2">
                      {layout.description || 'Geen beschrijving'}
                    </p>
                    <div class="flex items-center text-sm text-gray-500 mb-4">
                      <i class="fas fa-ruler-combined mr-2"></i>
                      {layout.width}px x {layout.height}px
                    </div>
                    
                    <div class="flex gap-2 pt-4 border-t border-gray-100">
                      <a href={`/admin/seating/${layout.id}`} class="flex-1 text-center py-2 bg-gray-50 text-gray-700 rounded hover:bg-gray-100 font-medium">
                        <i class="fas fa-edit mr-1"></i> Bewerken
                      </a>
                      <button 
                        onclick={`if(confirm('Zeker weten?')) document.getElementById('delete-layout-${layout.id}').submit()`}
                        class="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
                      >
                        <i class="fas fa-trash"></i>
                      </button>
                      <form id={`delete-layout-${layout.id}`} action={`/api/admin/seating/${layout.id}/delete`} method="POST" class="hidden"></form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="bg-white rounded-lg shadow p-12 text-center">
              <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-couch text-gray-400 text-2xl"></i>
              </div>
              <h3 class="text-lg font-medium text-gray-900 mb-2">Nog geen zaalplannen</h3>
              <p class="text-gray-500 mb-6">Maak een eerste opstelling aan om tickets per stoel te kunnen verkopen.</p>
              <a href="/admin/seating/new" class="text-animato-primary font-semibold hover:underline">
                Start Configurator &rarr;
              </a>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// EDITOR (NEW/EDIT)
// =====================================================
app.get('/admin/seating/new', (c) => renderEditor(c, null))
app.get('/admin/seating/:id', async (c) => {
  const id = c.req.param('id')
  const layout = await queryOne<any>(c.env.DB, "SELECT * FROM seating_plans WHERE id = ?", [id])
  if (!layout) return c.redirect('/admin/seating')
  
  const seats = await queryAll(c.env.DB, "SELECT * FROM seats WHERE plan_id = ?", [id])
  layout.seats = seats
  
  return renderEditor(c, layout)
})

function renderEditor(c: any, layout: any) {
  const user = c.get('user') as SessionUser
  const isNew = !layout
  
  const canvasWidth  = layout ? layout.width  : 800
  const canvasHeight = layout ? layout.height : 600
  const seatsData    = layout ? JSON.stringify(layout.seats) : '[]'
  const planId       = layout ? String(layout.id) : ''

  // Build the client-side script as a plain string to avoid JSX escaping issues
  const editorScript = `
(function() {
  // ── State ──────────────────────────────────────────
  var seats = ${seatsData};
  var currentCategory = 'standard';
  var bulkMode = false;
  var bowMode = false;
  var bulkJustActivated = false;
  var isDraggingAnySeat = false;
  var canvasW = ${canvasWidth};
  var canvasH = ${canvasHeight};
  var gridSize = 20; // Snap-to-grid size in pixels
  var showGrid = true; // Show grid overlay
  var selectedIndices = []; // Multi-select for alignment tools

  // ── DOM refs ───────────────────────────────────────
  var wrapper      = document.getElementById('canvasWrapper');
  var saveBtn      = document.getElementById('saveBtn');
  var rowInput     = document.getElementById('currentRow');
  var statTotal    = document.getElementById('statTotal');
  var statWheelchair = document.getElementById('statWheelchair');
  var bulkAddBtn   = document.getElementById('bulkAddBtn');
  var bowAddBtn    = document.getElementById('bowAddBtn');
  var canvasFrame  = document.getElementById('canvasFrame');
  var canvasScale  = document.getElementById('canvasScale');

  // ── Helper: rij-label sequencer (A, B, ..., Z, AA, AB, ...) ─────
  // Backward-compatible: als invoer een nummer is ("Rij 1") blijft "Rij N"-stijl werken.
  function nextRowLabel(start, offset) {
    if (!start) start = 'A';
    var s = String(start).trim();
    // Als het label puur letters is, increment alfabetisch (A→B→...→Z→AA)
    if (/^[A-Za-z]+$/.test(s)) {
      return letterIncrement(s, offset);
    }
    // Als het label eindigt op een getal ("Rij 1"), increment dat getal (legacy)
    var m = s.match(/^(.*?)(\\d+)$/);
    if (m) {
      var pfx = m[1];
      var num = parseInt(m[2], 10) + offset;
      return pfx + num;
    }
    // Fallback: prefix + offset
    return s + (offset ? ' ' + (offset + 1) : '');
  }
  function letterIncrement(letters, offset) {
    var upper = letters === letters.toUpperCase();
    // Converteer letters → 0-based index (A=0, B=1, ..., Z=25, AA=26, AB=27 ...)
    var n = 0;
    var L = letters.toUpperCase();
    for (var i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64);
    n = n - 1 + offset;
    if (n < 0) n = 0;
    // Terug naar letters (n+1 omdat we 0-based zijn)
    var result = '';
    var x = n;
    do {
      var rem = x % 26;
      result = String.fromCharCode(65 + rem) + result;
      x = Math.floor(x / 26) - 1;
    } while (x >= 0);
    return upper ? result : result.toLowerCase();
  }

  // ── Zoom state & helpers ───────────────────────────
  var zoomLevel = 1.0;       // 1.0 = 100%
  var fitMode = true;        // start met fit-to-frame
  /** Geeft de huidige container terug waarin #canvasScale leeft.
   *  In fullscreen-modus is dat #canvasFullscreenStage, anders #canvasFrame. */
  function currentCanvasFrame() {
    if (!canvasScale) return canvasFrame;
    if (canvasScale.parentElement && canvasScale.parentElement.id === 'canvasFullscreenStage') {
      return canvasScale.parentElement;
    }
    return canvasFrame;
  }
  function applyZoom() {
    if (!canvasScale) return;
    canvasScale.style.transform = 'scale(' + zoomLevel + ')';
    var pct = Math.round(zoomLevel * 100) + '%';
    var lbl = document.getElementById('zoomLabel');
    if (lbl) lbl.innerText = pct;
    var fsLbl = document.getElementById('canvasFsZoomLabel');
    if (fsLbl) fsLbl.innerText = pct;
  }
  function fitToFrame() {
    var frame = currentCanvasFrame();
    if (!frame || !canvasScale) return;
    var isFullscreen = frame.id === 'canvasFullscreenStage';
    var pad = 48;
    var availW = frame.clientWidth - pad;
    if (isFullscreen) {
      // Fullscreen: gebruik beide assen
      var availH = frame.clientHeight - pad;
      var scaleX = availW / canvasW;
      var scaleY = availH / canvasH;
      zoomLevel = Math.min(scaleX, scaleY, 3.0);
    } else {
      // Inline: schaal op breedte en zet frame-hoogte naar wat nodig is — geen scrollbars
      var maxFrameH = Math.max(500, Math.round(window.innerHeight * 0.75));
      var s = availW / canvasW;
      if (canvasH * s + pad > maxFrameH) {
        s = (maxFrameH - pad) / canvasH;
      }
      // Cap op 1.5x zodat kleine plannen niet overdreven groot komen
      zoomLevel = Math.min(s, 1.5);
      var neededH = Math.max(500, Math.ceil(canvasH * zoomLevel) + pad);
      frame.style.height = Math.min(neededH, maxFrameH) + 'px';
    }
    if (zoomLevel < 0.1) zoomLevel = 0.1;
    fitMode = true;
    applyZoom();
  }
  function zoomBy(delta) {
    fitMode = false;
    zoomLevel = Math.max(0.1, Math.min(3.0, zoomLevel + delta));
    applyZoom();
  }

  // ── Canvas Init ────────────────────────────────────
  function initCanvas() {
    wrapper.style.width  = canvasW + 'px';
    wrapper.style.height = canvasH + 'px';
    renderGrid();
    renderSeats();
  }

  // ── Grid Overlay ─────────────────────────────────────
  function renderGrid() {
    var existing = document.getElementById('gridOverlay');
    if (existing) existing.remove();
    if (!showGrid) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'gridOverlay';
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.5;';
    svg.setAttribute('width', canvasW);
    svg.setAttribute('height', canvasH);

    // Vertical lines
    for (var x = 0; x <= canvasW; x += gridSize) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', 0);
      line.setAttribute('x2', x); line.setAttribute('y2', canvasH);
      var isMajor = (x % (gridSize * 5) === 0);
      line.setAttribute('stroke', isMajor ? '#94a3b8' : '#cbd5e1');
      line.setAttribute('stroke-width', isMajor ? '1' : '0.5');
      svg.appendChild(line);
    }
    // Horizontal lines
    for (var y = 0; y <= canvasH; y += gridSize) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', y);
      line.setAttribute('x2', canvasW); line.setAttribute('y2', y);
      var isMajor = (y % (gridSize * 5) === 0);
      line.setAttribute('stroke', isMajor ? '#94a3b8' : '#cbd5e1');
      line.setAttribute('stroke-width', isMajor ? '1' : '0.5');
      svg.appendChild(line);
    }
    wrapper.insertBefore(svg, wrapper.firstChild.nextSibling);
  }

  // Grid toggle handler
  var gridToggle = document.getElementById('gridToggle');
  if (gridToggle) {
    gridToggle.addEventListener('change', function() {
      showGrid = this.checked;
      renderGrid();
    });
  }

  // Grid size handler
  var gridSizeSelect = document.getElementById('gridSizeSelect');
  if (gridSizeSelect) {
    gridSizeSelect.addEventListener('change', function() {
      gridSize = parseInt(this.value) || 20;
      renderGrid();
    });
  }

  document.getElementById('resizeBtn').addEventListener('click', function() {
    canvasW = parseInt(document.getElementById('canvasW').value) || canvasW;
    canvasH = parseInt(document.getElementById('canvasH').value) || canvasH;
    initCanvas();
    if (fitMode) fitToFrame();
  });

  // ── Render all seats ───────────────────────────────
  function renderSeats() {
    // Remove every child except podium bar (first) and grid overlay
    var toRemove = [];
    Array.from(wrapper.children).forEach(function(ch, i) {
      if (i === 0) return; // podium bar
      if (ch.id === 'gridOverlay') return;
      toRemove.push(ch);
    });
    toRemove.forEach(function(ch) { wrapper.removeChild(ch); });

    var total = 0, wheel = 0;

    seats.forEach(function(seat, index) {
      var el = document.createElement('div');
      el.className = 'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-white font-bold cursor-grab shadow-sm select-none';
      el.style.cssText = 'position:absolute;width:32px;height:32px;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.25);user-select:none;';
      el.style.left = seat.x + 'px';
      el.style.top  = seat.y + 'px';
      el.dataset.index = index;
      el.title = (seat.row_label || '') + ' – ' + seat.seat_number + ' (Shift+klik om te selecteren)';

      // Highlight when selected
      var isSelected = selectedIndices.indexOf(index) !== -1;

      if (seat.type === 'wheelchair') {
        el.style.backgroundColor = '#10B981';
        el.innerHTML = '<i class="fas fa-wheelchair" style="font-size:11px"></i>';
        el.title = (seat.row_label || '') + ' – ' + seat.seat_number + ' (rolstoelplaats)';
        wheel++;
      } else if (seat.type === 'companion') {
        el.style.backgroundColor = '#60A5FA';
        el.innerHTML = '<i class="fas fa-hands-helping" style="font-size:11px;color:#fff"></i>';
        el.title = (seat.row_label || '') + ' – ' + seat.seat_number + ' (begeleider)';
      } else if (seat.type === 'restricted_view') {
        el.style.backgroundColor = '#9CA3AF';
        el.innerHTML = '<i class="fas fa-eye-slash" style="font-size:10px;color:#fff"></i>';
        el.title = (seat.row_label || '') + ' – ' + seat.seat_number + ' (beperkt zicht)';
      } else {
        el.style.backgroundColor = '#3B82F6';
        el.style.color = '#fff';
        el.innerText = seat.seat_number || String(index + 1);
      }

      // ── Drag ──────────────────────────────────────
      var dragging = false;
      var offX = 0, offY = 0;

      el.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        dragging = true;
        isDraggingAnySeat = true;
        var rect = wrapper.getBoundingClientRect();
        offX = e.clientX - rect.left - seat.x;
        offY = e.clientY - rect.top  - seat.y;
        el.style.zIndex = 9999;
        el.style.cursor = 'grabbing';
        e.preventDefault();
      });

      function onMove(e) {
        if (!dragging) return;
        var rect = wrapper.getBoundingClientRect();
        var nx = e.clientX - rect.left - offX;
        var ny = e.clientY - rect.top  - offY;
        nx = Math.max(0, Math.min(canvasW - 32, Math.round(nx / gridSize) * gridSize));
        ny = Math.max(28, Math.min(canvasH - 32, Math.round(ny / gridSize) * gridSize));
        el.style.left = nx + 'px';
        el.style.top  = ny + 'px';
        seat.x = nx;
        seat.y = ny;
      }

      function onUp() {
        if (dragging) {
          dragging = false;
          el.style.zIndex = '';
          el.style.cursor = 'grab';
          setTimeout(function() { isDraggingAnySeat = false; }, 50);
        }
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      // ── Right-click remove ────────────────────────
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        seats.splice(index, 1);
        // Reset selection because indices shift
        selectedIndices = [];
        renderSeats();
      });

      // ── Shift+click → toggle selection for alignment ──
      el.addEventListener('click', function(e) {
        if (!e.shiftKey) return;
        e.stopPropagation();
        e.preventDefault();
        var idx = parseInt(el.dataset.index);
        var pos = selectedIndices.indexOf(idx);
        if (pos === -1) {
          selectedIndices.push(idx);
        } else {
          selectedIndices.splice(pos, 1);
        }
        renderSeats();
        updateAlignToolbar();
      });

      // Apply selection styling
      if (isSelected) {
        el.style.outline = '3px solid #FBBF24';
        el.style.outlineOffset = '2px';
        el.style.zIndex = '50';
      }

      wrapper.appendChild(el);
      total++;
    });

    // ── Rij-label tags links naast elke rij — KLIKBAAR ────────────
    // Groepeer stoelen per row_label, vind minX per groep en plaats een label links daarvan.
    var rowGroups = {};
    seats.forEach(function(seat, idx) {
      var lbl = seat.row_label || '';
      if (!lbl) return;
      if (!rowGroups[lbl]) rowGroups[lbl] = { minX: seat.x, avgY: 0, count: 0, indices: [] };
      if (seat.x < rowGroups[lbl].minX) rowGroups[lbl].minX = seat.x;
      rowGroups[lbl].avgY += seat.y;
      rowGroups[lbl].count++;
      rowGroups[lbl].indices.push(idx);
    });
    Object.keys(rowGroups).forEach(function(lbl) {
      var g = rowGroups[lbl];
      var avgY = g.avgY / g.count;
      var tag = document.createElement('div');
      tag.className = 'row-label-tag';
      tag.innerText = lbl + ' (' + g.count + ')';
      tag.style.cssText = 'position:absolute;left:' + Math.max(0, g.minX - 50) + 'px;top:' + (avgY + 4) + 'px;'
        + 'font-size:12px;font-weight:bold;color:#475569;background:rgba(255,255,255,.95);'
        + 'padding:2px 6px;border-radius:4px;border:1px solid #cbd5e1;cursor:pointer;'
        + 'z-index:5;letter-spacing:.05em;user-select:none;';
      tag.title = 'Klik om alle ' + g.count + ' stoelen van rij ' + lbl + ' te selecteren';
      tag.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        // Toggle: als alle stoelen van deze rij al geselecteerd → deselecteer; anders selecteer alles
        var allSelected = g.indices.every(function(i) { return selectedIndices.indexOf(i) !== -1; });
        if (allSelected) {
          // Verwijder ze allemaal uit de selectie
          selectedIndices = selectedIndices.filter(function(i) { return g.indices.indexOf(i) === -1; });
        } else {
          // Voeg toe (deduplicate)
          g.indices.forEach(function(i) {
            if (selectedIndices.indexOf(i) === -1) selectedIndices.push(i);
          });
        }
        renderSeats();
        updateAlignToolbar();
      });
      tag.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Hele rij "' + lbl + '" verwijderen? (' + g.count + ' stoel' + (g.count===1?'':'en') + ')\\n\\nLet op: stoelen die in een bestaand concert verkocht zijn, blijven beschermd bij opslaan.')) return;
        // Verwijder by reverse-sort om indices stabiel te houden
        var sorted = g.indices.slice().sort(function(a,b){ return b-a; });
        sorted.forEach(function(i) { seats.splice(i, 1); });
        selectedIndices = [];
        renderSeats();
        updateAlignToolbar();
      });
      wrapper.appendChild(tag);
    });

    statTotal.innerText = total;
    statWheelchair.innerText = wheel;
    updateBulkBtn();
  }

  // ── Canvas click → place seat(s) ──────────────────
  wrapper.addEventListener('click', function(e) {
    // Guard: bulk was just activated by the button click that bubbled here
    if (bulkJustActivated) { bulkJustActivated = false; return; }

    // Ignore if dragging
    if (isDraggingAnySeat) return;

    // Shift+click on empty canvas = clear selection (don't place a new seat)
    if (e.shiftKey) {
      if (selectedIndices.length > 0) {
        selectedIndices = [];
        renderSeats();
        updateAlignToolbar();
      }
      return;
    }

    // Ignore clicks on existing seat elements (they have data-index)
    if (e.target !== wrapper && e.target.dataset && e.target.dataset.index !== undefined) return;
    // Also ignore clicks on the podium bar (first child, no data-index but not the wrapper itself)
    if (e.target !== wrapper && !e.target.dataset.index) {
      // Allow only if target is the wrapper itself
      if (e.target.parentElement === wrapper && !e.target.dataset.index) return;
    }

    var rect = wrapper.getBoundingClientRect();
    var x = e.clientX - rect.left - 16;
    var y = e.clientY - rect.top  - 16;

    // Stay below podium bar (~24px)
    if (y < 28) return;

    if (bulkMode) {
      var rows = parseInt(document.getElementById('bulkRows').value) || 1;
      var cols = parseInt(document.getElementById('bulkCols').value) || 1;
      var labelVal = rowInput.value.trim() || 'A';

      for (var r = 0; r < rows; r++) {
        var rowLabel = nextRowLabel(labelVal, r);
        for (var col = 0; col < cols; col++) {
          seats.push({
            x: Math.round(x + col * 40),
            y: Math.round(y + r   * 40),
            type: currentCategory,
            row_label:   rowLabel,
            seat_number: String(col + 1)
          });
        }
      }
      // Auto-update rowInput naar de volgende rij voor de volgende plaatsing
      rowInput.value = nextRowLabel(labelVal, rows);
      // Exit bulk mode after placement
      bulkMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
      renderSeats();
      return;
    }

    if (bowMode) {
      // Curved (bow-shaped) rows — typical for concert halls
      // Each row sits on an arc; the first (front) row centre is placed where the user clicks.
      var bowRows = parseInt(document.getElementById('bulkRows').value) || 1;
      var bowCols = parseInt(document.getElementById('bulkCols').value) || 1;
      var angleDeg = parseFloat(document.getElementById('bowAngle').value) || 40;
      var rowSpacing = parseFloat(document.getElementById('bowSpacing').value) || 44;
      var concave = document.getElementById('bowConcave').checked; // true = curve naar podium toe (bovenkant)
      var seatGap = 38; // chord-distance tussen stoelen op de boog

      var labelVal2 = rowInput.value.trim() || 'A';

      var totalAngleRad = angleDeg * Math.PI / 180;
      // Bereken straal zodat de eerste rij van bowCols stoelen met seatGap chord-afstand op de boog past
      // chord = 2 * R * sin(theta/2), met theta = totalAngleRad / (bowCols - 1) per stoel
      // Voor numerieke stabiliteit: kies R zodat de TOTALE chord-spanning ~ (bowCols-1)*seatGap is bij hoek totalAngleRad.
      var R0;
      if (bowCols <= 1 || totalAngleRad < 0.001) {
        R0 = 99999; // bijna recht
      } else {
        R0 = ((bowCols - 1) * seatGap / 2) / Math.sin(totalAngleRad / 2);
      }

      // Centrum van de cirkel: als concave (bocht naar podium) ligt centrum BENEDEN klikpunt;
      // anders boven. y-as is omlaag positief → concave = centerY = clickY + R, convex = clickY - R.
      var clickX = x + 16; // compenseer de -16 offset hierboven
      var clickY = y + 16;

      for (var rr = 0; rr < bowRows; rr++) {
        var R = R0 + rr * rowSpacing * (concave ? 1 : -1) * 0; // R blijft initieel constant
        // Voor échte concertzaal-look: elke achterliggende rij heeft GROTERE straal én meer stoelen kunnen.
        // Hier houden we het simpel: zelfde aantal stoelen, straal +rowSpacing per achterliggende rij.
        var rowR = R0 + rr * rowSpacing;
        var centerX = clickX;
        var centerY = concave ? (clickY + R0) : (clickY - R0);

        // Voor elke stoel hoek = -totalAngle/2 + i * (totalAngle/(cols-1))
        for (var ci = 0; ci < bowCols; ci++) {
          var t = bowCols === 1 ? 0 : (ci / (bowCols - 1)) - 0.5; // -0.5 ... +0.5
          var ang = t * totalAngleRad;
          var sx, sy;
          if (concave) {
            // boog opent naar boven → stoelen onder centrum
            sx = centerX + rowR * Math.sin(ang);
            sy = centerY - rowR * Math.cos(ang);
          } else {
            // boog opent naar onder
            sx = centerX + rowR * Math.sin(ang);
            sy = centerY + rowR * Math.cos(ang);
          }
          // -16 omdat het seat-element 32px breed is en in renderSeats per +16 wordt gepositioneerd
          seats.push({
            x: Math.round(sx - 16),
            y: Math.round(sy - 16),
            type: currentCategory,
            row_label: nextRowLabel(labelVal2, rr),
            seat_number: String(ci + 1)
          });
        }
      }
      // Auto-incrementeer rij-label voor volgende plaatsing
      rowInput.value = nextRowLabel(labelVal2, bowRows);

      bowMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBowBtn();
      renderSeats();
      return;
    }

    // Single seat
    var label = rowInput.value.trim() || 'A';
    var numInRow = seats.filter(function(s) { return s.row_label === label; }).length + 1;
    seats.push({
      x: Math.round(x / 8) * 8,
      y: Math.round(y / 8) * 8,
      type: currentCategory,
      row_label:   label,
      seat_number: String(numInRow)
    });
    renderSeats();
  });

  // Right-click on canvas bg = nothing
  wrapper.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // ── Tool buttons ───────────────────────────────────
  document.querySelectorAll('.tool-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      document.querySelectorAll('.tool-btn').forEach(function(b) {
        b.classList.remove('bg-blue-50', 'text-blue-800', 'border-blue-200', 'active-tool');
      });
      btn.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200', 'active-tool');
      currentCategory = btn.dataset.cat;
      bulkMode = false;
      bowMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
      updateBowBtn();
    });
  });

  // ── Bulk toggle ────────────────────────────────────
  function updateBulkBtn() {
    if (bulkMode) {
      bulkAddBtn.style.backgroundColor = '#BFDBFE';
      bulkAddBtn.style.borderColor = '#2563EB';
      bulkAddBtn.style.color = '#1E3A8A';
      bulkAddBtn.innerHTML = '<i class="fas fa-crosshairs" style="margin-right:4px"></i> Klik nu op het canvas...';
    } else {
      bulkAddBtn.style.backgroundColor = '#F3F4F6';
      bulkAddBtn.style.borderColor = '#D1D5DB';
      bulkAddBtn.style.color = '#374151';
      bulkAddBtn.innerHTML = '<i class="fas fa-th" style="margin-right:4px"></i> Voeg Blok Toe';
    }
  }

  bulkAddBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    e.preventDefault();
    bulkMode = !bulkMode;
    if (bulkMode) {
      bowMode = false; // mutually exclusive
      updateBowBtn();
      bulkJustActivated = true;
      wrapper.style.cursor = 'copy';
      document.body.style.cursor = 'copy';
    } else {
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
    }
    updateBulkBtn();
  });

  // ── Bow (curved row) toggle ────────────────────────
  function updateBowBtn() {
    if (!bowAddBtn) return;
    if (bowMode) {
      bowAddBtn.style.backgroundColor = '#DDD6FE';
      bowAddBtn.style.borderColor = '#7C3AED';
      bowAddBtn.style.color = '#5B21B6';
      bowAddBtn.innerHTML = '<i class="fas fa-crosshairs" style="margin-right:4px"></i> Klik op canvas (midden voorste rij)...';
    } else {
      bowAddBtn.style.backgroundColor = '#F5F3FF';
      bowAddBtn.style.borderColor = '#C4B5FD';
      bowAddBtn.style.color = '#6D28D9';
      bowAddBtn.innerHTML = '<i class="fas fa-bezier-curve mr-1"></i> Voeg gebogen rijen toe';
    }
  }

  if (bowAddBtn) {
    bowAddBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      bowMode = !bowMode;
      if (bowMode) {
        bulkMode = false; // mutually exclusive
        updateBulkBtn();
        bulkJustActivated = true;
        wrapper.style.cursor = 'copy';
        document.body.style.cursor = 'copy';
      } else {
        wrapper.style.cursor = 'crosshair';
        document.body.style.cursor = '';
      }
      updateBowBtn();
    });
  }

  // ── Clear ──────────────────────────────────────────
  document.getElementById('clearBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (confirm('Alle stoelen wissen?')) {
      seats = [];
      selectedIndices = [];
      renderSeats();
      updateAlignToolbar();
    }
  });

  // ── Snap-all to grid ────────────────────────────────
  var snapAllBtn = document.getElementById('snapAllBtn');
  if (snapAllBtn) {
    snapAllBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (seats.length === 0) { alert('Geen stoelen om uit te lijnen.'); return; }
      seats.forEach(function(s) {
        s.x = Math.max(0, Math.min(canvasW - 32, Math.round(s.x / gridSize) * gridSize));
        s.y = Math.max(28, Math.min(canvasH - 32, Math.round(s.y / gridSize) * gridSize));
      });
      renderSeats();
    });
  }

  // ── Alignment toolbar (visible when ≥1 seat selected) ──
  function updateAlignToolbar() {
    var bar = document.getElementById('alignToolbar');
    var counter = document.getElementById('selectionCount');
    var alignGroup = document.getElementById('alignGroup');
    var rowInfo = document.getElementById('selectionRowInfo');
    if (!bar) return;
    if (selectedIndices.length >= 1) {
      bar.classList.remove('hidden');
      if (counter) counter.innerText = selectedIndices.length;
      // Uitlijn alleen zichtbaar bij ≥2
      if (alignGroup) {
        if (selectedIndices.length >= 2) alignGroup.classList.remove('hidden');
        else alignGroup.classList.add('hidden');
      }
      // Rij-info als alle geselecteerde stoelen dezelfde row hebben
      if (rowInfo) {
        var sel = selectedIndices.map(function(i){ return seats[i]; }).filter(Boolean);
        var rows = {};
        sel.forEach(function(s){ rows[s.row_label || '(zonder rij)'] = true; });
        var rowKeys = Object.keys(rows);
        if (rowKeys.length === 1) {
          rowInfo.innerText = '· rij ' + rowKeys[0];
        } else {
          rowInfo.innerText = '· ' + rowKeys.length + ' rijen';
        }
      }
    } else {
      bar.classList.add('hidden');
    }
  }

  // ── Wijzig type van geselecteerde stoelen ──
  // Bij wheelchair: vraag of buurstoel begeleider moet worden.
  function changeSelectedType(newType) {
    if (selectedIndices.length === 0) {
      alert('Selecteer eerst een of meer stoelen (Shift+klik of klik op rij-label).');
      return;
    }

    // Pas type aan
    selectedIndices.forEach(function(i) {
      if (seats[i]) seats[i].type = newType;
    });

    // Suggestie voor begeleider bij rolstoelplaats
    if (newType === 'wheelchair') {
      var candidates = [];
      selectedIndices.forEach(function(i) {
        var s = seats[i];
        if (!s) return;
        // Zoek de dichtstbijzijnde buurstoel in dezelfde rij, niet zelf wheelchair/companion
        var best = null, bestDist = Infinity;
        seats.forEach(function(other, j) {
          if (j === i) return;
          if (other.row_label !== s.row_label) return;
          if (other.type === 'wheelchair' || other.type === 'companion') return;
          // Alleen horizontaal "naast"
          var dx = Math.abs(other.x - s.x);
          var dy = Math.abs(other.y - s.y);
          if (dy > 30) return; // andere rij visueel
          var dist = dx + dy;
          if (dist < bestDist && dx < 80) {
            bestDist = dist;
            best = j;
          }
        });
        if (best !== null && candidates.indexOf(best) === -1) {
          candidates.push(best);
        }
      });
      if (candidates.length > 0) {
        var msg = candidates.length === 1
          ? 'Wil je ook de buurstoel als begeleider markeren? (1 stoel)'
          : 'Wil je ook ' + candidates.length + ' buurstoelen als begeleider markeren?';
        if (confirm(msg)) {
          candidates.forEach(function(j) { seats[j].type = 'companion'; });
        }
      }
    }

    renderSeats();
    // Selectie behouden zodat admin meerdere wijzigingen kan stapelen
    updateAlignToolbar();
  }

  function deleteSelected() {
    if (selectedIndices.length === 0) return;
    if (!confirm('Verwijder ' + selectedIndices.length + ' geselecteerde stoel(en)?\\n\\nLet op: stoelen die in een bestaand concert verkocht zijn, blijven beschermd bij opslaan.')) return;
    var sorted = selectedIndices.slice().sort(function(a,b){ return b-a; });
    sorted.forEach(function(i) { seats.splice(i, 1); });
    selectedIndices = [];
    renderSeats();
    updateAlignToolbar();
  }

  function alignSelected(mode) {
    if (selectedIndices.length < 2) return;
    var sel = selectedIndices.map(function(i) { return seats[i]; }).filter(Boolean);
    if (sel.length < 2) return;

    if (mode === 'horizontal') {
      // Same Y → use Y of first selected
      var refY = sel[0].y;
      sel.forEach(function(s) { s.y = refY; });
    } else if (mode === 'vertical') {
      // Same X → use X of first selected
      var refX = sel[0].x;
      sel.forEach(function(s) { s.x = refX; });
    } else if (mode === 'distribute-h') {
      // Sort by X, distribute evenly between min and max
      sel.sort(function(a, b) { return a.x - b.x; });
      var minX = sel[0].x, maxX = sel[sel.length - 1].x;
      var step = (maxX - minX) / (sel.length - 1);
      sel.forEach(function(s, i) { s.x = Math.round(minX + i * step); });
    } else if (mode === 'distribute-v') {
      sel.sort(function(a, b) { return a.y - b.y; });
      var minY = sel[0].y, maxY = sel[sel.length - 1].y;
      var step = (maxY - minY) / (sel.length - 1);
      sel.forEach(function(s, i) { s.y = Math.round(minY + i * step); });
    }
    renderSeats();
  }

  function clearSelection() {
    selectedIndices = [];
    renderSeats();
    updateAlignToolbar();
  }

  ['alignHBtn', 'alignVBtn', 'distHBtn', 'distVBtn', 'clearSelBtn'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      if (id === 'alignHBtn') alignSelected('horizontal');
      else if (id === 'alignVBtn') alignSelected('vertical');
      else if (id === 'distHBtn') alignSelected('distribute-h');
      else if (id === 'distVBtn') alignSelected('distribute-v');
      else if (id === 'clearSelBtn') clearSelection();
    });
  });

  // ── Change-type-knoppen ──
  document.querySelectorAll('.change-type-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var newType = btn.dataset.newtype;
      if (newType) changeSelectedType(newType);
    });
  });

  // ── Verwijder selectie ──
  var delSelBtn = document.getElementById('deleteSelBtn');
  if (delSelBtn) {
    delSelBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      deleteSelected();
    });
  }

  // ── Save ───────────────────────────────────────────
  saveBtn.addEventListener('click', async function(e) {
    e.stopPropagation();
    var name = document.getElementById('layoutName').value.trim();
    if (!name) { alert('Geef het plan een naam.'); return; }

    // UX-safety: bestaande seats wegblazen vereist bevestiging
    var hadSeatsOnLoad = ${layout && Array.isArray(layout.seats) ? layout.seats.length : 0};
    if (hadSeatsOnLoad > 0 && seats.length === 0) {
      if (!confirm('Je staat op het punt om ALLE stoelen uit dit plan te verwijderen.\\n\\nWeet je dat zeker? (Verkochte stoelen blijven beschermd.)')) {
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px"></i>Opslaan...';

    // Stuur bestaande id mee zodat backend kan diffen i.p.v. delete+insert
    var payload = {
      name: name,
      description: '',
      width:  canvasW,
      height: canvasH,
      seats:  seats.map(function(s) {
        var out = {
          x: s.x, y: s.y,
          type: s.type || 'standard',
          row_label: s.row_label || '',
          seat_number: s.seat_number || '',
          section_name: s.section_name || null
        };
        if (s.id) out.id = s.id; // bestaande stoel → UPDATE
        return out;
      })
    };

    var planId = '${planId}';
    var url = planId
      ? '/api/admin/seating/' + planId + '/update'
      : '/api/admin/seating/create';

    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        var err = await res.text();
        alert('Fout bij opslaan: ' + err);
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px"></i>Opslaan';
        return;
      }

      var data = await res.json();

      // Re-sync seat IDs zodat verdere edits in dezelfde sessie correct diff'en
      if (data.seats && Array.isArray(data.seats)) {
        // Match op (row_label + seat_number + x + y) — duplicates zouden hier
        // niet mogen bestaan binnen één plan; goede heuristiek voor herstel.
        seats = seats.map(function(local) {
          if (local.id) {
            // bestaande stoel: behoud ID
            return local;
          }
          // nieuwe stoel: zoek match in server-response
          var match = data.seats.find(function(remote) {
            return String(remote.row_label || '') === String(local.row_label || '')
                && String(remote.seat_number || '') === String(local.seat_number || '')
                && Math.abs((remote.x || 0) - local.x) < 2
                && Math.abs((remote.y || 0) - local.y) < 2;
          });
          if (match) {
            local.id = match.id;
          }
          return local;
        });
      }

      // Toon waarschuwing als er stoelen beschermd zijn (sold)
      if (data.protected_count && data.protected_count > 0) {
        var lines = (data.protected_seats || []).map(function(p) {
          return '  • Rij ' + (p.row_label || '?') + ' – stoel ' + (p.seat_number || '?');
        });
        alert(
          '⚠️ ' + data.protected_count + ' stoel(en) konden niet verwijderd worden omdat ze al verkocht zijn:\\n\\n' +
          lines.join('\\n') +
          '\\n\\nDeze stoelen zijn niet aangepast. Je kan ze pas verwijderen nadat de tickets terugbetaald of geannuleerd zijn.'
        );
      }

      // Als dit een bestaand plan was: check of er concerten zijn die het gebruiken
      if (planId) {
        try {
          var ccRes = await fetch('/api/admin/seating/' + planId + '/concert-clients');
          var ccData = ccRes.ok ? await ccRes.json() : { concerts: [] };
          if (ccData.concerts && ccData.concerts.length > 0) {
            showConcertSyncModal(planId, ccData.concerts);
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px"></i>Opslaan';
            return; // wacht op modal-actie
          }
        } catch (e2) {
          console.warn('Kon concert-clients niet ophalen:', e2);
        }
      }

      // Niets meer te doen → terug naar overzicht
      window.location.href = '/admin/seating';
    } catch (err) {
      console.error(err);
      alert('Netwerkfout bij opslaan.');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px"></i>Opslaan';
    }
  });

  // ── Concert-sync modal ─────────────────────────────
  // Toont na save welke concerten dit plan gebruiken en biedt de admin de keuze
  // om te bevestigen dat de wijziging ook voor die concerten geldt.
  function showConcertSyncModal(planId, concerts) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    var rowsHtml = concerts.map(function(c) {
      var soldBadge = c.sold_count > 0
        ? '<span style="background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;margin-left:8px">' + c.sold_count + ' verkocht — beschermd</span>'
        : '<span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;margin-left:8px">geen verkocht</span>';
      var dateStr = c.datum ? new Date(c.datum).toLocaleDateString('nl-BE', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      return '<label style="display:flex;align-items:center;padding:10px;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:6px;cursor:pointer;background:#fff" class="concert-sync-row">' +
             '<input type="checkbox" class="concert-sync-cb" data-concert-id="' + c.id + '" checked style="margin-right:10px;width:18px;height:18px">' +
             '<div style="flex:1">' +
               '<div style="font-weight:600;color:#111827;font-size:14px">' + escapeHtml(c.titel) + '</div>' +
               '<div style="font-size:12px;color:#6B7280;margin-top:2px">' + dateStr + (c.locatie ? ' · ' + escapeHtml(c.locatie) : '') + soldBadge + '</div>' +
             '</div>' +
             '</label>';
    }).join('');

    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,.25)">' +
      '  <div style="padding:20px 24px;border-bottom:1px solid #E5E7EB">' +
      '    <h2 style="margin:0;font-size:20px;font-weight:700;color:#111827"><i class="fas fa-link" style="color:#3B82F6;margin-right:8px"></i>Ook toepassen op bestaande concerten?</h2>' +
      '    <p style="margin:6px 0 0;font-size:13px;color:#6B7280">Dit zaalplan wordt gebruikt door ' + concerts.length + ' concert' + (concerts.length===1?'':'en') + '. Vink aan welke je wilt synchroniseren met de nieuwe staat.</p>' +
      '    <p style="margin:6px 0 0;font-size:12px;color:#92400E;background:#FFFBEB;padding:8px;border-radius:6px;border-left:3px solid #F59E0B"><i class="fas fa-shield-alt mr-1"></i>Reeds verkochte stoelen blijven sowieso intact — daar verandert niks aan.</p>' +
      '  </div>' +
      '  <div style="padding:16px 24px;overflow-y:auto;flex:1">' + rowsHtml + '</div>' +
      '  <div style="padding:16px 24px;border-top:1px solid #E5E7EB;display:flex;gap:8px;justify-content:flex-end">' +
      '    <button id="cs-skip" style="padding:8px 16px;border:1px solid #D1D5DB;background:#fff;color:#374151;border-radius:6px;font-weight:500;cursor:pointer">Overslaan</button>' +
      '    <button id="cs-confirm" style="padding:8px 16px;background:#3B82F6;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer"><i class="fas fa-check mr-1"></i>Synchroniseren</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);

    function closeModal() {
      document.body.removeChild(modal);
      window.location.href = '/admin/seating';
    }

    modal.querySelector('#cs-skip').addEventListener('click', closeModal);

    modal.querySelector('#cs-confirm').addEventListener('click', async function() {
      var checked = Array.from(modal.querySelectorAll('.concert-sync-cb:checked')).map(function(cb) {
        return parseInt(cb.dataset.concertId, 10);
      });
      if (checked.length === 0) { closeModal(); return; }

      var btn = modal.querySelector('#cs-confirm');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Bezig...';

      try {
        var res = await fetch('/api/admin/seating/' + planId + '/sync-to-concerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concert_ids: checked })
        });
        var data = await res.json();
        // Audit: zijn er orphans?
        var totalOrphans = (data.results || []).reduce(function(sum, r) { return sum + (r.orphans_count || 0); }, 0);
        if (totalOrphans > 0) {
          alert('⚠️ Audit: ' + totalOrphans + ' verkochte stoel(en) verwijzen nu naar verdwenen plaatsen. Dit zou niet mogen voorkomen — neem contact op met de ontwikkelaar.');
        } else {
          alert('✅ ' + checked.length + ' concert' + (checked.length===1?'':'en') + ' gesynchroniseerd. Geen probleemstoelen gevonden.');
        }
      } catch (e) {
        alert('Sync mislukte: ' + e.message);
      }
      closeModal();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Keyboard: Escape cancels bulk/bow mode ────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && (bulkMode || bowMode)) {
      bulkMode = false;
      bowMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
      updateBowBtn();
    }
  });

  // ── Zoom controls wire-up ──────────────────────────
  var zoomInBtn  = document.getElementById('zoomInBtn');
  var zoomOutBtn = document.getElementById('zoomOutBtn');
  var zoomFitBtn = document.getElementById('zoomFitBtn');
  var zoom100Btn = document.getElementById('zoom100Btn');
  if (zoomInBtn)  zoomInBtn.addEventListener('click',  function(){ zoomBy(+0.1); });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', function(){ zoomBy(-0.1); });
  if (zoomFitBtn) zoomFitBtn.addEventListener('click', fitToFrame);
  if (zoom100Btn) zoom100Btn.addEventListener('click', function(){ fitMode = false; zoomLevel = 1.0; applyZoom(); });
  // Modal-zoom-knoppen (zelfde acties, andere ID's)
  var fsFitBtn  = document.getElementById('canvasFsZoomFit');
  var fsInBtn   = document.getElementById('canvasFsZoomIn');
  var fsOutBtn  = document.getElementById('canvasFsZoomOut');
  var fs100Btn  = document.getElementById('canvasFsZoom100');
  if (fsFitBtn) fsFitBtn.addEventListener('click', fitToFrame);
  if (fsInBtn)  fsInBtn.addEventListener('click',  function(){ zoomBy(+0.1); });
  if (fsOutBtn) fsOutBtn.addEventListener('click', function(){ zoomBy(-0.1); });
  if (fs100Btn) fs100Btn.addEventListener('click', function(){ fitMode = false; zoomLevel = 1.0; applyZoom(); });

  // ── Fullscreen modal: verhuis #canvasScale heen-en-weer ──
  // Verplaatsen (appendChild) i.p.v. klonen zodat alle event-listeners
  // op stoel-divs (click, drag, shift+klik, rechtsklik) blijven werken.
  var fsModal   = document.getElementById('canvasFullscreenModal');
  var fsStage   = document.getElementById('canvasFullscreenStage');
  var fsOpenBtn = document.getElementById('canvasFullscreenOpenBtn');
  var fsCloseBtn= document.getElementById('canvasFullscreenCloseBtn');
  function openCanvasFullscreen() {
    if (!fsModal || !fsStage || !canvasScale || !canvasFrame) return;
    fsStage.appendChild(canvasScale);
    fsModal.classList.remove('hidden');
    fsModal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    setTimeout(fitToFrame, 30);
    setTimeout(fitToFrame, 250);
  }
  function closeCanvasFullscreen() {
    if (!fsModal || !canvasFrame || !canvasScale) return;
    canvasFrame.appendChild(canvasScale);
    fsModal.classList.add('hidden');
    fsModal.classList.remove('flex');
    document.body.style.overflow = '';
    setTimeout(fitToFrame, 30);
    setTimeout(fitToFrame, 250);
  }
  if (fsOpenBtn)  fsOpenBtn.addEventListener('click', openCanvasFullscreen);
  if (fsCloseBtn) fsCloseBtn.addEventListener('click', closeCanvasFullscreen);
  // ESC = sluiten
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && fsModal && !fsModal.classList.contains('hidden')) {
      closeCanvasFullscreen();
    }
  });
  // Klik op de donkere achtergrond (maar niet op canvas of UI) = sluiten
  if (fsModal) fsModal.addEventListener('click', function(e) {
    if (e.target === fsModal) closeCanvasFullscreen();
  });

  // Auto-fit bij venster-resize
  window.addEventListener('resize', function() {
    if (fitMode) fitToFrame();
  });

  // ── Boot ───────────────────────────────────────────
  initCanvas();
  // Initieel: probeer in beeld te passen (twee passes voor render-flush)
  setTimeout(fitToFrame, 50);
  setTimeout(fitToFrame, 250);
})();
`

  return c.html(
    <Layout title={isNew ? "Nieuw Zaalplan" : "Zaalplan Bewerken"} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="seating" userRole={user.role} isBestuurslid={user.is_bestuurslid === 1} />
        <div class="flex-1 p-8">
          <div class="mb-6 flex justify-between items-center">
            <h1 class="text-2xl font-bold text-gray-900">
              {isNew ? 'Nieuw Zaalplan Ontwerpen' : `Zaalplan: ${layout.name}`}
            </h1>
            <div class="flex gap-2">
              <a href="/admin/seating" class="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50">Annuleren</a>
              <button id="saveBtn" class="px-6 py-2 bg-animato-primary text-white rounded hover:opacity-90 shadow-sm font-semibold">
                <i class="fas fa-save mr-2"></i> Opslaan
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Settings Panel */}
            <div class="lg:col-span-1 space-y-6">
              <div class="bg-white p-6 rounded-lg shadow-sm">
                <h3 class="font-bold text-gray-800 mb-4">Instellingen</h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Naam Zaalplan</label>
                    <input type="text" id="layoutName" value={layout?.name || ''} class="w-full border rounded p-2" placeholder="bv. Grote Zaal" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Afmetingen (px)</label>
                    <div class="grid grid-cols-2 gap-2">
                      <input type="number" id="canvasW" value={canvasWidth}  class="w-full border rounded p-2" placeholder="Breedte" />
                      <input type="number" id="canvasH" value={canvasHeight} class="w-full border rounded p-2" placeholder="Hoogte" />
                    </div>
                    <button id="resizeBtn" class="mt-2 w-full bg-gray-100 text-xs py-1 rounded">Update Canvas</button>
                  </div>

                  {/* Grid Settings */}
                  <div class="mt-4">
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      <i class="fas fa-th text-animato-primary mr-1"></i>
                      Raster (snap-to-grid)
                    </label>
                    <div class="flex items-center gap-3">
                      <select id="gridSizeSelect" class="flex-1 border rounded p-2 text-sm">
                        <option value="10">10px (fijn)</option>
                        <option value="20" selected>20px (normaal)</option>
                        <option value="40">40px (grof)</option>
                      </select>
                      <label class="inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="gridToggle" checked class="w-4 h-4 text-animato-primary border-gray-300 rounded" />
                        <span class="ml-1.5 text-xs text-gray-600">Toon</span>
                      </label>
                    </div>
                    <button id="snapAllBtn" type="button" class="mt-2 w-full text-xs py-2 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium" title="Lijn alle bestaande stoelen uit op het huidige raster">
                      <i class="fas fa-magnet mr-1"></i> Snap alles aan raster
                    </button>
                  </div>

                  {/* Selection helper */}
                  <div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                    <p class="font-bold mb-1"><i class="fas fa-mouse-pointer mr-1"></i> Uitlijnen?</p>
                    <p>Houd <kbd class="bg-white border px-1 rounded">Shift</kbd> ingedrukt en klik op stoelen om er meerdere te selecteren. De uitlijn-knoppen verschijnen dan onderaan het canvas.</p>
                  </div>
                </div>
              </div>

              <div class="bg-white p-6 rounded-lg shadow-sm">
                <h3 class="font-bold text-gray-800 mb-4">Gereedschap</h3>
                <div class="space-y-2">
                  <p class="text-xs text-gray-500 mb-2">Klik op het canvas om stoelen te plaatsen.</p>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-blue-200 bg-blue-50 text-blue-800 active-tool" data-type="seat" data-cat="standard">
                    <div style="width:16px;height:16px;border-radius:50%;background:#3B82F6;margin-right:12px;flex-shrink:0"></div>
                    Standaard Stoel
                  </button>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="wheelchair">
                    <div style="width:16px;height:16px;border-radius:50%;background:#10B981;margin-right:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                      <i class="fas fa-wheelchair" style="font-size:9px;color:#fff"></i>
                    </div>
                    Rolstoelplaats
                  </button>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="companion">
                    <div style="width:16px;height:16px;border-radius:50%;background:#60A5FA;margin-right:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                      <i class="fas fa-hands-helping" style="font-size:9px;color:#fff"></i>
                    </div>
                    Begeleider
                  </button>

                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="restricted_view">
                    <div style="width:16px;height:16px;border-radius:50%;background:#9CA3AF;margin-right:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                      <i class="fas fa-eye-slash" style="font-size:9px;color:#fff"></i>
                    </div>
                    Beperkt zicht
                  </button>

                  {/* Wijzig type van geselecteerde stoelen */}
                  <div id="changeTypePanel" class="hidden mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p class="text-xs font-bold text-blue-900 mb-2">
                      <i class="fas fa-edit mr-1"></i>
                      Wijzig type van <span id="changeTypeCount">0</span> geselecteerde stoel(en)
                    </p>
                    <div class="grid grid-cols-2 gap-1">
                      <button data-newtype="standard" class="change-type-btn text-xs py-1.5 rounded bg-white border border-blue-300 hover:bg-blue-100">
                        <i class="fas fa-circle text-blue-500 mr-1"></i> Standaard
                      </button>
                      <button data-newtype="wheelchair" class="change-type-btn text-xs py-1.5 rounded bg-white border border-green-300 hover:bg-green-100">
                        <i class="fas fa-wheelchair text-green-600 mr-1"></i> Rolstoel
                      </button>
                      <button data-newtype="companion" class="change-type-btn text-xs py-1.5 rounded bg-white border border-blue-300 hover:bg-blue-100">
                        <i class="fas fa-hands-helping text-blue-400 mr-1"></i> Begeleider
                      </button>
                      <button data-newtype="restricted_view" class="change-type-btn text-xs py-1.5 rounded bg-white border border-gray-300 hover:bg-gray-100">
                        <i class="fas fa-eye-slash text-gray-500 mr-1"></i> Beperkt zicht
                      </button>
                    </div>
                  </div>

                  <div class="pt-4 mt-4 border-t">
                    <label class="block text-xs font-bold mb-2">Bulk Plaatsing</label>
                    <div class="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label class="block text-xs text-gray-500 mb-1">Rijen</label>
                        <input type="number" id="bulkRows" value="5" min="1" class="w-full border rounded p-1 text-sm" />
                      </div>
                      <div>
                        <label class="block text-xs text-gray-500 mb-1">Stoelen/rij</label>
                        <input type="number" id="bulkCols" value="10" min="1" class="w-full border rounded p-1 text-sm" />
                      </div>
                    </div>
                    <button id="bulkAddBtn" class="w-full text-xs py-2 rounded border border-gray-300 bg-gray-100 text-gray-700 mb-2" style="transition:all .15s">
                      <i class="fas fa-th mr-1"></i> Voeg Blok Toe (recht)
                    </button>

                    {/* Curved/bow rows */}
                    <div class="mt-3 pt-3 border-t border-gray-200">
                      <label class="block text-xs font-semibold mb-2 text-gray-700">
                        <i class="fas fa-bezier-curve mr-1 text-purple-600"></i> Gebogen rijen
                      </label>
                      <div class="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label class="block text-[11px] text-gray-500 mb-1">Boog (°)</label>
                          <input type="number" id="bowAngle" value="40" min="10" max="180" step="5" class="w-full border rounded p-1 text-sm" title="Hoek van de boog: 0° = rechte rij, 180° = halve cirkel. Typisch 30-60° voor concertzalen." />
                        </div>
                        <div>
                          <label class="block text-[11px] text-gray-500 mb-1">Rij-afstand</label>
                          <input type="number" id="bowSpacing" value="44" min="20" max="120" class="w-full border rounded p-1 text-sm" title="Pixels tussen rijen (radiaal)" />
                        </div>
                      </div>
                      <div class="flex items-center gap-1 mb-2">
                        <input type="checkbox" id="bowConcave" checked class="rounded text-purple-600" />
                        <label for="bowConcave" class="text-[11px] text-gray-600">Bocht naar het podium toe (concave)</label>
                      </div>
                      <button id="bowAddBtn" class="w-full text-xs py-2 rounded border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100" style="transition:all .15s">
                        <i class="fas fa-bezier-curve mr-1"></i> Voeg gebogen rijen toe
                      </button>
                      <p class="text-xs text-gray-500 mt-1">Klik op het canvas waar het <strong>middelpunt</strong> van de eerste (voorste) rij moet komen.</p>
                    </div>
                    <p class="text-xs text-gray-500 mt-2"><kbd class="bg-gray-100 border px-1 rounded text-xs">Esc</kbd> annuleert plaatsing.</p>
                  </div>

                  <div class="pt-4 mt-4 border-t">
                    <label class="block text-xs font-bold mb-1">Rij Label</label>
                    <input type="text" id="currentRow" value="A" class="w-full border rounded p-1 text-sm" placeholder="A" />
                    <p class="text-[11px] text-gray-500 mt-1">
                      Gebruik letters <strong>A → Z → AA → AB</strong> (concertzaal-conventie). Bij meerdere rijen
                      lopen ze automatisch door.
                    </p>
                  </div>
                  
                  <div class="pt-2">
                    <button id="clearBtn" class="w-full bg-red-50 text-red-600 text-xs py-2 rounded hover:bg-red-100 border border-red-200">
                      <i class="fas fa-trash mr-1"></i> Alles Wissen
                    </button>
                  </div>
                </div>
                
                <div class="mt-6 pt-4 border-t">
                  <div class="text-sm font-bold mb-2">Statistieken</div>
                  <div id="stats" class="text-xs text-gray-600 space-y-1">
                    <div>Totaal stoelen: <span id="statTotal" class="font-bold">0</span></div>
                    <div>Rolstoelplaatsen: <span id="statWheelchair" class="font-bold">0</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Editor (Canvas) */}
            <div class="lg:col-span-3">
              {/* Zoom toolbar — past zaalplan visueel zonder de werkelijke pixel-maat te veranderen */}
              <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-600 font-semibold">Weergave:</span>
                  <button id="zoomFitBtn" type="button" class="text-xs px-2 py-1 rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium" title="Plan in beeld passen">
                    <i class="fas fa-expand-arrows-alt mr-1"></i>Passend
                  </button>
                  <button id="zoomOutBtn" type="button" class="text-xs w-7 h-7 rounded border border-gray-300 bg-white hover:bg-gray-50" title="Uitzoomen">
                    <i class="fas fa-minus"></i>
                  </button>
                  <span id="zoomLabel" class="text-xs text-gray-700 font-mono w-12 text-center">100%</span>
                  <button id="zoomInBtn" type="button" class="text-xs w-7 h-7 rounded border border-gray-300 bg-white hover:bg-gray-50" title="Inzoomen">
                    <i class="fas fa-plus"></i>
                  </button>
                  <button id="zoom100Btn" type="button" class="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50" title="100%">
                    1:1
                  </button>
                  {/* Fullscreen-knop: zelfde mechanisme als publieke ticketpagina */}
                  <button id="canvasFullscreenOpenBtn" type="button" class="ml-2 text-xs px-3 py-1.5 rounded bg-animato-primary text-white hover:opacity-90 font-semibold shadow-sm" title="Bewerk in volledig scherm (ESC of klik buiten om te sluiten)">
                    <i class="fas fa-expand mr-1"></i>Volledig scherm
                  </button>
                </div>
                <span class="text-[11px] text-gray-500">
                  <i class="fas fa-info-circle mr-1"></i>Zoom verandert alleen de weergave, niet de opgeslagen coördinaten.
                </span>
              </div>

              {/* Canvas frame: GEEN scrollbars meer — frame past zich aan aan het plan. */}
              <div id="canvasFrame" class="bg-gray-100 p-4 rounded-lg shadow-inner overflow-hidden" style="min-height:500px;display:flex;align-items:center;justify-content:center;position:relative;">
                <div id="canvasScale" style="transform-origin:center center;transition:transform .15s ease;">
                  <div id="canvasWrapper" style="position:relative;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.12);cursor:crosshair;">
                    <div style="position:absolute;top:0;left:0;width:100%;background:#1F2937;color:#fff;font-size:11px;padding:4px 0;text-align:center;font-weight:bold;letter-spacing:.1em;z-index:10;">
                      PODIUM / SCHERM
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Fullscreen modal voor de editor ──
                  Werkt met DOM-move: #canvasScale verhuist tijdelijk naar #canvasFullscreenStage.
                  Zo behouden alle event-listeners op stoelen (klik, drag, shift+klik...) hun werking. */}
              <div
                id="canvasFullscreenModal"
                class="fixed inset-0 z-50 bg-black/85 hidden flex-col"
                role="dialog"
                aria-modal="true"
              >
                <div class="flex items-center justify-between px-4 sm:px-6 py-3 bg-gray-900 text-white border-b border-gray-800">
                  <div class="flex items-center gap-3 min-w-0">
                    <i class="fas fa-chair text-animato-primary text-lg"></i>
                    <div class="min-w-0">
                      <h3 class="text-base sm:text-lg font-bold truncate">
                        Zaalplan bewerken — volledig scherm
                      </h3>
                      <p class="text-xs text-gray-300 hidden sm:block">
                        Alle bewerkingen blijven werken: klik = stoel toevoegen · sleep = verplaatsen · Shift+klik = selectie · rechtsklik = verwijderen · ESC om te sluiten
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="canvasFullscreenCloseBtn"
                    class="ml-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 transition"
                    title="Sluiten (ESC)"
                  >
                    <i class="fas fa-times"></i>
                    <span class="hidden sm:inline">Sluiten</span>
                  </button>
                </div>
                <div id="canvasFullscreenStage" class="flex-1 overflow-auto p-4 sm:p-8 bg-gradient-to-b from-gray-100 to-gray-200 flex items-center justify-center">
                  {/* #canvasScale komt hier in zodra de modal open is */}
                </div>
                <div class="bg-gray-900 text-white border-t border-gray-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-300 text-xs">Zoom:</span>
                    <button type="button" id="canvasFsZoomFit" class="px-3 py-1.5 rounded border border-blue-400 bg-blue-500 text-white hover:bg-blue-600 font-medium text-xs"><i class="fas fa-expand-arrows-alt mr-1"></i>Passend</button>
                    <button type="button" id="canvasFsZoomOut" class="w-8 h-8 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700 text-xs"><i class="fas fa-minus"></i></button>
                    <span id="canvasFsZoomLabel" class="font-mono w-12 text-center text-gray-200 text-xs">100%</span>
                    <button type="button" id="canvasFsZoomIn" class="w-8 h-8 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700 text-xs"><i class="fas fa-plus"></i></button>
                    <button type="button" id="canvasFsZoom100" class="px-3 py-1.5 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700 text-xs">1:1</button>
                  </div>
                  <div class="text-xs text-gray-300">
                    <i class="fas fa-info-circle mr-1"></i>
                    Wijzigingen worden bewaard wanneer je op <span class="font-semibold text-white">Opslaan</span> klikt na het sluiten van deze view.
                  </div>
                </div>
              </div>

              {/* Alignment toolbar (visible only when 1+ seats selected) */}
              <div id="alignToolbar" class="hidden mt-3 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg shadow-md">
                <div class="flex items-center justify-between flex-wrap gap-3 mb-2">
                  <span class="text-sm font-bold text-amber-900">
                    <i class="fas fa-object-group mr-1"></i>
                    <span id="selectionCount">0</span> stoel(en) geselecteerd
                    <span id="selectionRowInfo" class="ml-2 text-xs font-normal text-amber-700"></span>
                  </span>
                  <button id="clearSelBtn" type="button" class="px-3 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 font-medium text-gray-600">
                    <i class="fas fa-times mr-1"></i> Selectie wissen
                  </button>
                </div>

                {/* Uitlijn-knoppen (alleen zinvol bij ≥2) */}
                <div id="alignGroup" class="hidden flex flex-wrap gap-2 mb-2 pb-2 border-b border-amber-200">
                  <button id="alignHBtn" type="button" class="px-3 py-1.5 text-xs bg-white border border-amber-400 rounded hover:bg-amber-100 font-medium" title="Geef alle geselecteerde stoelen dezelfde Y-positie als de eerste">
                    <i class="fas fa-grip-lines mr-1"></i> Lijn horizontaal
                  </button>
                  <button id="alignVBtn" type="button" class="px-3 py-1.5 text-xs bg-white border border-amber-400 rounded hover:bg-amber-100 font-medium" title="Geef alle geselecteerde stoelen dezelfde X-positie als de eerste">
                    <i class="fas fa-grip-lines-vertical mr-1"></i> Lijn verticaal
                  </button>
                  <button id="distHBtn" type="button" class="px-3 py-1.5 text-xs bg-white border border-amber-400 rounded hover:bg-amber-100 font-medium" title="Verdeel gelijkmatig over de horizontale as">
                    <i class="fas fa-arrows-alt-h mr-1"></i> Verdeel H
                  </button>
                  <button id="distVBtn" type="button" class="px-3 py-1.5 text-xs bg-white border border-amber-400 rounded hover:bg-amber-100 font-medium" title="Verdeel gelijkmatig over de verticale as">
                    <i class="fas fa-arrows-alt-v mr-1"></i> Verdeel V
                  </button>
                </div>

                {/* Type-wijzigen + Rij verwijderen */}
                <div class="flex flex-wrap gap-2 items-center">
                  <span class="text-xs font-semibold text-amber-900 mr-1">Type:</span>
                  <button class="change-type-btn px-2.5 py-1.5 text-xs bg-white border border-blue-300 rounded hover:bg-blue-50 font-medium" data-newtype="standard" title="Maak standaard stoel">
                    <i class="fas fa-circle text-blue-500 mr-1"></i> Standaard
                  </button>
                  <button class="change-type-btn px-2.5 py-1.5 text-xs bg-white border border-green-300 rounded hover:bg-green-50 font-medium" data-newtype="wheelchair" title="Maak rolstoelplaats — biedt suggestie voor buurstoel als begeleider">
                    <i class="fas fa-wheelchair text-green-600 mr-1"></i> Rolstoel
                  </button>
                  <button class="change-type-btn px-2.5 py-1.5 text-xs bg-white border border-blue-200 rounded hover:bg-blue-50 font-medium" data-newtype="companion" title="Maak begeleider">
                    <i class="fas fa-hands-helping text-blue-400 mr-1"></i> Begeleider
                  </button>
                  <button class="change-type-btn px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-100 font-medium" data-newtype="restricted_view" title="Markeer als beperkt zicht">
                    <i class="fas fa-eye-slash text-gray-500 mr-1"></i> Beperkt zicht
                  </button>
                  <span class="text-amber-300 mx-1">|</span>
                  <button id="deleteSelBtn" class="px-3 py-1.5 text-xs bg-red-50 border border-red-300 text-red-700 rounded hover:bg-red-100 font-semibold" title="Verwijder alle geselecteerde stoelen">
                    <i class="fas fa-trash mr-1"></i> Verwijder selectie
                  </button>
                </div>
              </div>

              <p class="text-xs text-gray-500 mt-2 text-center">
                <strong>Klik</strong> = stoel toevoegen &nbsp;|&nbsp; <strong>Blok Toe</strong> = rechte rijen &nbsp;|&nbsp; <strong>Slepen</strong> = verplaatsen &nbsp;|&nbsp; <strong>Shift+klik</strong> = uitlijnen / type wijzigen &nbsp;|&nbsp; <strong>Klik rij-label</strong> = hele rij selecteren &nbsp;|&nbsp; <strong>Rechtsklik</strong> = verwijderen
              </p>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: editorScript }} />
    </Layout>
  )
}

// =====================================================
// API
// =====================================================

app.post('/api/admin/seating/create', async (c) => {
  const body = await c.req.json()
  
  const res = await execute(c.env.DB, `
    INSERT INTO seating_plans (name, description, width, height)
    VALUES (?, ?, ?, ?)
  `, [body.name, body.description || '', body.width, body.height])
  
  const planId = res.meta.last_row_id

  if (body.seats && body.seats.length > 0) {
    const stmt = c.env.DB.prepare(`
      INSERT INTO seats (plan_id, row_label, seat_number, x, y, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const batch = body.seats.map((s: any) => stmt.bind(planId, s.row_label, s.seat_number, s.x, s.y, s.type || 'standard'))
    await c.env.DB.batch(batch)
  }

  return c.json({ success: true })
})

/**
 * Update zaalplan met echte DIFF-save (geen DELETE+INSERT meer).
 *
 * Inkomende payload:
 *   { name, description, width, height, seats: [{ id?, x, y, type, row_label, seat_number, section_name? }, ...] }
 *
 * - Seats met `id` (bestaand) worden ge-UPDATE op positie/type/labels.
 * - Seats zonder `id` (nieuw) worden ge-INSERT.
 * - Seats die in DB bestaan maar niet meer in payload zitten worden ge-DELETE,
 *   maar NOOIT als er een `sold` ticket_seats record naar verwijst.
 *
 * Response: { success, removed_ids[], protected_ids[] }
 *   protected_ids = stoelen die de admin wilde verwijderen maar niet konden (sold).
 */
app.post('/api/admin/seating/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  // 1. Plan-meta updaten
  await execute(c.env.DB, `
    UPDATE seating_plans SET name=?, description=?, width=?, height=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `, [body.name, body.description || '', body.width, body.height, id])

  // 2. Huidige stoelen uit DB
  const existingSeats = await queryAll<any>(
    c.env.DB,
    "SELECT id FROM seats WHERE plan_id=?",
    [id]
  )
  const existingIds = new Set<number>(existingSeats.map(s => s.id))

  const incomingSeats: any[] = Array.isArray(body.seats) ? body.seats : []

  // 3. Splits payload in updates (met id) en inserts (zonder id)
  const updates = incomingSeats.filter(s => s.id && existingIds.has(Number(s.id)))
  const inserts = incomingSeats.filter(s => !s.id || !existingIds.has(Number(s.id)))

  // 4. Bepaal welke ids in DB stonden maar weg moeten
  const keepIds = new Set<number>(updates.map(s => Number(s.id)))
  const toDeleteIds = [...existingIds].filter(eid => !keepIds.has(eid))

  // 5. Bescherming: kijk welke van die delete-kandidaten een SOLD ticket_seat hebben
  let protectedIds: number[] = []
  if (toDeleteIds.length > 0) {
    const placeholders = toDeleteIds.map(() => '?').join(',')
    const protectedRows = await queryAll<any>(
      c.env.DB,
      `SELECT DISTINCT seat_id FROM ticket_seats
       WHERE status='sold' AND seat_id IN (${placeholders})`,
      toDeleteIds
    )
    protectedIds = protectedRows.map(r => r.seat_id)
  }
  const protectedSet = new Set<number>(protectedIds)
  const finalDeleteIds = toDeleteIds.filter(did => !protectedSet.has(did))

  // 6. Batch operaties — alles in één D1-batch voor snelheid + atomiciteit
  const batchOps: D1PreparedStatement[] = []

  // 6a. UPDATEs
  if (updates.length > 0) {
    const updStmt = c.env.DB.prepare(`
      UPDATE seats SET
        section_name = ?,
        row_label    = ?,
        seat_number  = ?,
        x            = ?,
        y            = ?,
        type         = ?
      WHERE id = ? AND plan_id = ?
    `)
    for (const s of updates) {
      batchOps.push(updStmt.bind(
        s.section_name || null,
        s.row_label || null,
        s.seat_number || null,
        s.x, s.y,
        s.type || 'standard',
        Number(s.id), id
      ))
    }
  }

  // 6b. INSERTs (nieuwe stoelen — krijgen verse id terug)
  const insertedNewClientRefs: Array<{ client_ref: any, x: number, y: number, row_label: string, seat_number: string }> = []
  if (inserts.length > 0) {
    const insStmt = c.env.DB.prepare(`
      INSERT INTO seats (plan_id, section_name, row_label, seat_number, x, y, type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const s of inserts) {
      batchOps.push(insStmt.bind(
        id,
        s.section_name || null,
        s.row_label || null,
        s.seat_number || null,
        s.x, s.y,
        s.type || 'standard'
      ))
      // Houd referentie bij om straks de nieuwe DB-id terug te koppelen
      insertedNewClientRefs.push({
        client_ref: s.client_ref ?? null,
        x: s.x, y: s.y,
        row_label: s.row_label || '',
        seat_number: s.seat_number || ''
      })
    }
  }

  // 6c. DELETEs (alleen veilige, niet-sold)
  if (finalDeleteIds.length > 0) {
    const delStmt = c.env.DB.prepare("DELETE FROM seats WHERE id = ? AND plan_id = ?")
    for (const did of finalDeleteIds) {
      batchOps.push(delStmt.bind(did, id))
    }
    // Ook: opruimen van eventuele NIET-sold ticket_seats die naar deze stoelen verwezen
    // (locked/released — die mogen weg zodat de FK niet meer dangling is)
    const tsCleanup = c.env.DB.prepare(
      "DELETE FROM ticket_seats WHERE seat_id = ? AND status <> 'sold'"
    )
    for (const did of finalDeleteIds) {
      batchOps.push(tsCleanup.bind(did))
    }
  }

  if (batchOps.length > 0) {
    await c.env.DB.batch(batchOps)
  }

  // 7. Haal de IDs van pas-geïnserte stoelen op (voor evt. client re-sync)
  // Eenvoudigste manier: query alle huidige seats opnieuw — front-end kan dan diff'en.
  const freshSeats = await queryAll<any>(
    c.env.DB,
    "SELECT id, section_name, row_label, seat_number, x, y, type FROM seats WHERE plan_id = ?",
    [id]
  )

  // 8. Info over beschermde stoelen — voor admin-feedback
  let protectedDetails: any[] = []
  if (protectedIds.length > 0) {
    const ph = protectedIds.map(() => '?').join(',')
    protectedDetails = await queryAll<any>(
      c.env.DB,
      `SELECT id, section_name, row_label, seat_number FROM seats WHERE id IN (${ph})`,
      protectedIds
    )
  }

  return c.json({
    success: true,
    removed_count: finalDeleteIds.length,
    protected_count: protectedIds.length,
    protected_seats: protectedDetails,
    seats: freshSeats
  })
})

/**
 * Welke concerten gebruiken dit zaalplan? Per concert tellen we hoeveel SOLD
 * ticket_seats er staan — dat is wat we beschermen bij synchronisatie.
 */
app.get('/api/admin/seating/:id/concert-clients', async (c) => {
  const id = c.req.param('id')
  const concerts = await queryAll<any>(c.env.DB, `
    SELECT c.id, e.titel, e.datum, e.locatie,
           (SELECT COUNT(*) FROM ticket_seats ts WHERE ts.concert_id=c.id AND ts.status='sold') AS sold_count,
           (SELECT COUNT(*) FROM ticket_seats ts WHERE ts.concert_id=c.id) AS assigned_count
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.seating_plan_id = ?
    ORDER BY e.datum DESC
  `, [id])
  return c.json({ concerts })
})

/**
 * Synchroniseer plan-wijzigingen naar bestaande concerten.
 *
 * In de praktijk: het seating_plan zelf is ALL we need — concerten verwijzen
 * via `seating_plan_id` naar de seats-tabel, dus zodra het plan up-to-date is
 * zien concerten automatisch de nieuwe staat.
 *
 * MAAR: ticket_seats verwijst naar seat_id. Als een stoel verwijderd is en
 * er stond nog een (locked/released) ticket_seat naar te verwijzen, hangt
 * die in de lucht — die hebben we al opgeruimd in /update. Dus dit endpoint
 * geeft alleen een audit-overzicht terug: hoeveel sold-tickets er per
 * concert nu nog op (mogelijk verdwenen) stoelen wijzen.
 *
 * Body: { concert_ids: number[] }  (de admin kiest welke concerten meegaan)
 * Response: per concert een lijst van eventuele "verweesde sold tickets"
 *           (zou 0 moeten zijn want sold = beschermd, maar voor zekerheid).
 */
app.post('/api/admin/seating/:id/sync-to-concerts', async (c) => {
  const planId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { concert_ids?: number[] }
  const concertIds: number[] = Array.isArray(body.concert_ids) ? body.concert_ids.map(Number).filter(Boolean) : []

  if (concertIds.length === 0) {
    return c.json({ success: true, results: [] })
  }

  const results = []
  for (const concertId of concertIds) {
    // Audit: zijn er sold ticket_seats die naar seats verwijzen die niet meer in dit plan zitten?
    const orphans = await queryAll<any>(c.env.DB, `
      SELECT ts.id, ts.seat_id, t.bestelnummer
      FROM ticket_seats ts
      LEFT JOIN seats s ON s.id = ts.seat_id AND s.plan_id = ?
      LEFT JOIN tickets t ON t.id = ts.ticket_id
      WHERE ts.concert_id = ? AND ts.status = 'sold' AND s.id IS NULL
    `, [planId, concertId])

    results.push({
      concert_id: concertId,
      orphans_count: orphans.length,
      orphans: orphans
    })
  }

  return c.json({ success: true, results })
})

app.post('/api/admin/seating/:id/delete', async (c) => {
  const id = c.req.param('id')
  const inUse = await queryOne(c.env.DB, "SELECT id FROM concerts WHERE seating_plan_id = ?", [id])
  if (inUse) return c.text('Kan niet verwijderen: plan is in gebruik bij een concert.', 400)

  await execute(c.env.DB, "DELETE FROM seating_plans WHERE id=?", [id])
  return c.redirect('/admin/seating')
})

export default app
