import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { requireRole } from '../middleware/auth'
import { queryAll, queryOne, execute } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// OVERVIEW
// =====================================================
app.get('/admin/seating', async (c) => {
  const user = c.get('user') as SessionUser
  const layouts = await queryAll(c.env.DB, "SELECT * FROM seating_plans ORDER BY name")

  return c.html(
    <Layout title="Zaalplannen Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="seating" />
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
  var bulkJustActivated = false;
  var isDraggingAnySeat = false;
  var canvasW = ${canvasWidth};
  var canvasH = ${canvasHeight};
  var gridSize = 20; // Snap-to-grid size in pixels
  var showGrid = true; // Show grid overlay

  // ── DOM refs ───────────────────────────────────────
  var wrapper      = document.getElementById('canvasWrapper');
  var saveBtn      = document.getElementById('saveBtn');
  var rowInput     = document.getElementById('currentRow');
  var statTotal    = document.getElementById('statTotal');
  var statWheelchair = document.getElementById('statWheelchair');
  var bulkAddBtn   = document.getElementById('bulkAddBtn');

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
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.3;';
    svg.setAttribute('width', canvasW);
    svg.setAttribute('height', canvasH);

    // Vertical lines
    for (var x = 0; x <= canvasW; x += gridSize) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', 0);
      line.setAttribute('x2', x); line.setAttribute('y2', canvasH);
      line.setAttribute('stroke', '#ccc'); line.setAttribute('stroke-width', '0.5');
      if (x % (gridSize * 5) === 0) line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }
    // Horizontal lines
    for (var y = 0; y <= canvasH; y += gridSize) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', y);
      line.setAttribute('x2', canvasW); line.setAttribute('y2', y);
      line.setAttribute('stroke', '#ccc'); line.setAttribute('stroke-width', '0.5');
      if (y % (gridSize * 5) === 0) line.setAttribute('stroke-width', '1');
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
  });

  // ── Render all seats ───────────────────────────────
  function renderSeats() {
    // Remove all children except podium bar (first child)
    var children = Array.from(wrapper.children).slice(1);
    children.forEach(function(ch) { wrapper.removeChild(ch); });

    var total = 0, wheel = 0;

    seats.forEach(function(seat, index) {
      var el = document.createElement('div');
      el.className = 'absolute w-8 h-8 rounded-t-lg flex items-center justify-center text-white font-bold cursor-grab shadow-sm select-none';
      el.style.cssText = 'position:absolute;width:32px;height:32px;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.25);user-select:none;';
      el.style.left = seat.x + 'px';
      el.style.top  = seat.y + 'px';
      el.dataset.index = index;
      el.title = (seat.row_label || '') + ' – ' + seat.seat_number;

      if (seat.type === 'wheelchair') {
        el.style.backgroundColor = '#10B981';
        el.innerHTML = '<i class="fas fa-wheelchair" style="font-size:10px"></i>';
        wheel++;
      } else if (seat.type === 'companion') {
        el.style.backgroundColor = '#60A5FA';
        el.style.color = '#fff';
        el.innerText = seat.seat_number || String(index + 1);
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
        renderSeats();
      });

      wrapper.appendChild(el);
      total++;
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
      var labelVal = rowInput.value.trim() || 'Rij 1';
      var rowNum = parseInt(labelVal.replace(/[^0-9]/g, '')) || 1;
      var rowPfx = labelVal.replace(/[0-9]+$/, '').trim() || 'Rij';

      for (var r = 0; r < rows; r++) {
        var rowLabel = rowPfx + ' ' + (rowNum + r);
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
      // Exit bulk mode after placement
      bulkMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
      renderSeats();
      return;
    }

    // Single seat
    var label = rowInput.value.trim() || 'Rij 1';
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
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
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
      bulkJustActivated = true;
      wrapper.style.cursor = 'copy';
      document.body.style.cursor = 'copy';
    } else {
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
    }
    updateBulkBtn();
  });

  // ── Clear ──────────────────────────────────────────
  document.getElementById('clearBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (confirm('Alle stoelen wissen?')) {
      seats = [];
      renderSeats();
    }
  });

  // ── Save ───────────────────────────────────────────
  saveBtn.addEventListener('click', async function(e) {
    e.stopPropagation();
    var name = document.getElementById('layoutName').value.trim();
    if (!name) { alert('Geef het plan een naam.'); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px"></i>Opslaan...';

    var payload = {
      name: name,
      description: '',
      width:  canvasW,
      height: canvasH,
      seats:  seats
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
      if (res.ok) {
        window.location.href = '/admin/seating';
      } else {
        var err = await res.text();
        alert('Fout bij opslaan: ' + err);
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px"></i>Opslaan';
      }
    } catch (err) {
      console.error(err);
      alert('Netwerkfout bij opslaan.');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px"></i>Opslaan';
    }
  });

  // ── Keyboard: Escape cancels bulk mode ────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && bulkMode) {
      bulkMode = false;
      wrapper.style.cursor = 'crosshair';
      document.body.style.cursor = '';
      updateBulkBtn();
    }
  });

  // ── Boot ───────────────────────────────────────────
  initCanvas();
})();
`

  return c.html(
    <Layout title={isNew ? "Nieuw Zaalplan" : "Zaalplan Bewerken"} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="seating" />
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
                    <div style="width:16px;height:16px;border-radius:50%;background:#60A5FA;margin-right:12px;flex-shrink:0"></div>
                    Begeleider
                  </button>

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
                    <button id="bulkAddBtn" class="w-full text-xs py-2 rounded border border-gray-300 bg-gray-100 text-gray-700" style="transition:all .15s">
                      <i class="fas fa-th mr-1"></i> Voeg Blok Toe
                    </button>
                    <p class="text-xs text-gray-500 mt-1">Klik daarna op het canvas om te plaatsen. <kbd class="bg-gray-100 border px-1 rounded text-xs">Esc</kbd> annuleert.</p>
                  </div>

                  <div class="pt-4 mt-4 border-t">
                    <label class="block text-xs font-bold mb-1">Rij Label</label>
                    <input type="text" id="currentRow" value="Rij 1" class="w-full border rounded p-1 text-sm" />
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
              <div class="bg-gray-100 p-6 rounded-lg shadow-inner overflow-auto" style="height:700px;display:flex;align-items:flex-start;justify-content:center;position:relative;">
                <div id="canvasWrapper" style="position:relative;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.12);cursor:crosshair;">
                  <div style="position:absolute;top:0;left:0;width:100%;background:#1F2937;color:#fff;font-size:11px;padding:4px 0;text-align:center;font-weight:bold;letter-spacing:.1em;z-index:10;">
                    PODIUM / SCHERM
                  </div>
                </div>
              </div>
              <p class="text-xs text-gray-500 mt-2 text-center">
                <strong>Klik</strong> = stoel toevoegen &nbsp;|&nbsp; <strong>Blok Toe</strong> → klik op canvas = rijen plaatsen &nbsp;|&nbsp; <strong>Slepen</strong> = verplaatsen &nbsp;|&nbsp; <strong>Rechtermuisknop</strong> = verwijderen
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

app.post('/api/admin/seating/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  
  await execute(c.env.DB, `
    UPDATE seating_plans SET name=?, description=?, width=?, height=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `, [body.name, body.description || '', body.width, body.height, id])

  await execute(c.env.DB, "DELETE FROM seats WHERE plan_id=?", [id])

  if (body.seats && body.seats.length > 0) {
    const stmt = c.env.DB.prepare(`
      INSERT INTO seats (plan_id, row_label, seat_number, x, y, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const batch = body.seats.map((s: any) => stmt.bind(id, s.row_label, s.seat_number, s.x, s.y, s.type || 'standard'))
    await c.env.DB.batch(batch)
  }

  return c.json({ success: true })
})

app.post('/api/admin/seating/:id/delete', async (c) => {
  const id = c.req.param('id')
  const inUse = await queryOne(c.env.DB, "SELECT id FROM concerts WHERE seating_plan_id = ?", [id])
  if (inUse) return c.text('Kan niet verwijderen: plan is in gebruik bij een concert.', 400)

  await execute(c.env.DB, "DELETE FROM seating_plans WHERE id=?", [id])
  return c.redirect('/admin/seating')
})

export default app
