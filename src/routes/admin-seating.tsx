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
  const layouts = await queryAll(c.env.DB, "SELECT * FROM venue_layouts ORDER BY name")

  return c.html(
    <Layout title="Zaalplannen Beheer" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="events" /> {/* Grouped under events */}
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
                        {layout.capacity} plaatsen
                      </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-4 line-clamp-2">
                      {layout.description || 'Geen beschrijving'}
                    </p>
                    <div class="flex items-center text-sm text-gray-500 mb-4">
                      <i class="fas fa-th mr-2"></i>
                      {layout.rows} rijen x {layout.cols} kolommen
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
  const layout = await queryOne<any>(c.env.DB, "SELECT * FROM venue_layouts WHERE id = ?", [id])
  if (!layout) return c.redirect('/admin/seating')
  return renderEditor(c, layout)
})

function renderEditor(c: any, layout: any) {
  const user = c.get('user') as SessionUser
  const isNew = !layout
  const initialRows = layout ? layout.rows : 10
  const initialCols = layout ? layout.cols : 15
  
  // Default data: empty 2D array if new
  const initialData = layout ? layout.layout_data : JSON.stringify(
    Array(10).fill(null).map(() => Array(15).fill({ type: 'seat', category: 'standard' }))
  )

  return c.html(
    <Layout title={isNew ? "Nieuw Zaalplan" : "Zaalplan Bewerken"} user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="events" />
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
                    <input type="text" id="layoutName" value={layout?.name || ''} class="w-full border rounded p-2" placeholder="bv. Grote Zaal - Gala" />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                    <textarea id="layoutDesc" class="w-full border rounded p-2" rows={2}>{layout?.description || ''}</textarea>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Rijen</label>
                      <input type="number" id="gridRows" value={initialRows} class="w-full border rounded p-2" min="1" max="50" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Stoelen/Rij</label>
                      <input type="number" id="gridCols" value={initialCols} class="w-full border rounded p-2" min="1" max="50" />
                    </div>
                  </div>
                  <button id="updateGridBtn" class="w-full bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200 text-sm">
                    Grid Aanpassen
                  </button>
                </div>
              </div>

              <div class="bg-white p-6 rounded-lg shadow-sm">
                <h3 class="font-bold text-gray-800 mb-4">Gereedschap</h3>
                <div class="space-y-2">
                  <p class="text-xs text-gray-500 mb-2">Selecteer een type en klik op stoelen in het raster.</p>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-blue-200 bg-blue-50 text-blue-800 active-tool" data-type="seat" data-cat="standard">
                    <div class="w-4 h-4 rounded bg-blue-500 mr-3"></div>
                    Standaard Stoel
                  </button>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="vip">
                    <div class="w-4 h-4 rounded bg-yellow-400 mr-3"></div>
                    VIP / Rang 1
                  </button>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="rang2">
                    <div class="w-4 h-4 rounded bg-purple-400 mr-3"></div>
                    Rang 2
                  </button>

                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="seat" data-cat="wheelchair">
                    <div class="w-4 h-4 rounded bg-green-500 mr-3"></div>
                    Rolstoelplaats
                  </button>

                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="gap">
                    <div class="w-4 h-4 rounded border border-dashed border-gray-400 mr-3"></div>
                    Leegte / Gangpad
                  </button>
                  
                  <button class="tool-btn w-full flex items-center p-2 rounded border border-gray-200 hover:bg-gray-50" data-type="blocked">
                    <div class="w-4 h-4 rounded bg-red-200 mr-3"></div>
                    Niet Beschikbaar
                  </button>
                </div>
                
                <div class="mt-6 pt-4 border-t">
                  <div class="text-sm font-bold mb-2">Statistieken</div>
                  <div id="stats" class="text-xs text-gray-600 space-y-1">
                    <div>Totaal: <span id="statTotal">0</span></div>
                    <div>VIP: <span id="statVip">0</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Editor */}
            <div class="lg:col-span-3">
              <div class="bg-white p-6 rounded-lg shadow-sm overflow-auto" style="min-height: 600px;">
                <div class="mb-4 text-center text-sm text-gray-400 uppercase tracking-widest font-bold border-b pb-2">PODIUM / SCHERM</div>
                
                <div id="gridContainer" class="flex flex-col gap-1 items-center">
                  {/* Grid generated by JS */}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Editor Script */}
      <script dangerouslySetInnerHTML={{
        __html: `
          // Initialize state
          let gridData = ${initialData};
          let currentTool = { type: 'seat', category: 'standard' };
          let isDrawing = false;

          // Elements
          const container = document.getElementById('gridContainer');
          const rowsInput = document.getElementById('gridRows');
          const colsInput = document.getElementById('gridCols');
          const updateBtn = document.getElementById('updateGridBtn');
          const saveBtn = document.getElementById('saveBtn');
          const tools = document.querySelectorAll('.tool-btn');

          // --- 1. Render Grid ---
          function renderGrid() {
            container.innerHTML = '';
            let totalSeats = 0;
            let vipSeats = 0;

            gridData.forEach((row, rIndex) => {
              const rowDiv = document.createElement('div');
              rowDiv.className = 'flex gap-1';
              
              // Row Label
              const label = document.createElement('div');
              label.className = 'w-6 flex items-center justify-center text-xs font-bold text-gray-400';
              label.innerText = rIndex + 1;
              rowDiv.appendChild(label);

              row.forEach((cell, cIndex) => {
                const cellDiv = document.createElement('div');
                cellDiv.className = 'w-8 h-8 rounded cursor-pointer transition-all border ' + getCellClass(cell);
                cellDiv.dataset.r = rIndex;
                cellDiv.dataset.c = cIndex;
                cellDiv.title = \`Rij \${rIndex + 1}, Stoel \${cIndex + 1}\`;
                
                // Interaction
                cellDiv.addEventListener('mousedown', () => { isDrawing = true; applyTool(rIndex, cIndex); });
                cellDiv.addEventListener('mouseenter', () => { if(isDrawing) applyTool(rIndex, cIndex); });
                
                rowDiv.appendChild(cellDiv);

                // Stats
                if (cell && cell.type === 'seat') {
                  totalSeats++;
                  if (cell.category === 'vip') vipSeats++;
                }
              });

              container.appendChild(rowDiv);
            });

            document.addEventListener('mouseup', () => isDrawing = false);
            
            // Update stats
            document.getElementById('statTotal').innerText = totalSeats;
            document.getElementById('statVip').innerText = vipSeats;
          }

          function getCellClass(cell) {
            if (!cell || cell.type === 'gap') return 'bg-transparent border-transparent';
            if (cell.type === 'blocked') return 'bg-red-100 border-red-200';
            if (cell.type === 'seat') {
              switch(cell.category) {
                case 'vip': return 'bg-yellow-400 border-yellow-500 hover:bg-yellow-300';
                case 'rang2': return 'bg-purple-400 border-purple-500 hover:bg-purple-300';
                case 'wheelchair': return 'bg-green-500 border-green-600 hover:bg-green-400 text-white flex items-center justify-center'; // Could add icon
                default: return 'bg-blue-500 border-blue-600 hover:bg-blue-400';
              }
            }
            return 'bg-gray-200';
          }

          function applyTool(r, c) {
            if (currentTool.type === 'gap') {
              gridData[r][c] = { type: 'gap' };
            } else if (currentTool.type === 'blocked') {
              gridData[r][c] = { type: 'blocked' };
            } else {
              gridData[r][c] = { type: 'seat', category: currentTool.category };
            }
            renderGrid();
          }

          // --- 2. Tool Selection ---
          tools.forEach(btn => {
            btn.addEventListener('click', () => {
              // Remove active class from all
              tools.forEach(b => {
                b.classList.remove('active-tool', 'bg-blue-50', 'text-blue-800', 'border-blue-200');
                b.classList.add('border-gray-200', 'hover:bg-gray-50');
              });
              
              // Add active class
              btn.classList.add('active-tool', 'bg-blue-50', 'text-blue-800', 'border-blue-200');
              btn.classList.remove('border-gray-200', 'hover:bg-gray-50');

              currentTool = { 
                type: btn.dataset.type, 
                category: btn.dataset.cat 
              };
            });
          });

          // --- 3. Update Grid Size ---
          updateBtn.addEventListener('click', () => {
            const newRows = parseInt(rowsInput.value);
            const newCols = parseInt(colsInput.value);
            
            // Resize logic (preserving data where possible)
            const newGrid = [];
            for(let r=0; r<newRows; r++) {
              const row = [];
              for(let c=0; c<newCols; c++) {
                if (gridData[r] && gridData[r][c]) {
                  row.push(gridData[r][c]);
                } else {
                  row.push({ type: 'seat', category: 'standard' }); // Default new cells
                }
              }
              newGrid.push(row);
            }
            gridData = newGrid;
            renderGrid();
          });

          // --- 4. Save ---
          saveBtn.addEventListener('click', async () => {
            const name = document.getElementById('layoutName').value;
            if (!name) return alert('Geef het zaalplan een naam.');

            saveBtn.disabled = true;
            saveBtn.innerText = 'Opslaan...';

            const payload = {
              name: name,
              description: document.getElementById('layoutDesc').value,
              rows: gridData.length,
              cols: gridData[0].length,
              layout_data: JSON.stringify(gridData)
            };

            const layoutId = '${layout ? layout.id : ''}';
            const url = layoutId ? '/api/admin/seating/' + layoutId + '/update' : '/api/admin/seating/create';

            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if(res.ok) {
                window.location.href = '/admin/seating';
              } else {
                alert('Fout bij opslaan');
                saveBtn.disabled = false;
              }
            } catch(e) {
              console.error(e);
              alert('Netwerkfout');
              saveBtn.disabled = false;
            }
          });

          // Initial render
          renderGrid();
        `
      }} />
    </Layout>
  )
}

