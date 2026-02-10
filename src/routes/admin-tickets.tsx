import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { requireRole, type SessionUser } from '../middleware/auth'
import { queryAll, queryOne, execute } from '../utils/db'

const app = new Hono()

// Apply admin authentication to all routes
app.use('*', requireRole('admin', 'moderator'))

// ==========================================
// CONCERTS OVERVIEW - List all concerts with ticketing
// ==========================================
app.get('/admin/tickets', async (c) => {
  const user = c.get('user') as SessionUser
  
  // Get all concert events with optional concerts table data
  const concerts = await queryAll(c.env.DB, `
    SELECT e.id as event_id, e.titel, e.slug, e.start_at, e.locatie, e.type,
           c.id as concert_id, c.programma, c.ticketing_enabled, c.uitverkocht,
           COUNT(t.id) as ticket_count,
           SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN t.status = 'paid' THEN t.prijs_totaal ELSE 0 END) as revenue
    FROM events e
    LEFT JOIN concerts c ON c.event_id = e.id
    LEFT JOIN tickets t ON t.concert_id = c.id
    WHERE e.type = 'concert'
    GROUP BY e.id
    ORDER BY e.start_at ASC
  `)

  return c.html(
    <Layout title="Ticketing Beheer" user={user}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div class="flex justify-between items-center mb-8">
          <div>
            <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
              <i class="fas fa-ticket-alt mr-3"></i>
              Kaartenverkoop Beheer
            </h1>
            <p class="text-gray-600">
              Beheer concerten, prijzen en bekijk bestellingen
            </p>
          </div>
          <a
            href="/admin/events/nieuw?type=concert"
            class="bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition inline-flex items-center"
          >
            <i class="fas fa-plus mr-2"></i>
            Nieuw Concert
          </a>
        </div>

        {/* Stats Cards */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Totaal Concerten</p>
                <p class="text-3xl font-bold text-gray-900">{concerts.length}</p>
              </div>
              <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-music text-purple-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Tickets Verkocht</p>
                <p class="text-3xl font-bold text-gray-900">
                  {concerts.reduce((sum: number, c: any) => sum + (c.paid_count || 0), 0)}
                </p>
              </div>
              <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-ticket-alt text-green-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Totale Omzet</p>
                <p class="text-3xl font-bold text-gray-900">
                  €{concerts.reduce((sum: number, c: any) => sum + (c.revenue || 0), 0).toFixed(2)}
                </p>
              </div>
              <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-euro-sign text-blue-600 text-xl"></i>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-600 mb-1">Uitverkocht</p>
                <p class="text-3xl font-bold text-gray-900">
                  {concerts.filter((c: any) => c.uitverkocht).length}
                </p>
              </div>
              <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-times-circle text-red-600 text-xl"></i>
              </div>
            </div>
          </div>
        </div>

        {/* Concerts List */}
        {concerts.length === 0 ? (
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-calendar-times text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">Geen concerten gepland</h3>
            <p class="text-gray-500 mb-6">
              Maak een nieuw concert aan om tickets te kunnen verkopen
            </p>
            <a
              href="/admin/events/nieuw?type=concert"
              class="inline-flex items-center bg-animato-primary text-white px-6 py-3 rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-plus mr-2"></i>
              Nieuw Concert
            </a>
          </div>
        ) : (
          <div class="space-y-4">
            {concerts.map((concert: any) => {
              const eventDate = new Date(concert.start_at)
              const isPast = eventDate < new Date()
              const capacityPercent = concert.capaciteit > 0 
                ? Math.round((concert.verkocht / concert.capaciteit) * 100) 
                : 0

              return (
                <div class="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition">
                  <div class="flex flex-col md:flex-row">
                    {/* Concert Info */}
                    <div class="flex-1 p-6">
                      <div class="flex items-start justify-between mb-4">
                        <div class="flex-1">
                          <div class="flex items-center gap-3 mb-2">
                            <h3 class="text-xl font-bold text-gray-900">
                              {concert.titel}
                            </h3>
                            {concert.uitverkocht && (
                              <span class="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                                UITVERKOCHT
                              </span>
                            )}
                            {isPast && (
                              <span class="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                                AFGELOPEN
                              </span>
                            )}
                          </div>
                          <div class="flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>
                              <i class="fas fa-calendar mr-2"></i>
                              {eventDate.toLocaleDateString('nl-NL', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                              })}
                            </span>
                            <span>
                              <i class="fas fa-clock mr-2"></i>
                              {eventDate.toLocaleTimeString('nl-NL', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </span>
                            <span>
                              <i class="fas fa-map-marker-alt mr-2"></i>
                              {concert.locatie}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Capacity Bar */}
                      {concert.capaciteit > 0 && (
                        <div class="mb-4">
                          <div class="flex items-center justify-between text-sm mb-1">
                            <span class="font-medium text-gray-700">
                              Bezetting: {concert.verkocht} / {concert.capaciteit}
                            </span>
                            <span class="text-gray-600">{capacityPercent}%</span>
                          </div>
                          <div class="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              class={`h-2 rounded-full ${
                                capacityPercent >= 100 ? 'bg-red-500' :
                                capacityPercent >= 80 ? 'bg-yellow-500' :
                                'bg-green-500'
                              }`}
                              style={`width: ${Math.min(capacityPercent, 100)}%`}
                            ></div>
                          </div>
                        </div>
                      )}

                      {/* Stats */}
                      <div class="grid grid-cols-3 gap-4">
                        <div class="bg-gray-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-gray-900">
                            {concert.ticket_count || 0}
                          </div>
                          <div class="text-xs text-gray-600">Bestellingen</div>
                        </div>
                        <div class="bg-green-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-green-700">
                            {concert.paid_count || 0}
                          </div>
                          <div class="text-xs text-gray-600">Betaald</div>
                        </div>
                        <div class="bg-blue-50 rounded-lg p-3 text-center">
                          <div class="text-2xl font-bold text-blue-700">
                            €{(concert.revenue || 0).toFixed(2)}
                          </div>
                          <div class="text-xs text-gray-600">Omzet</div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div class="bg-gray-50 p-6 flex flex-col justify-center gap-3 md:w-64">
                      {concert.concert_id ? (
                        <>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/orders`}
                            class="w-full bg-animato-primary text-white px-4 py-2 rounded-lg hover:bg-opacity-90 transition text-center"
                          >
                            <i class="fas fa-list mr-2"></i>
                            Bekijk Bestellingen
                          </a>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/settings`}
                            class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                          >
                            <i class="fas fa-cog mr-2"></i>
                            Instellingen
                          </a>
                          <a
                            href={`/admin/tickets/concert/${concert.concert_id}/scan`}
                            class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                          >
                            <i class="fas fa-qrcode mr-2"></i>
                            QR Scanner
                          </a>
                        </>
                      ) : (
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                          <i class="fas fa-exclamation-triangle text-yellow-600 mb-2"></i>
                          <p class="text-xs text-yellow-800">Ticketing nog niet ingeschakeld</p>
                        </div>
                      )}
                      <a
                        href={`/concerten/${concert.slug}`}
                        target="_blank"
                        class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                      >
                        <i class="fas fa-external-link-alt mr-2"></i>
                        Publieke Pagina
                      </a>
                      <a
                        href={`/admin/events/${concert.event_id}`}
                        class="w-full bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-center"
                      >
                        <i class="fas fa-edit mr-2"></i>
                        Event Bewerken
                      </a>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
})

// ==========================================
// CONCERT ORDERS - View all orders for a concert
// ==========================================
app.get('/admin/tickets/concert/:concertId/orders', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  
  // Get concert info
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.text('Concert niet gevonden', 404)
  }

  // Get all tickets/orders
  const tickets = await queryAll(c.env.DB, `
    SELECT *
    FROM tickets
    WHERE concert_id = ?
    ORDER BY created_at DESC
  `, [concertId])

  return c.html(
    <Layout title={`Bestellingen - ${concert.titel}`} user={user}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        <div class="mb-8">
          <a href="/admin/tickets" class="text-animato-primary hover:text-animato-secondary inline-flex items-center mb-4">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar overzicht
          </a>
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            Bestellingen: {concert.titel}
          </h1>
          <div class="flex flex-wrap gap-4 text-gray-600">
            <span>
              <i class="fas fa-calendar mr-2"></i>
              {new Date(concert.start_at).toLocaleDateString('nl-NL', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
              })}
            </span>
            <span>
              <i class="fas fa-map-marker-alt mr-2"></i>
              {concert.locatie}
            </span>
          </div>
        </div>

        {/* Quick Stats */}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div class="bg-white rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Totaal Bestellingen</div>
            <div class="text-2xl font-bold text-gray-900">{tickets.length}</div>
          </div>
          <div class="bg-green-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Betaald</div>
            <div class="text-2xl font-bold text-green-700">
              {tickets.filter((t: any) => t.status === 'paid').length}
            </div>
          </div>
          <div class="bg-yellow-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Pending</div>
            <div class="text-2xl font-bold text-yellow-700">
              {tickets.filter((t: any) => t.status === 'pending').length}
            </div>
          </div>
          <div class="bg-blue-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Gescand</div>
            <div class="text-2xl font-bold text-blue-700">
              {tickets.filter((t: any) => t.gescand).length}
            </div>
          </div>
          <div class="bg-gray-50 rounded-lg shadow-md p-4">
            <div class="text-sm text-gray-600 mb-1">Omzet</div>
            <div class="text-2xl font-bold text-gray-900">
              €{tickets.filter((t: any) => t.status === 'paid')
                .reduce((sum: number, t: any) => sum + t.prijs_totaal, 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Tickets Table */}
        {tickets.length === 0 ? (
          <div class="bg-white rounded-lg shadow-md p-12 text-center">
            <i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">Nog geen bestellingen</h3>
            <p class="text-gray-500">
              Zodra mensen tickets bestellen, verschijnen ze hier
            </p>
          </div>
        ) : (
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order Ref</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Koper</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categorie</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aantal</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prijs</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acties</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {tickets.map((ticket: any) => {
                  const statusColors = {
                    'paid': 'bg-green-100 text-green-800',
                    'pending': 'bg-yellow-100 text-yellow-800',
                    'cancelled': 'bg-red-100 text-red-800',
                    'refunded': 'bg-gray-100 text-gray-800',
                    'used': 'bg-blue-100 text-blue-800'
                  }

                  return (
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-mono font-semibold text-gray-900">
                          {ticket.order_ref}
                        </div>
                        {ticket.gescand && (
                          <div class="text-xs text-green-600 flex items-center mt-1">
                            <i class="fas fa-check-circle mr-1"></i>
                            Gescand
                          </div>
                        )}
                      </td>
                      <td class="px-6 py-4">
                        <div class="text-sm font-medium text-gray-900">{ticket.koper_naam}</div>
                        <div class="text-sm text-gray-500">{ticket.koper_email}</div>
                        {ticket.koper_telefoon && (
                          <div class="text-xs text-gray-400">{ticket.koper_telefoon}</div>
                        )}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket.categorie}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket.aantal}x
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        €{ticket.prijs_totaal.toFixed(2)}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[ticket.status]}`}>
                          {ticket.status.toUpperCase()}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(ticket.created_at).toLocaleDateString('nl-NL')}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onclick={`showQR('${ticket.qr_code}', '${ticket.order_ref}')`}
                          class="text-blue-600 hover:text-blue-900 mr-3"
                          title="Toon QR"
                        >
                          <i class="fas fa-qrcode"></i>
                        </button>
                        <a
                          href={`mailto:${ticket.koper_email}`}
                          class="text-green-600 hover:text-green-900 mr-3"
                          title="Email"
                        >
                          <i class="fas fa-envelope"></i>
                        </a>
                        {ticket.status === 'pending' && (
                          <button
                            onclick={`markAsPaid(${ticket.id})`}
                            class="text-green-600 hover:text-green-900 mr-3"
                            title="Markeer als betaald"
                          >
                            <i class="fas fa-check"></i>
                          </button>
                        )}
                        <button
                          onclick={`openDeleteModal('/api/admin/tickets/${ticket.id}/delete?concert_id=${concertId}', true)`}
                          class="text-red-600 hover:text-red-900"
                          title="Verwijder bestelling"
                        >
                          <i class="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-red-500">
              <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div class="sm:flex sm:items-start">
                  <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <i class="fas fa-exclamation-triangle text-red-600"></i>
                  </div>
                  <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 class="text-xl leading-6 font-bold text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                      Bevestig Verwijderen
                    </h3>
                    <div class="mt-2">
                      <p class="text-sm text-gray-500">
                        Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-lg border border-transparent shadow-md px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Verwijderen
                </button>
                <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* QR Code Modal */}
        <div id="qrModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white rounded-lg p-8 max-w-md">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold">QR Code</h3>
              <button onclick="closeQR()" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-times text-2xl"></i>
              </button>
            </div>
            <div id="qrContent" class="text-center"></div>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          let deleteUrl = null;
          let isPost = false;

          function openDeleteModal(url, usePost = false) {
            deleteUrl = url;
            isPost = usePost;
            document.getElementById('deleteModal').classList.remove('hidden');
          }

          function closeDeleteModal() {
            deleteUrl = null;
            isPost = false;
            document.getElementById('deleteModal').classList.add('hidden');
          }

          document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
            if (deleteUrl) {
              if (isPost) {
                // Create and submit a form
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = deleteUrl;
                document.body.appendChild(form);
                form.submit();
              } else {
                window.location.href = deleteUrl;
              }
            }
            closeDeleteModal();
          });

          function showQR(qrCode, orderRef) {
            document.getElementById('qrContent').innerHTML = 
              '<div class="text-2xl font-mono font-bold mb-4">' + orderRef + '</div>' +
              '<div class="text-sm text-gray-600 mb-4">QR Code: ' + qrCode + '</div>' +
              '<div class="text-xs text-gray-400">Scan deze code bij de ingang</div>';
            document.getElementById('qrModal').classList.remove('hidden');
          }

          function closeQR() {
            document.getElementById('qrModal').classList.add('hidden');
          }

          async function markAsPaid(ticketId) {
            if (!confirm('Weet je zeker dat je deze bestelling als betaald wilt markeren?')) return;
            
            try {
              const response = await fetch('/api/admin/tickets/' + ticketId + '/mark-paid', {
                method: 'POST'
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Er ging iets mis');
              }
            } catch (error) {
              alert('Fout: ' + error.message);
            }
          }
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// MARK TICKET AS PAID API
// ==========================================
app.post('/api/admin/tickets/:id/mark-paid', async (c) => {
  const user = c.get('user') as SessionUser
  const ticketId = parseInt(c.req.param('id'))
  
  try {
    await execute(c.env.DB,
      `UPDATE tickets SET status = 'paid', betaald_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    )

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
      VALUES (?, 'update', 'tickets', ?, ?)
    `, [user.id, ticketId, JSON.stringify({ action: 'marked_as_paid' })])

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// DELETE TICKET API
// ==========================================
app.post('/api/admin/tickets/:id/delete', async (c) => {
  const user = c.get('user') as SessionUser
  const ticketId = parseInt(c.req.param('id'))
  const concertId = c.req.query('concert_id')
  
  try {
    // Get ticket info for log
    const ticket = await queryOne(c.env.DB, 'SELECT * FROM tickets WHERE id = ?', [ticketId])
    
    await execute(c.env.DB, `DELETE FROM tickets WHERE id = ?`, [ticketId])

    // Audit log
    await execute(c.env.DB, `
      INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
      VALUES (?, 'delete', 'tickets', ?, ?)
    `, [user.id, ticketId, JSON.stringify({ deleted_ticket: ticket })])

    if (concertId) {
      return c.redirect(`/admin/tickets/concert/${concertId}/orders?success=deleted`)
    }
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// CONCERT TICKETING SETTINGS
// ==========================================
app.get('/admin/tickets/concert/:concertId/settings', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.id as event_id, e.titel, e.start_at, e.locatie, e.afbeelding
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.html(<Layout title="Concert niet gevonden" user={user}><div>Concert niet gevonden</div></Layout>)
  }

  // Parse prijsstructuur
  let prijzen = []
  try {
    prijzen = concert.prijsstructuur ? JSON.parse(concert.prijsstructuur) : []
  } catch (e) {
    prijzen = []
  }

  return c.html(
    <Layout title={`Instellingen - ${concert.titel}`} user={user}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div class="mb-8">
          <a href="/admin/tickets" class="text-animato-primary hover:underline mb-4 inline-block">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar overzicht
          </a>
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-cog mr-3"></i>
            Ticketing Instellingen
          </h1>
          <p class="text-gray-600">{concert.titel}</p>
        </div>

        <form method="POST" action={`/api/admin/tickets/concert/${concertId}/settings`} class="space-y-8">
          
          {/* Basic Settings */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Basis Instellingen</h2>
            
            <div class="space-y-4">
              <div class="flex items-center">
                <input
                  type="checkbox"
                  name="ticketing_enabled"
                  id="ticketing_enabled"
                  checked={concert.ticketing_enabled === 1}
                  class="mr-3 w-5 h-5"
                />
                <label for="ticketing_enabled" class="text-gray-900 font-medium">
                  Online ticketverkoop inschakelen
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  name="uitverkocht"
                  id="uitverkocht"
                  checked={concert.uitverkocht === 1}
                  class="mr-3 w-5 h-5"
                />
                <label for="uitverkocht" class="text-gray-900 font-medium">
                  Markeer als uitverkocht (verbergt bestelformulier)
                </label>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Maximale capaciteit
                </label>
                <input
                  type="number"
                  name="capaciteit"
                  value={concert.capaciteit || 0}
                  min="0"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Bijvoorbeeld: 500"
                />
                <p class="text-sm text-gray-500 mt-1">
                  Stel in op 0 voor onbeperkte capaciteit
                </p>
              </div>
            </div>
          </div>

          {/* Prijsstructuur */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Prijscategorieën</h2>
            
            <div id="prijzen-container" class="space-y-4">
              {prijzen.length === 0 ? (
                <p class="text-gray-500">Nog geen prijscategorieën ingesteld</p>
              ) : (
                prijzen.map((prijs: any, index: number) => (
                  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50 relative" data-price-index={index}>
                    <button
                      type="button"
                      onclick={`removePriceCategory(${index})`}
                      class="absolute top-2 right-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition"
                      title="Verwijder prijscategorie"
                    >
                      <i class="fas fa-trash-alt"></i>
                    </button>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Categorie
                        </label>
                        <input
                          type="text"
                          name={`prijzen[${index}][categorie]`}
                          value={prijs.categorie}
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="Volwassenen"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Prijs (€)
                        </label>
                        <input
                          type="number"
                          name={`prijzen[${index}][prijs]`}
                          value={prijs.prijs}
                          step="0.01"
                          min="0"
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="15.00"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          Beschrijving (optioneel)
                        </label>
                        <input
                          type="text"
                          name={`prijzen[${index}][beschrijving]`}
                          value={prijs.beschrijving || ''}
                          class="w-full border border-gray-300 rounded-lg px-4 py-2"
                          placeholder="Vanaf 18 jaar"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onclick="addPriceCategory()"
              class="mt-4 text-animato-primary hover:underline inline-flex items-center"
            >
              <i class="fas fa-plus mr-2"></i>
              Prijscategorie toevoegen
            </button>
          </div>

          {/* Concert Afbeelding */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">
              <i class="fas fa-image text-animato-primary mr-2"></i>
              Concert Afbeelding
            </h2>
            
            <div class="space-y-6">
              {/* Tab Buttons */}
              <div class="flex gap-2 border-b border-gray-200">
                <button
                  type="button"
                  onclick="switchImageTab('upload')"
                  id="upload-tab"
                  class="px-4 py-2 border-b-2 border-transparent hover:border-animato-primary transition font-medium text-gray-600 hover:text-gray-900"
                >
                  <i class="fas fa-upload mr-2"></i>
                  Bestand Uploaden
                </button>
                <button
                  type="button"
                  onclick="switchImageTab('url')"
                  id="url-tab"
                  class="px-4 py-2 border-b-2 border-animato-primary font-medium text-gray-900"
                >
                  <i class="fas fa-link mr-2"></i>
                  URL Invoeren
                </button>
              </div>

              {/* Upload Tab */}
              <div id="upload-section" class="hidden">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Upload Afbeelding
                </label>
                
                {/* Drag & Drop Area */}
                <div 
                  id="drop-zone"
                  class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-animato-primary transition cursor-pointer"
                  ondragover="event.preventDefault(); this.classList.add('border-animato-primary', 'bg-blue-50');"
                  ondragleave="this.classList.remove('border-animato-primary', 'bg-blue-50');"
                  ondrop="handleFileDrop(event)"
                  onclick="document.getElementById('file-input').click()"
                >
                  <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-4"></i>
                  <p class="text-gray-700 font-medium mb-2">
                    Klik om een bestand te selecteren of sleep het hierheen
                  </p>
                  <p class="text-sm text-gray-500">
                    PNG, JPG, GIF tot 5MB
                  </p>
                  <input
                    type="file"
                    id="file-input"
                    accept="image/*"
                    class="hidden"
                    onchange="handleFileSelect(event)"
                  />
                </div>

                <input type="hidden" id="afbeelding-upload" name="afbeelding" value={concert.afbeelding || ''} />
              </div>

              {/* URL Tab */}
              <div id="url-section">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Afbeelding URL
                </label>
                <input
                  type="url"
                  id="afbeelding-url"
                  name="afbeelding"
                  value={concert.afbeelding || ''}
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="https://example.com/concert-image.jpg"
                  oninput="updatePreview(this.value)"
                />
                <p class="text-sm text-gray-500 mt-1">
                  <i class="fas fa-info-circle mr-1"></i>
                  Plak een URL van een online afbeelding (bijv. van je website of cloudopslag)
                </p>
              </div>

              {/* Preview */}
              <div id="preview-section" class={concert.afbeelding ? '' : 'hidden'}>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Preview
                </label>
                <div class="border border-gray-200 rounded-lg overflow-hidden max-w-md">
                  <img 
                    id="preview-image"
                    src={concert.afbeelding || ''} 
                    alt="Concert preview"
                    class="w-full h-auto"
                    onerror="this.parentElement.innerHTML='<div class=\\'p-8 text-center text-gray-500\\'>❌ Afbeelding kan niet geladen worden</div>'"
                  />
                </div>
                <button
                  type="button"
                  onclick="removeImage()"
                  class="mt-2 text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  <i class="fas fa-trash mr-1"></i>
                  Verwijder afbeelding
                </button>
              </div>
            </div>
          </div>

          {/* Programma */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Programma</h2>
            
            <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet" />
            <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
               <div id="editor-programma" class="h-64"></div>
            </div>
            
            <textarea name="programma" id="programma-input" class="hidden">{concert.programma || ''}</textarea>
            
            <p class="text-sm text-gray-500 mt-1">
              Dit wordt getoond op de ticketpagina
            </p>
          </div>

          {/* Praktische Informatie */}
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-bold text-gray-900 mb-6">
              <i class="fas fa-info-circle text-animato-primary mr-2"></i>
              Praktische Informatie
            </h2>
            
            <div class="space-y-6">
              {/* Parking */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-parking mr-2 text-gray-600"></i>
                  Parking
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-parking" class="h-32"></div>
                </div>
                <textarea name="parking" id="parking-input" class="hidden">{concert.parking || ''}</textarea>
              </div>

              {/* Toegankelijkheid */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-wheelchair mr-2 text-gray-600"></i>
                  Toegankelijkheid
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-toegankelijkheid" class="h-32"></div>
                </div>
                <textarea name="toegankelijkheid" id="toegankelijkheid-input" class="hidden">{concert.toegankelijkheid || ''}</textarea>
              </div>

              {/* Duur & Pauze */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-clock mr-2 text-gray-600"></i>
                  Duur & Pauze
                </label>
                <input
                  type="text"
                  name="duur_info"
                  class="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Bijv. Het concert duurt ongeveer 2 uur inclusief een pauze van 20 minuten."
                  value={concert.duur_info || ''}
                />
              </div>

              {/* Sfeer & Dresscode */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-tshirt mr-2 text-gray-600"></i>
                  Sfeer & Dresscode
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-sfeer" class="h-32"></div>
                </div>
                <textarea name="sfeer_dresscode" id="sfeer-input" class="hidden">{concert.sfeer_dresscode || ''}</textarea>
              </div>

              {/* Extra Info */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-star mr-2 text-gray-600"></i>
                  Extra Informatie
                </label>
                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden">
                   <div id="editor-extra" class="h-32"></div>
                </div>
                <textarea name="extra_info" id="extra-input" class="hidden">{concert.extra_info || ''}</textarea>
              </div>
            </div>

            <p class="text-sm text-gray-500 mt-4">
              <i class="fas fa-lightbulb mr-1"></i>
              Deze informatie wordt getoond in de "Praktische Informatie" sectie op de concert detailpagina
            </p>
          </div>

          {/* Submit */}
          <div class="flex items-center justify-end space-x-4">
            <a
              href="/admin/tickets"
              class="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuleren
            </a>
            <button
              type="submit"
              class="px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition"
            >
              <i class="fas fa-save mr-2"></i>
              Instellingen Opslaan
            </button>
          </div>
        </form>

        {/* Delete Confirmation Modal */}
        <div id="deleteModal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div class="fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm transition-opacity" aria-hidden="true" onclick="closeDeleteModal()"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border-t-4 border-red-500">
              <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div class="sm:flex sm:items-start">
                  <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <i class="fas fa-exclamation-triangle text-red-600"></i>
                  </div>
                  <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 class="text-xl leading-6 font-bold text-gray-900" id="modal-title" style="font-family: 'Playfair Display', serif;">
                      Bevestig Verwijderen
                    </h3>
                    <div class="mt-2">
                      <p class="text-sm text-gray-500">
                        Weet je zeker dat je dit item wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" id="confirmDeleteBtn" class="w-full inline-flex justify-center rounded-lg border border-transparent shadow-md px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Verwijderen
                </button>
                <button type="button" onclick="closeDeleteModal()" class="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition">
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* JavaScript */}
        <script src="https://cdn.quilljs.com/1.3.6/quill.min.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          // Initialize Quill editors
          function initEditor(containerId, inputId) {
            if (document.getElementById(containerId)) {
              var quill = new Quill('#' + containerId, {
                theme: 'snow',
                modules: {
                  toolbar: [
                    [{ 'header': [3, 4, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['clean']
                  ]
                }
              });

              // Load initial content
              var initialContent = document.getElementById(inputId).value;
              if (initialContent) {
                 quill.clipboard.dangerouslyPasteHTML(initialContent);
              }

              // Sync content on change
              quill.on('text-change', function() {
                document.getElementById(inputId).value = quill.root.innerHTML;
              });
            }
          }

          // Initialize all editors
          initEditor('editor-programma', 'programma-input');
          initEditor('editor-parking', 'parking-input');
          initEditor('editor-toegankelijkheid', 'toegankelijkheid-input');
          initEditor('editor-sfeer', 'sfeer-input');
          initEditor('editor-extra', 'extra-input');

          let priceIndex = ${prijzen.length};
          let deleteCallback = null;

          function openDeleteModal(callback) {
            deleteCallback = callback;
            document.getElementById('deleteModal').classList.remove('hidden');
          }

          function closeDeleteModal() {
            deleteCallback = null;
            document.getElementById('deleteModal').classList.add('hidden');
          }

          document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
            if (deleteCallback) {
              deleteCallback();
            }
            closeDeleteModal();
          });
          
          function addPriceCategory() {
            const container = document.getElementById('prijzen-container');
            const div = document.createElement('div');
            div.className = 'border border-gray-200 rounded-lg p-4 bg-gray-50 relative';
            div.setAttribute('data-price-index', priceIndex);
            div.innerHTML = \`
              <button type="button" onclick="removePriceCategory(\${priceIndex})" class="absolute top-2 right-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition" title="Verwijder prijscategorie">
                <i class="fas fa-trash-alt"></i>
              </button>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Categorie</label>
                  <input type="text" name="prijzen[\${priceIndex}][categorie]" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="Volwassenen" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Prijs (€)</label>
                  <input type="number" name="prijzen[\${priceIndex}][prijs]" step="0.01" min="0" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="15.00" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Beschrijving (optioneel)</label>
                  <input type="text" name="prijzen[\${priceIndex}][beschrijving]" class="w-full border border-gray-300 rounded-lg px-4 py-2" placeholder="Vanaf 18 jaar" />
                </div>
              </div>
            \`;
            container.appendChild(div);
            priceIndex++;
          }
          
          function removePriceCategory(index) {
            openDeleteModal(function() {
              // Find the div with data-price-index matching the index
              const container = document.getElementById('prijzen-container');
              const divToRemove = container.querySelector('[data-price-index="' + index + '"]');
              
              if (divToRemove) {
                divToRemove.remove();
              }
            });
          }

          // Image Upload Functions
          function switchImageTab(tab) {
            const uploadTab = document.getElementById('upload-tab');
            const urlTab = document.getElementById('url-tab');
            const uploadSection = document.getElementById('upload-section');
            const urlSection = document.getElementById('url-section');
            
            if (tab === 'upload') {
              uploadTab.classList.add('border-animato-primary', 'text-gray-900');
              uploadTab.classList.remove('border-transparent', 'text-gray-600');
              urlTab.classList.remove('border-animato-primary', 'text-gray-900');
              urlTab.classList.add('border-transparent', 'text-gray-600');
              
              uploadSection.classList.remove('hidden');
              urlSection.classList.add('hidden');
              
              // Switch name attribute
              document.getElementById('afbeelding-upload').name = 'afbeelding';
              document.getElementById('afbeelding-url').name = '';
            } else {
              urlTab.classList.add('border-animato-primary', 'text-gray-900');
              urlTab.classList.remove('border-transparent', 'text-gray-600');
              uploadTab.classList.remove('border-animato-primary', 'text-gray-900');
              uploadTab.classList.add('border-transparent', 'text-gray-600');
              
              urlSection.classList.remove('hidden');
              uploadSection.classList.add('hidden');
              
              // Switch name attribute
              document.getElementById('afbeelding-url').name = 'afbeelding';
              document.getElementById('afbeelding-upload').name = '';
            }
          }

          function handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) {
              processFile(file);
            }
          }

          function handleFileDrop(event) {
            event.preventDefault();
            const dropZone = document.getElementById('drop-zone');
            dropZone.classList.remove('border-animato-primary', 'bg-blue-50');
            
            const file = event.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
              processFile(file);
            } else {
              alert('Selecteer een geldig afbeeldingsbestand');
            }
          }

          function processFile(file) {
            // Check file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
              alert('Bestand is te groot. Maximum 5MB toegestaan.');
              return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
              const dataUrl = e.target.result;
              
              // Update hidden input and preview
              document.getElementById('afbeelding-upload').value = dataUrl;
              updatePreview(dataUrl);
            };
            reader.readAsDataURL(file);
          }

          function updatePreview(imageUrl) {
            const previewSection = document.getElementById('preview-section');
            const previewImage = document.getElementById('preview-image');
            
            if (imageUrl) {
              previewSection.classList.remove('hidden');
              previewImage.src = imageUrl;
            } else {
              previewSection.classList.add('hidden');
            }
          }

          function removeImage() {
            openDeleteModal(function() {
              document.getElementById('afbeelding-url').value = '';
              document.getElementById('afbeelding-upload').value = '';
              document.getElementById('file-input').value = '';
              document.getElementById('preview-section').classList.add('hidden');
            });
          }
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// UPDATE CONCERT SETTINGS API
// ==========================================
app.post('/api/admin/tickets/concert/:concertId/settings', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  const body = await c.req.parseBody()
  
  try {
    // Parse prijsstructuur from form
    const prijzen: any[] = []
    for (const [key, value] of Object.entries(body)) {
      const match = key.match(/prijzen\[(\d+)\]\[categorie\]/)
      if (match) {
        const index = parseInt(match[1])
        const categorie = String(value)
        const prijs = parseFloat(String(body[`prijzen[${index}][prijs]`]))
        const beschrijving = String(body[`prijzen[${index}][beschrijving]`] || '')
        
        if (categorie && prijs >= 0) {
          prijzen.push({ categorie, prijs, beschrijving })
        }
      }
    }

    // Get event_id for this concert
    const concert = await queryOne(c.env.DB, `SELECT event_id FROM concerts WHERE id = ?`, [concertId])
    
    if (!concert) {
      return c.json({ error: 'Concert niet gevonden' }, 404)
    }

    // Update concert settings
    await execute(c.env.DB, `
      UPDATE concerts SET
        ticketing_enabled = ?,
        uitverkocht = ?,
        capaciteit = ?,
        prijsstructuur = ?,
        programma = ?,
        parking = ?,
        toegankelijkheid = ?,
        duur_info = ?,
        sfeer_dresscode = ?,
        extra_info = ?
      WHERE id = ?
    `, [
      body.ticketing_enabled ? 1 : 0,
      body.uitverkocht ? 1 : 0,
      parseInt(String(body.capaciteit)) || 0,
      JSON.stringify(prijzen),
      String(body.programma || ''),
      String(body.parking || ''),
      String(body.toegankelijkheid || ''),
      String(body.duur_info || ''),
      String(body.sfeer_dresscode || ''),
      String(body.extra_info || ''),
      concertId
    ])

    // Update event image
    if (body.afbeelding !== undefined) {
      await execute(c.env.DB, `
        UPDATE events SET
          afbeelding = ?
        WHERE id = ?
      `, [
        String(body.afbeelding || ''),
        concert.event_id
      ])
    }

    return c.redirect('/admin/tickets')
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// ==========================================
// QR CODE SCANNER PAGE
// ==========================================
app.get('/admin/tickets/concert/:concertId/scan', async (c) => {
  const user = c.get('user') as SessionUser
  const concertId = parseInt(c.req.param('concertId'))
  
  const concert = await queryOne(c.env.DB, `
    SELECT c.*, e.titel, e.start_at, e.locatie
    FROM concerts c
    JOIN events e ON e.id = c.event_id
    WHERE c.id = ?
  `, [concertId])
  
  if (!concert) {
    return c.html(<Layout title="Concert niet gevonden" user={user}><div>Concert niet gevonden</div></Layout>)
  }

  return c.html(
    <Layout title={`QR Scanner - ${concert.titel}`} user={user}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div class="mb-8">
          <a href="/admin/tickets" class="text-animato-primary hover:underline mb-4 inline-block">
            <i class="fas fa-arrow-left mr-2"></i>
            Terug naar overzicht
          </a>
          <h1 class="text-3xl font-bold text-animato-secondary mb-2" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-qrcode mr-3"></i>
            QR Code Scanner
          </h1>
          <p class="text-gray-600">{concert.titel}</p>
          <p class="text-sm text-gray-500">
            {new Date(concert.start_at).toLocaleDateString('nl-NL', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>

        {/* Scanner Interface */}
        <div class="bg-white rounded-lg shadow-md p-6">
          
          {/* Manual QR Code Input */}
          <div class="mb-8">
            <h2 class="text-xl font-bold text-gray-900 mb-4">Scan Ticket</h2>
            <div class="flex gap-4">
              <input
                type="text"
                id="qr-input"
                placeholder="Scan of typ QR-code..."
                class="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-lg"
                autofocus
              />
              <button
                onclick="validateTicket()"
                class="px-6 py-3 bg-animato-primary text-white rounded-lg hover:bg-opacity-90 transition"
              >
                <i class="fas fa-check mr-2"></i>
                Valideer
              </button>
            </div>
            <p class="text-sm text-gray-500 mt-2">
              <i class="fas fa-info-circle mr-1"></i>
              Gebruik een QR-scanner of typ de code handmatig in
            </p>
          </div>

          {/* Result Display */}
          <div id="result-container" class="hidden">
            <div id="result-success" class="hidden bg-green-50 border-2 border-green-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-check-circle text-green-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-green-900">Ticket Geldig!</h3>
                  <p class="text-green-700">Toegang verleend</p>
                </div>
              </div>
              <div id="ticket-details" class="text-sm text-gray-700 space-y-2"></div>
            </div>

            <div id="result-error" class="hidden bg-red-50 border-2 border-red-500 rounded-lg p-6">
              <div class="flex items-center mb-4">
                <i class="fas fa-times-circle text-red-600 text-4xl mr-4"></i>
                <div>
                  <h3 class="text-2xl font-bold text-red-900">Ticket Ongeldig</h3>
                  <p id="error-message" class="text-red-700"></p>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div class="mt-8 pt-8 border-t border-gray-200">
            <h3 class="text-lg font-bold text-gray-900 mb-4">Live Statistieken</h3>
            <div class="grid grid-cols-3 gap-4">
              <div class="text-center">
                <div class="text-3xl font-bold text-gray-900" id="scanned-count">0</div>
                <div class="text-sm text-gray-600">Gescand</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-green-600" id="valid-count">0</div>
                <div class="text-sm text-gray-600">Geldig</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold text-red-600" id="invalid-count">0</div>
                <div class="text-sm text-gray-600">Ongeldig</div>
              </div>
            </div>
          </div>
        </div>

        {/* JavaScript */}
        <script dangerouslySetInnerHTML={{ __html: `
          let scanned = 0;
          let valid = 0;
          let invalid = 0;
          
          async function validateTicket() {
            const input = document.getElementById('qr-input');
            const qrCode = input.value.trim();
            
            if (!qrCode) {
              alert('Voer een QR-code in');
              return;
            }
            
            scanned++;
            document.getElementById('scanned-count').textContent = scanned;
            
            try {
              const response = await fetch('/api/admin/tickets/validate-qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_code: qrCode, concert_id: ${concertId} })
              });
              
              const data = await response.json();
              
              document.getElementById('result-container').classList.remove('hidden');
              
              if (data.valid) {
                valid++;
                document.getElementById('valid-count').textContent = valid;
                
                document.getElementById('result-success').classList.remove('hidden');
                document.getElementById('result-error').classList.add('hidden');
                
                document.getElementById('ticket-details').innerHTML = \`
                  <p><strong>Order:</strong> \${data.ticket.order_ref}</p>
                  <p><strong>Naam:</strong> \${data.ticket.koper_naam}</p>
                  <p><strong>Email:</strong> \${data.ticket.koper_email}</p>
                  <p><strong>Tickets:</strong> \${data.ticket.aantal}x \${data.ticket.categorie}</p>
                \`;
                
                // Play success sound
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRAE=' );
                audio.play();
                
                setTimeout(() => {
                  input.value = '';
                  input.focus();
                  document.getElementById('result-container').classList.add('hidden');
                }, 3000);
              } else {
                invalid++;
                document.getElementById('invalid-count').textContent = invalid;
                
                document.getElementById('result-success').classList.add('hidden');
                document.getElementById('result-error').classList.remove('hidden');
                document.getElementById('error-message').textContent = data.message;
                
                setTimeout(() => {
                  input.value = '';
                  input.focus();
                  document.getElementById('result-container').classList.add('hidden');
                }, 3000);
              }
            } catch (error) {
              alert('Fout bij validatie: ' + error.message);
            }
          }
          
          // Enter key handler
          document.getElementById('qr-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              validateTicket();
            }
          });
        ` }} />
      </div>
    </Layout>
  )
})

// ==========================================
// QR CODE VALIDATION API
// ==========================================
app.post('/api/admin/tickets/validate-qr', async (c) => {
  const body = await c.req.json()
  const qrCode = body.qr_code
  const concertId = body.concert_id
  
  try {
    const ticket = await queryOne(c.env.DB, `
      SELECT t.*, c.id as concert_id
      FROM tickets t
      JOIN concerts c ON c.id = t.concert_id
      WHERE t.qr_code = ? AND c.id = ?
    `, [qrCode, concertId])
    
    if (!ticket) {
      return c.json({
        valid: false,
        message: 'QR-code niet gevonden voor dit concert'
      })
    }
    
    if (ticket.status !== 'paid') {
      return c.json({
        valid: false,
        message: 'Ticket niet betaald'
      })
    }
    
    return c.json({
      valid: true,
      ticket: {
        order_ref: ticket.order_ref,
        koper_naam: ticket.koper_naam,
        koper_email: ticket.koper_email,
        aantal: ticket.aantal,
        categorie: ticket.categorie
      }
    })
  } catch (error) {
    return c.json({ valid: false, message: (error as Error).message }, 500)
  }
})

export default app
