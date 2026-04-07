import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, queryOne, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import type { Bindings, SessionUser } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

app.get('/admin/feedback', async (c) => {
  const user = c.get('user') as SessionUser
  const statusFilter = c.req.query('status') || 'all'
  const typeFilter = c.req.query('type') || 'all'

  let query = `SELECT f.*, u.email, p.voornaam, p.achternaam,
     (SELECT COUNT(*) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as comment_count,
     (SELECT MAX(fc.created_at) FROM feedback_comments fc WHERE fc.feedback_id = f.id) as last_comment_at
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE 1=1`
  const params: any[] = []

  if (statusFilter !== 'all') { query += ` AND f.status = ?`; params.push(statusFilter) }
  if (typeFilter !== 'all') { query += ` AND f.type = ?`; params.push(typeFilter) }
  query += ` ORDER BY f.created_at DESC`

  const feedback = await queryAll(c.env.DB, query, params)

  // Count per status for badges
  const counts = await queryAll<any>(c.env.DB, `SELECT status, COUNT(*) as cnt FROM feedback GROUP BY status`)
  const countMap: Record<string,number> = {}
  for (const r of counts) countMap[r.status] = r.cnt

  return c.html(
    <Layout title="Beta Feedback" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="feedback" />
        <div class="flex-1 p-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">
            <i class="fas fa-bug text-animato-primary mr-3"></i>
            Beta Feedback
          </h1>
          <p class="text-gray-500 mb-6">{feedback.length} item(s) gevonden</p>

          {/* Filter bar */}
          <div class="bg-white rounded-lg shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-center">
            <span class="text-sm font-medium text-gray-600">Filter op status:</span>
            {[
              { val: 'all', label: 'Alles', color: 'bg-gray-100 text-gray-700' },
              { val: 'open', label: 'Open', color: 'bg-yellow-100 text-yellow-800' },
              { val: 'in_progress', label: 'In behandeling', color: 'bg-blue-100 text-blue-800' },
              { val: 'resolved', label: 'Opgelost', color: 'bg-green-100 text-green-800' },
              { val: 'rejected', label: 'Afgewezen', color: 'bg-red-100 text-red-800' },
            ].map(opt => (
              <a
                href={`/admin/feedback?status=${opt.val}&type=${typeFilter}`}
                class={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  statusFilter === opt.val
                    ? 'border-animato-primary ring-2 ring-animato-primary ring-offset-1 ' + opt.color
                    : 'border-transparent hover:border-gray-300 ' + opt.color
                }`}
              >
                {opt.label}
                {opt.val !== 'all' && countMap[opt.val] ? <span class="ml-1 opacity-70">({countMap[opt.val]})</span> : null}
              </a>
            ))}
            <div class="ml-auto flex items-center gap-2">
              <span class="text-sm font-medium text-gray-600">Type:</span>
              {[
                { val: 'all', label: 'Alles' },
                { val: 'bug', label: '🐛 Bug' },
                { val: 'feature', label: '💡 Idee' },
              ].map(opt => (
                <a
                  href={`/admin/feedback?status=${statusFilter}&type=${opt.val}`}
                  class={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    typeFilter === opt.val
                      ? 'bg-animato-primary text-white border-animato-primary'
                      : 'bg-gray-100 text-gray-700 border-transparent hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </a>
              ))}
            </div>
          </div>

          <div class="space-y-4">
            {feedback.map((item: any) => (
              <div class={`bg-white rounded-lg shadow p-5 border-l-4 ${
                item.type === 'bug' ? 'border-red-400' :
                item.type === 'feature' ? 'border-blue-400' : 'border-gray-400'
              }`} id={`feedback-${item.id}`}>
                <div class="flex justify-between items-start gap-4">
                  {/* Left: info */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.type === 'bug' ? 'bg-red-100 text-red-800' :
                        item.type === 'feature' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.type === 'bug' ? '🐛 Bug' : item.type === 'feature' ? '💡 Idee' : '📝 Anders'}
                      </span>
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                        item.status === 'resolved' ? 'bg-green-100 text-green-800' :
                        item.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.status === 'open' ? 'Open' : item.status === 'in_progress' ? 'In behandeling' : item.status === 'resolved' ? 'Opgelost' : 'Afgewezen'}
                      </span>
                      {item.comment_count > 0 && (
                        <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                          <i class="fas fa-comments mr-1"></i>{item.comment_count} {item.comment_count === 1 ? 'reactie' : 'reacties'}
                        </span>
                      )}
                      <span class="text-xs text-gray-400">
                        {item.voornaam} {item.achternaam} — {new Date(item.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p class="text-sm text-gray-800 mb-1">{item.message}</p>
                    {item.url && (
                      <a href={item.url} target="_blank" class="text-xs text-blue-500 hover:underline break-all">
                        <i class="fas fa-link mr-1"></i>{item.url}
                      </a>
                    )}
                  </div>
                  {/* Right: status selector + conversation toggle */}
                  <div class="shrink-0 flex flex-col items-end gap-2">
                    <form action="/api/admin/feedback/update" method="POST">
                      <input type="hidden" name="id" value={item.id} />
                      <select name="status" onchange="this.form.submit()" class="text-xs border rounded p-1.5 bg-gray-50">
                        <option value="open" selected={item.status === 'open'}>Open</option>
                        <option value="in_progress" selected={item.status === 'in_progress'}>In Behandeling</option>
                        <option value="resolved" selected={item.status === 'resolved'}>Opgelost</option>
                        <option value="rejected" selected={item.status === 'rejected'}>Afgewezen</option>
                      </select>
                    </form>
                    <button
                      onclick={`toggleConversation(${item.id})`}
                      class="text-xs text-animato-primary hover:text-animato-secondary font-semibold flex items-center gap-1 transition"
                    >
                      <i class="fas fa-comments"></i>
                      <span id={`conv-btn-label-${item.id}`}>Conversatie</span>
                    </button>
                  </div>
                </div>
                {/* Screenshot */}
                {item.screenshot && (
                  <div class="mt-3">
                    <p class="text-xs text-gray-400 mb-1"><i class="fas fa-image mr-1"></i>Screenshot</p>
                    <img
                      src={item.screenshot}
                      alt="Screenshot"
                      class="max-h-64 rounded border border-gray-200 cursor-pointer hover:opacity-90 transition"
                      onclick="document.getElementById('screenshot-modal-img').src=this.src; document.getElementById('screenshot-modal').classList.remove('hidden');"
                    />
                  </div>
                )}

                {/* Conversation panel (hidden by default) */}
                <div id={`conv-panel-${item.id}`} class="hidden mt-4 border-t pt-4">
                  <div id={`conv-messages-${item.id}`} class="space-y-3 mb-3 max-h-64 overflow-y-auto">
                    <div class="text-center text-xs text-gray-400 py-2">
                      <i class="fas fa-spinner fa-spin mr-1"></i> Berichten laden...
                    </div>
                  </div>
                  {/* Reply form */}
                  <div class="flex gap-2">
                    <input
                      type="text"
                      id={`conv-input-${item.id}`}
                      placeholder="Vraag om meer info, of geef een reactie..."
                      class="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                      onkeydown={`if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); sendAdminComment(${item.id})}`}
                    />
                    <button
                      onclick={`sendAdminComment(${item.id})`}
                      class="px-4 py-2 bg-animato-primary text-white text-sm font-semibold rounded-lg hover:bg-animato-secondary transition flex items-center gap-1"
                    >
                      <i class="fas fa-paper-plane"></i>
                      <span class="hidden sm:inline">Verstuur</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {feedback.length === 0 && (
              <div class="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                <i class="fas fa-inbox text-4xl mb-3"></i>
                <p>Nog geen feedback ontvangen.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Screenshot lightbox modal */}
      <div id="screenshot-modal" class="fixed inset-0 bg-black bg-opacity-75 z-50 hidden flex items-center justify-center p-4" onclick="this.classList.add('hidden')">
        <div class="max-w-4xl max-h-full">
          <img id="screenshot-modal-img" src="" alt="Screenshot" class="max-w-full max-h-screen rounded shadow-2xl" />
          <p class="text-white text-center text-sm mt-2 opacity-60">Klik ergens om te sluiten</p>
        </div>
      </div>

      {/* Conversation JavaScript */}
      <script dangerouslySetInnerHTML={{__html: `
        const loadedConversations = {};

        function toggleConversation(feedbackId) {
          const panel = document.getElementById('conv-panel-' + feedbackId);
          const label = document.getElementById('conv-btn-label-' + feedbackId);
          
          if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            label.textContent = 'Sluiten';
            if (!loadedConversations[feedbackId]) {
              loadConversation(feedbackId);
            }
          } else {
            panel.classList.add('hidden');
            label.textContent = 'Conversatie';
          }
        }

        async function loadConversation(feedbackId) {
          const container = document.getElementById('conv-messages-' + feedbackId);
          try {
            const res = await fetch('/api/feedback/' + feedbackId + '/comments');
            if (!res.ok) throw new Error('Fout bij laden');
            const data = await res.json();
            loadedConversations[feedbackId] = true;
            
            if (!data.comments || data.comments.length === 0) {
              container.innerHTML = '<div class="text-center text-xs text-gray-400 py-3"><i class="fas fa-comment-slash mr-1"></i> Nog geen berichten. Stel een vraag aan de melder!</div>';
              return;
            }
            
            container.innerHTML = data.comments.map(function(c) {
              const isAdmin = c.is_admin === 1;
              const name = (c.voornaam || '') + ' ' + (c.achternaam || '');
              const date = new Date(c.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
              
              if (isAdmin) {
                return '<div class="flex justify-end">' +
                  '<div class="max-w-[80%] bg-animato-primary bg-opacity-10 rounded-lg rounded-br-sm px-3 py-2 border border-animato-primary border-opacity-20">' +
                    '<div class="flex items-center gap-2 mb-0.5">' +
                      '<span class="text-xs font-semibold text-animato-primary"><i class="fas fa-shield-alt mr-1"></i>Admin</span>' +
                      '<span class="text-xs text-gray-400">' + date + '</span>' +
                    '</div>' +
                    '<p class="text-sm text-gray-800">' + escapeHtml(c.message) + '</p>' +
                  '</div>' +
                '</div>';
              } else {
                return '<div class="flex justify-start">' +
                  '<div class="max-w-[80%] bg-gray-100 rounded-lg rounded-bl-sm px-3 py-2">' +
                    '<div class="flex items-center gap-2 mb-0.5">' +
                      '<span class="text-xs font-semibold text-gray-700"><i class="fas fa-user mr-1"></i>' + escapeHtml(name.trim() || 'Gebruiker') + '</span>' +
                      '<span class="text-xs text-gray-400">' + date + '</span>' +
                    '</div>' +
                    '<p class="text-sm text-gray-800">' + escapeHtml(c.message) + '</p>' +
                  '</div>' +
                '</div>';
              }
            }).join('');
            
            // Scroll to bottom
            container.scrollTop = container.scrollHeight;
          } catch(e) {
            container.innerHTML = '<div class="text-center text-xs text-red-400 py-2"><i class="fas fa-exclamation-triangle mr-1"></i> Kon berichten niet laden.</div>';
          }
        }

        async function sendAdminComment(feedbackId) {
          const input = document.getElementById('conv-input-' + feedbackId);
          const message = input.value.trim();
          if (!message) return;
          
          input.disabled = true;
          
          try {
            const res = await fetch('/api/feedback/' + feedbackId + '/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: message })
            });
            
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Fout bij versturen');
            }
            
            input.value = '';
            // Reload conversation
            loadedConversations[feedbackId] = false;
            loadConversation(feedbackId);
          } catch(e) {
            alert('Fout: ' + e.message);
          } finally {
            input.disabled = false;
            input.focus();
          }
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      `}} />
    </Layout>
  )
})

app.post('/api/admin/feedback/update', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, "UPDATE feedback SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [body.status, body.id])
  return c.redirect('/admin/feedback')
})

export default app