// =====================================================
// API
// =====================================================

app.post('/api/admin/seating/create', async (c) => {
  const body = await c.req.json()
  
  // Calculate capacity
  const grid = JSON.parse(body.layout_data)
  let capacity = 0
  grid.forEach((row: any) => row.forEach((cell: any) => {
    if(cell && cell.type === 'seat') capacity++
  }))

  await execute(c.env.DB, `
    INSERT INTO venue_layouts (name, description, rows, cols, layout_data, capacity)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [body.name, body.description, body.rows, body.cols, body.layout_data, capacity])

  return c.json({ success: true })
})

app.post('/api/admin/seating/:id/update', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const grid = JSON.parse(body.layout_data)
  let capacity = 0
  grid.forEach((row: any) => row.forEach((cell: any) => {
    if(cell && cell.type === 'seat') capacity++
  }))

  await execute(c.env.DB, `
    UPDATE venue_layouts 
    SET name=?, description=?, rows=?, cols=?, layout_data=?, capacity=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `, [body.name, body.description, body.rows, body.cols, body.layout_data, capacity, id])

  return c.json({ success: true })
})

app.post('/api/admin/seating/:id/delete', async (c) => {
  const id = c.req.param('id')
  // Check if in use
  const inUse = await queryOne(c.env.DB, "SELECT id FROM events WHERE layout_id = ?", [id])
  if (inUse) return c.text('Kan niet verwijderen: layout is in gebruik bij een concert.', 400)

  await execute(c.env.DB, "DELETE FROM venue_layouts WHERE id=?", [id])
  return c.redirect('/admin/seating')
})

export default app
